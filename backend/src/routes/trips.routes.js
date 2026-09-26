import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { rateLimit } from '../lib/rateLimit.js'
import { db } from '../lib/db.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { resolveSessionUser } from '../lib/session.js'
import { parseTripPayload } from '../lib/tripPayload.js'
import { loadTripDetail, attachTripPreviews } from '../lib/tripQueries.js'

// Saved trip plans belong to logged-in tourists: every route except POST /
// requires a session and is scoped to req.user.id -- no owner id from the
// request body or URL is ever trusted. POST / also accepts a visitor who is
// not logged in, but only to record the plan for admin statistics (user_id
// null); nothing here ever hands such a plan back to anyone.
export const tripsRouter = Router()

const MAX_TRIPS_PER_USER = 50

// Saving writes many rows and needs no account, so cap it per IP to stop it
// being used to fill the table.
const saveLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyFn: (req) => req.ip })

async function assertUnderTripLimit(trx, userId) {
  const [{ count }] = await trx('trips').where('user_id', userId).count('* as count')
  if (Number(count) >= MAX_TRIPS_PER_USER) {
    throw httpError(409, `บันทึกแผนทริปได้สูงสุด ${MAX_TRIPS_PER_USER} แผน กรุณาลบแผนเก่าก่อน`)
  }
}

const MAX_TITLE = 120

// Loads a trip the logged-in user owns, or 404s. Someone else's trip and a
// missing one look identical on purpose. Use after requireAuth.
async function findOwnedTrip(req) {
  const row = await db('trips').where({ id: req.params.id, user_id: req.user.id }).first()
  if (!row) throw httpError(404, 'ไม่พบแผนทริปนี้')
  return { row }
}

// The visitor's own trips, newest first. ?page&limit (default 12, max 50),
// ?search= matches the title, ?favorite=1 keeps only starred ones.
tripsRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12))

  const filtered = () => {
    const q = db('trips').where('trips.user_id', req.user.id)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
    // Escape LIKE wildcards so a "%" in the box searches for a literal "%".
    if (search) q.whereRaw("title ilike ? escape '\\'", [`%${search.replace(/[\\%_]/g, '\\$&')}%`])
    if (req.query.favorite === '1') q.where('trips.is_favorite', true)
    return q
  }
  const [{ count }] = await filtered().count('* as count')
  const rows = await filtered().orderBy('trips.created_at', 'desc').limit(pageSize).offset((page - 1) * pageSize)
  res.json({ data: await attachTripPreviews(rows), total: Number(count), page, pageSize, totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) })
}))

tripsRouter.post('/', saveLimiter, asyncHandler(async (req, res) => {
  const { trip, days } = parseTripPayload(req.body)

  // Place ids come from the client; only real places are accepted, and the
  // name snapshot is taken from the table rather than from the request.
  const placeIds = [...new Set(days.flatMap((d) => d.items.map((i) => i.place_id)).filter(Boolean))]
  const places = placeIds.length ? await db('places').select('id', 'name').whereIn('id', placeIds) : []
  const nameById = new Map(places.map((p) => [p.id, p.name]))
  if (placeIds.some((id) => !nameById.has(id))) throw httpError(400, 'ข้อมูลแผนทริปไม่ถูกต้อง: มีสถานที่ที่ไม่พบในระบบ')

  // Optional login: no session just means the plan is recorded without an owner.
  const user = await resolveSessionUser(req, res)

  const tripId = await db.transaction(async (trx) => {
    if (user) await assertUnderTripLimit(trx, user.id)

    const [{ id }] = await trx('trips').insert({ ...trip, user_id: user?.id ?? null }).returning('id')
    for (const d of days) {
      const { items, ...dayRow } = d
      const [{ id: dayId }] = await trx('trip_days').insert({ ...dayRow, trip_id: id }).returning('id')
      if (items.length) {
        await trx('trip_items').insert(items.map((it) => ({ ...it, day_id: dayId, place_name: it.kind === 'place' ? nameById.get(it.place_id) : it.place_name })))
      }
    }
    return id
  })

  // Only the owner gets the saved plan back; an anonymous visitor just learns
  // that it was recorded.
  if (!user) return res.status(202).json({ id: null })
  const row = await db('trips').where('id', tripId).first()
  res.status(201).json(await loadTripDetail(row))
}))

