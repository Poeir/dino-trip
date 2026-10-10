import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { db } from './db.js'

// Caches each table's mapped GET / response for a short window -- list
// queries against the remote DB take several seconds (query + multi-MB JSON
// transfer), and every page load fires GET / for several tables at once
// (see AppContext.jsx's loadData), so an uncached repeat load pays that cost
// on every single request. A short TTL (rather than cache-forever +
// write-invalidation alone) bounds staleness from writes that happen
// outside this router entirely -- e.g. the Python chatbot-service writing
// `embedding` directly during reindex (see reindex.routes.js).
const LIST_CACHE_TTL_MS = 25_000
const LIST_CACHE_MAX_ENTRIES = 100
const listCache = new Map() // table -> { data, expiresAt }
// Tracks an in-flight query per table so concurrent GET / calls that land
// while the cache is cold/expired share one DB round trip instead of each
// firing their own -- observed in practice: page load fires GET / for 5
// tables at once (see AppContext.jsx's loadData), and a cold query against
// the remote DB has been measured anywhere from ~6s to ~48s, so without this
// every one of those concurrent requests would independently pay that cost.
const inFlight = new Map() // table -> Promise<responseData>

// Used by routes that mutate a table's cached data through a path other
// than this router's own POST/PUT/DELETE below -- e.g. places.routes.js's
// and events.routes.js's photo upload/delete routes, which insert/delete
// place_photos/event_photos rows directly.
//
// A table can have several cache entries at once (the plain unpaginated
// list, plus one per distinct page/limit/search/filter combination -- see
// cacheKeyFor below), so this clears every entry for the table, not just one.
export function invalidateCache(table) {
  for (const key of listCache.keys()) {
    if (key === table || key.startsWith(`${table}?`) || key.startsWith(`${table}/`)) listCache.delete(key)
  }
}

// Lets a route outside crudRouter (e.g. places.routes.js's `/meta/names`)
// share this same cache/TTL instead of keeping its own -- a key starting
// with `${table}/` piggybacks on invalidateCache(table) above for free.
export function getCached(key) {
  const cached = listCache.get(key)
  return cached && cached.expiresAt > Date.now() ? cached.data : undefined
}
export function setCached(key, data) {
  // The key includes every query-string param, so without a cap anyone could
  // grow this Map (and force a fresh DB round trip) with `?x=<random>` -- and
  // an unpaginated entry is a whole table. Expired entries are dropped first,
  // then the oldest. Small on purpose: entries only live 25s anyway.
  if (listCache.size >= LIST_CACHE_MAX_ENTRIES && !listCache.has(key)) {
    const now = Date.now()
    for (const [k, v] of listCache) if (v.expiresAt <= now) listCache.delete(k)
    while (listCache.size >= LIST_CACHE_MAX_ENTRIES) listCache.delete(listCache.keys().next().value)
  }
  listCache.set(key, { data, expiresAt: Date.now() + LIST_CACHE_TTL_MS })
}

// GET / with no query params keeps the original single `table` cache key
// (unchanged behavior/perf for AppContext's bulk unpaginated load). Any query
// params (page/limit/search/category/...) get their own cache entry, sorted
// so equivalent param order doesn't produce duplicate cache misses.
function cacheKeyFor(table, query) {
  const keys = Object.keys(query).sort()
  if (!keys.length) return table
  return `${table}?${keys.map((k) => `${k}=${query[k]}`).join('&')}`
}

