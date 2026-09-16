import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { db } from './db.js'

export function crudRouter({ table, select, order, sortRows, toRow, toResponse, mutateAuth = [], invalidateColumns = [], enrichRows }) {
  const router = Router()
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

  router.get('/', asyncHandler(async (req, res) => {
    let query = db(table).select(columns)
    if (!sortRows) {
      for (const rule of orderRules) query = query.orderBy(rule.column, rule.ascending === false ? 'desc' : 'asc')
    }
    const data = await query
    const rows = sortRows ? sortRows(data) : data
    res.json((await enrich(rows)).map(mapRow))
  }))

  router.post('/', mutateAuth, asyncHandler(async (req, res) => {
    const payload = { ...(toRow ? toRow(req.body) : req.body), ...invalidate }
    const [row] = await db(table).insert(payload).returning(columns)
    const [enriched] = await enrich([row])
    res.status(201).json(mapRow(enriched))
  }))

  router.put('/:id', mutateAuth, asyncHandler(async (req, res) => {
    const payload = { ...(toRow ? toRow(req.body) : req.body), ...invalidate }
    const [row] = await db(table).where('id', req.params.id).update(payload).returning(columns)
    if (!row) throw httpError(404, 'ไม่พบข้อมูล')
    const [enriched] = await enrich([row])
    res.json(mapRow(enriched))
  }))

  router.delete('/:id', mutateAuth, asyncHandler(async (req, res) => {
    const count = await db(table).where('id', req.params.id).delete()
    if (!count) throw httpError(404, 'ไม่พบข้อมูล')
    res.status(204).end()
  }))

  return router
}
