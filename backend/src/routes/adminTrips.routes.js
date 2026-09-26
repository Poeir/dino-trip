import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { db } from '../lib/db.js'
import { loadTripDetail, attachTripPreviews } from '../lib/tripQueries.js'

// Admin view of every recorded trip plan: those saved by logged-in tourists
// and the ones recorded for statistics when a visitor was not logged in
// (user_id null). Statistics live in adminStats.routes.js (GET /trips).
export const adminTripsRouter = Router()
adminTripsRouter.use(requireAdmin)

// A trip is flagged when one of its real places has since been deactivated,
// closed for good/for now, or removed -- the plan may no longer be workable.
const ISSUE_SQL = `exists (
  select 1 from trip_items i
  join trip_days d on d.id = i.day_id
  left join places p on p.id = i.place_id
  where d.trip_id = t.id and i.kind = 'place'
    and (i.place_id is null or p.is_active is false or p.business_status in ('CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY'))
)`

const ownerOf = (row) => (row.user_id
  ? { id: row.user_id, name: row.owner_name || row.owner_email || '-', email: row.owner_email, deleted: !!row.owner_deleted_at }
  : null)

// ?page&limit (default 20, max 100), ?search= (title, owner name or email),
// ?owner=user|anonymous, ?issue=1 (only trips with a flagged place).
adminTripsRouter.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))

  const filtered = () => {
    const q = db('trips as t').leftJoin('users as u', 'u.id', 't.user_id')
    if (req.query.owner === 'user') q.whereNotNull('t.user_id')
    if (req.query.owner === 'anonymous') q.whereNull('t.user_id')
    if (req.query.issue === '1') q.whereRaw(ISSUE_SQL)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`
      q.where((w) => w
        .whereRaw("t.title ilike ? escape '\\'", [like])
        .orWhereRaw("u.email ilike ? escape '\\'", [like])
        .orWhereRaw("u.display_name ilike ? escape '\\'", [like]))
    }
    return q
  }

  const [{ count }] = await filtered().count('* as count')
  const rows = await filtered()
    .select('t.*', 'u.display_name as owner_name', 'u.email as owner_email', 'u.deleted_at as owner_deleted_at', db.raw(`${ISSUE_SQL} as has_issue`))
    .orderBy('t.created_at', 'desc').limit(pageSize).offset((page - 1) * pageSize)

  const summaries = await attachTripPreviews(rows)
  res.json({
    data: summaries.map((s, i) => ({ ...s, owner: ownerOf(rows[i]), hasIssue: rows[i].has_issue })),
    total: Number(count), page, pageSize, totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)),
  })
}))

adminTripsRouter.get('/:id', asyncHandler(async (req, res) => {
  const row = await db('trips as t').leftJoin('users as u', 'u.id', 't.user_id')
    .select('t.*', 'u.display_name as owner_name', 'u.email as owner_email', 'u.deleted_at as owner_deleted_at')
    .where('t.id', req.params.id).first()
  if (!row) throw httpError(404, 'ไม่พบแผนทริปนี้')
  res.json({ ...(await loadTripDetail(row)), owner: ownerOf(row) })
}))

// Permanent delete (days and items cascade), recorded in the admin audit log
// against the trip's owner so it shows up on that user's activity list.
adminTripsRouter.post('/:id/delete', asyncHandler(async (req, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : ''
  await db.transaction(async (trx) => {
    const row = await trx('trips').where('id', req.params.id).first()
    if (!row) throw httpError(404, 'ไม่พบแผนทริปนี้')
    await trx('trips').where('id', row.id).delete()
    await trx('admin_audit_log').insert({
      admin_id: req.user.id,
      action: 'trip.delete',
      target_user_id: row.user_id,
      details: JSON.stringify({ tripId: row.id, title: row.title, reason, anonymous: !row.user_id }),
    })
  })
  res.status(204).end()
}))