// mutateAuth guards POST/PUT/DELETE. It defaults to admin-only so a resource
// that forgets to pass one is locked down rather than writable by anyone;
// pass `[]` explicitly to open writes on purpose.
export function crudRouter({ table, select, order, sortRows, toRow, toResponse, mutateAuth = [requireAdmin], invalidateColumns = [], enrichRows, searchColumns, filters, sortable, uniqueViolationMessage, beforeDelete, beforeUpdate }) {
  const router = Router()
  // Turns a Postgres unique_violation (23505) on create/edit into a readable 409.
  const mapWriteError = (err) => (uniqueViolationMessage && err.code === '23505' ? httpError(409, uniqueViolationMessage) : err)
  const mapRow = toResponse || ((row) => row)
  const orderRules = order ? (Array.isArray(order) ? order : [order]) : []
  const columns = select ? select.split(',').map((s) => s.trim()) : '*'
  // Columns to null out on every write (e.g. `embedding`) -- they're derived
  // from other fields on the row, so any create/edit through this router
  // makes them stale until whatever recomputes them runs again.
  const invalidate = Object.fromEntries(invalidateColumns.map((c) => [c, null]))
  // Optional hook: (rows) => rows, to merge in data from another table (e.g.
  // places.routes.js joining place_photos) in one extra batched query instead
  // of N+1 per-row queries. Runs on every response shape (list and single
  // row) so a just-created/updated row reflects it too, not just GET /.
  const enrich = enrichRows || ((rows) => rows)

  // Applies ?search= (ILIKE across searchColumns) and the resource's own
  // `filters` hook (e.g. places' ?category=/?isActive=) to a query builder --
  // shared between the row query and the count query so both see the same
  // WHERE clause.
  function applyQueryParams(query, reqQuery) {
    let q = query
    if (searchColumns && reqQuery.search) {
      const term = `%${reqQuery.search}%`
      q = q.where((b) => { for (const col of searchColumns) b.orWhereILike(col, term) })
    }
    if (filters) q = filters(q, reqQuery)
    return q
  }

  router.get('/', asyncHandler(async (req, res) => {
    const paginated = 'page' in req.query || 'limit' in req.query

    // ?ids= (e.g. tripResponseToPlan's post-plan QR-points lookup) asks for a
    // different, essentially never-repeated set of rows on every call --
    // caching/coalescing it would just grow listCache forever for entries
    // that are never hit again, so run it straight through instead.
    if ('ids' in req.query) {
      let query = applyQueryParams(db(table).select(columns), req.query)
      const data = await query
      const rows = sortRows ? sortRows(data) : data
      return res.json((await enrich(rows)).map(mapRow))
    }

    const cacheKey = cacheKeyFor(table, req.query)

    const cached = listCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return res.json(cached.data)

    if (inFlight.has(cacheKey)) return res.json(await inFlight.get(cacheKey))

    const fetchPromise = (async () => {
      let responseData
      if (!paginated) {
        let query = applyQueryParams(db(table).select(columns), req.query)
        if (!sortRows) {
          for (const rule of orderRules) query = query.orderBy(rule.column, rule.ascending === false ? 'desc' : 'asc')
        }
        const data = await query
        const rows = sortRows ? sortRows(data) : data
        responseData = (await enrich(rows)).map(mapRow)
      } else {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))
        // Admin sort dropdowns (e.g. PlacesTab's "name"/"rating") ask for a
        // plain column sort, distinct from a resource's default `order`/
        // `sortRows` -- only honored when the column's in the `sortable`
        // allowlist, since it lands straight in an ORDER BY.
        const explicitSort = sortable?.includes(req.query.sort) ? req.query.sort : null
        const sortDir = req.query.dir === 'desc' ? 'desc' : 'asc'

        // sortRows (places' weighted-rating ranking) needs every matching row
        // in memory to compute its sitewide-mean score before it can rank
        // page 1 -- no way to push that to a DB-level LIMIT/OFFSET, so
        // paginate the already-sorted array in JS instead. Skipped when the
        // caller asked for an explicit column sort (admin's dropdown), which
        // gets the fast DB-level path below like any other resource.
        if (sortRows && !explicitSort) {
          const query = applyQueryParams(db(table).select(columns), req.query)
          const all = sortRows(await query)
          const total = all.length
          const rows = all.slice((page - 1) * pageSize, page * pageSize)
          responseData = { data: (await enrich(rows)).map(mapRow), total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
        } else {
          let rowQuery = applyQueryParams(db(table).select(columns), req.query)
          if (explicitSort) rowQuery = rowQuery.orderBy(explicitSort, sortDir)
          else for (const rule of orderRules) rowQuery = rowQuery.orderBy(rule.column, rule.ascending === false ? 'desc' : 'asc')
          const countQuery = applyQueryParams(db(table), req.query)
          const [{ c: total }, rows] = await Promise.all([
            countQuery.count('id as c').first(),
            rowQuery.limit(pageSize).offset((page - 1) * pageSize),
          ])
          responseData = { data: (await enrich(rows)).map(mapRow), total: Number(total), page, pageSize, totalPages: Math.ceil(Number(total) / pageSize) }
        }
      }
      setCached(cacheKey, responseData)
      return responseData
    })()
    inFlight.set(cacheKey, fetchPromise)
    try {
      res.json(await fetchPromise)
    } finally {
      inFlight.delete(cacheKey)
    }
  }))

  // Single-row lookup (e.g. PlaceDetailPage/EventDetailPage/TripResultPage,
  // PlacePicker resolving its currently-selected value) -- cached/coalesced
  // the same way GET / is, just keyed per-row so a `PUT /:id` invalidates
  // only that row's entry (see invalidateCache's `${table}/` prefix match).
  router.get('/:id', asyncHandler(async (req, res) => {
    const cacheKey = `${table}/${req.params.id}`

    const cached = listCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return res.json(cached.data)

    if (inFlight.has(cacheKey)) return res.json(await inFlight.get(cacheKey))

    const fetchPromise = (async () => {
      const row = await db(table).select(columns).where('id', req.params.id).first()
      if (!row) return null
      const [enriched] = await enrich([row])
      const responseData = mapRow(enriched)
      setCached(cacheKey, responseData)
      return responseData
    })()
    inFlight.set(cacheKey, fetchPromise)
    let responseData
    try {
      responseData = await fetchPromise
    } finally {
      inFlight.delete(cacheKey)
    }
    if (!responseData) throw httpError(404, 'ไม่พบข้อมูล')
    res.json(responseData)
  }))

  router.post('/', mutateAuth, asyncHandler(async (req, res) => {
    const payload = { ...(toRow ? toRow(req.body) : req.body), ...invalidate }
    let row
    try {
      ;[row] = await db(table).insert(payload).returning(columns)
    } catch (err) {
      throw mapWriteError(err)
    }
    const [enriched] = await enrich([row])
    invalidateCache(table)
    res.status(201).json(mapRow(enriched))
  }))

  router.put('/:id', mutateAuth, asyncHandler(async (req, res) => {
    const payload = { ...(toRow ? toRow(req.body) : req.body), ...invalidate }
    // Optional hook: (id, payload, req) => { extra?, after? } | null. `extra`
    // is merged into the update (e.g. places auto-locking the fields an admin
    // just edited); `after(row)` runs once the update succeeded.
    const pre = beforeUpdate ? await beforeUpdate(req.params.id, payload, req) : null
    if (pre?.extra) Object.assign(payload, pre.extra)
    let row
    try {
      ;[row] = await db(table).where('id', req.params.id).update(payload).returning(columns)
    } catch (err) {
      throw mapWriteError(err)
    }
    if (!row) throw httpError(404, 'ไม่พบข้อมูล')
    if (pre?.after) {
      // Bookkeeping (audit log, closing reports) must not turn a save that
      // already happened into an error response.
      try { await pre.after(row) } catch (err) { console.error(`afterUpdate for ${table} failed:`, err) }
    }
    const [enriched] = await enrich([row])
    invalidateCache(table)
    res.json(mapRow(enriched))
  }))

  router.delete('/:id', mutateAuth, asyncHandler(async (req, res) => {
    // Optional: (id) => cleanup | null, run before the row goes (so it can read
    // what it needs) and its returned cleanup run only once the delete worked.
    const cleanup = beforeDelete ? await beforeDelete(req.params.id) : null
    const count = await db(table).where('id', req.params.id).delete()
    if (!count) throw httpError(404, 'ไม่พบข้อมูล')
    invalidateCache(table)
    if (cleanup) Promise.resolve().then(cleanup).catch((err) => console.error(`Cleanup after deleting from ${table} failed:`, err))
    res.status(204).end()
  }))

  return router
}