tripsRouter.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { row } = await findOwnedTrip(req)
  res.json(await loadTripDetail(row))
}))

// Rename and/or star a trip. The plan itself is edited through its own
// endpoints, never through this one.
tripsRouter.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { row } = await findOwnedTrip(req)
  const changes = {}
  if (req.body?.title !== undefined) {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
    if (!title) throw httpError(400, 'กรุณาตั้งชื่อทริป')
    if (title.length > MAX_TITLE) throw httpError(400, `ชื่อทริปต้องไม่เกิน ${MAX_TITLE} ตัวอักษร`)
    changes.title = title
  }
  if (req.body?.isFavorite !== undefined) {
    if (typeof req.body.isFavorite !== 'boolean') throw httpError(400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง')
    changes.is_favorite = req.body.isFavorite
  }
  if (!Object.keys(changes).length) throw httpError(400, 'ไม่มีข้อมูลที่ต้องแก้ไข')

  const [updated] = await db('trips').where('id', row.id).update({ ...changes, updated_at: new Date() }).returning('*')
  res.json((await attachTripPreviews([updated]))[0])
}))

// Like / dislike on one stop: { liked: true | false | null } (null clears the
// vote). The item is looked up through the user's own trip, so an item id from
// someone else's plan 404s like a missing one.
tripsRouter.patch('/:id/items/:itemId', requireAuth, asyncHandler(async (req, res) => {
  const { row } = await findOwnedTrip(req)
  const liked = req.body?.liked
  if (liked !== null && typeof liked !== 'boolean') throw httpError(400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง')

  const updated = await db.transaction(async (trx) => {
    const item = await trx('trip_items as i').join('trip_days as d', 'd.id', 'i.day_id')
      .where('d.trip_id', row.id).where('i.id', req.params.itemId).select('i.id').first()
    if (!item) return 0
    await trx('trip_items').where('id', item.id).update({ liked })
    await trx('trips').where('id', row.id).update({ updated_at: new Date() })
    return 1
  })
  if (!updated) throw httpError(404, 'ไม่พบสถานที่นี้ในแผนทริป')
  res.json({ id: req.params.itemId, liked })
}))

// Days and items go with it (ON DELETE CASCADE).
tripsRouter.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { row } = await findOwnedTrip(req)
  await db('trips').where('id', row.id).delete()
  res.status(204).end()
}))

// Copies a trip (days and items included) under the same owner, so the tourist
// can tweak one version and keep the other.
tripsRouter.post('/:id/duplicate', requireAuth, saveLimiter, asyncHandler(async (req, res) => {
  const { row } = await findOwnedTrip(req)
  const copyId = await db.transaction(async (trx) => {
    await assertUnderTripLimit(trx, req.user.id)
    const { id: _id, created_at: _c, updated_at: _u, is_favorite: _f, ...fields } = row
    const suffix = ' (สำเนา)'
    const [{ id }] = await trx('trips').insert({ ...fields, title: row.title.slice(0, MAX_TITLE - suffix.length) + suffix, input: JSON.stringify(row.input) }).returning('id')
    const days = await trx('trip_days').where('trip_id', row.id).orderBy('day_no')
    for (const d of days) {
      const { id: oldDayId, trip_id: _t, ...dayFields } = d
      const [{ id: dayId }] = await trx('trip_days').insert({ ...dayFields, trip_id: id }).returning('id')
      const items = await trx('trip_items').where('day_id', oldDayId).orderBy('position')
      if (items.length) await trx('trip_items').insert(items.map(({ id: _i, day_id: _d, ...it }) => ({ ...it, day_id: dayId })))
    }
    return id
  })
  const copy = await db('trips').where('id', copyId).first()
  res.status(201).json((await attachTripPreviews([copy]))[0])
}))
