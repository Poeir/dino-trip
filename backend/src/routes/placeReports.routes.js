import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rateLimit } from '../lib/rateLimit.js'
import { db } from '../lib/db.js'
import { REPORT_FIELDS } from '../lib/placeFields.js'

// ---------------------------------------------------------------------------
// Tourist side: mounted under /api/places (POST /:id/reports, GET /:id/reports/mine)
// ---------------------------------------------------------------------------
export const placeReportsRouter = Router()

// A report only points at a field; it never changes the place. Login is
// required (like trips) so spam is attributable, plus a per-user budget.
const reportLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'ส่งรายงานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' })

// Body: { fields: string[], note? } -- several wrong fields can be flagged in
// one submit, each becoming its own report row (the admin queue resolves them
// per field) sharing the same note. A single `field` string is still accepted.
placeReportsRouter.post('/:id/reports', requireAuth, reportLimit, asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.body?.fields) ? req.body.fields : (req.body?.field ? [req.body.field] : [])
  const fields = [...new Set(raw)]
  if (!fields.length || !fields.every((f) => REPORT_FIELDS.includes(f))) throw httpError(400, 'กรุณาเลือกข้อมูลที่ไม่ถูกต้อง')
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
  if (note.length > 500) throw httpError(400, 'หมายเหตุยาวเกินไป (ไม่เกิน 500 ตัวอักษร)')
  if (fields.includes('other') && !note) throw httpError(400, 'กรุณาอธิบายปัญหาที่พบ')

  const place = await db('places').select('id').where({ id: req.params.id, is_active: true }).first()
  if (!place) throw httpError(404, 'ไม่พบสถานที่')

  // Skip fields this user already has open; if that leaves nothing, say so.
  const open = new Set((await db('place_reports').select('field').where({ place_id: place.id, user_id: req.user.id, status: 'pending' })).map((r) => r.field))
  const fresh = fields.filter((f) => !open.has(f))
  if (!fresh.length) throw httpError(409, 'คุณรายงานข้อมูลเหล่านี้ไปแล้ว ทีมงานกำลังตรวจสอบ')

  try {
    await db('place_reports').insert(fresh.map((field) => ({ place_id: place.id, user_id: req.user.id, field, note: note || null })))
  } catch (err) {
    // Lost a race with a double submit: the unique index still holds.
    if (err.code === '23505') throw httpError(409, 'คุณรายงานข้อมูลเหล่านี้ไปแล้ว ทีมงานกำลังตรวจสอบ')
    throw err
  }
  res.status(201).json({ ok: true, created: fresh.length, skipped: fields.length - fresh.length })
}))

// Which fields the current user already has an open report for, so the form
// can grey them out instead of letting them hit the 409.
placeReportsRouter.get('/:id/reports/mine', requireAuth, asyncHandler(async (req, res) => {
  const rows = await db('place_reports').select('field').where({ place_id: req.params.id, user_id: req.user.id, status: 'pending' })
  res.json({ pendingFields: rows.map((r) => r.field) })
}))

// ---------------------------------------------------------------------------
// Admin side: mounted at /api/admin/place-reports
// ---------------------------------------------------------------------------
export const adminPlaceReportsRouter = Router()
adminPlaceReportsRouter.use(requireAdmin)

const STATUSES = ['pending', 'resolved', 'rejected', 'superseded']

// Reports grouped per place so "hours x 5" reads as one work item.
// ?status= (default pending), ?page&limit (default 20, max 50).
adminPlaceReportsRouter.get('/', asyncHandler(async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'pending'
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))

  const [{ count }] = await db('place_reports').where('status', status).countDistinct('place_id as count')
  const groups = await db('place_reports').select('place_id').count('* as total').max('created_at as latest')
    .where('status', status).groupBy('place_id')
    .orderBy([{ column: 'total', order: 'desc' }, { column: 'latest', order: 'desc' }])
    .limit(pageSize).offset((page - 1) * pageSize)

  const placeIds = groups.map((g) => g.place_id)
  const [places, reports] = placeIds.length ? await Promise.all([
    db('places').select('id', 'name', 'district', 'business_status', 'is_active', 'google_place_id', 'locked_fields', 'google_diff', 'last_synced_at').whereIn('id', placeIds),
    db('place_reports as r').leftJoin('users as u', 'u.id', 'r.user_id')
      .select('r.id', 'r.place_id', 'r.field', 'r.note', 'r.status', 'r.resolution', 'r.created_at', 'u.display_name as reporter')
      .whereIn('r.place_id', placeIds).where('r.status', status).orderBy('r.created_at', 'desc'),
  ]) : [[], []]

  const placeById = new Map(places.map((p) => [p.id, p]))
  res.json({
    data: groups.map((g) => {
      const p = placeById.get(g.place_id)
      const mine = reports.filter((r) => r.place_id === g.place_id)
      const fields = {}
      for (const r of mine) fields[r.field] = (fields[r.field] || 0) + 1
      return {
        place: p && {
          id: p.id, name: p.name, district: p.district, businessStatus: p.business_status, isActive: p.is_active,
          hasGoogleId: !!p.google_place_id, lockedFields: p.locked_fields, lastSyncedAt: p.last_synced_at,
          googleDiff: p.google_diff,
        },
        total: Number(g.total),
        fields,
        reports: mine.map((r) => ({ id: r.id, field: r.field, note: r.note, status: r.status, resolution: r.resolution, createdAt: r.created_at, reporter: r.reporter || '-' })),
      }
    }),
    total: Number(count), page, pageSize, totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)),
  })
}))

// Badge for the admin sidebar.
adminPlaceReportsRouter.get('/count', asyncHandler(async (req, res) => {
  const [{ count }] = await db('place_reports').where('status', 'pending').count('* as count')
  res.json({ pending: Number(count) })
}))

// Closes every pending report for one place + field together, since that is
// how the queue presents them.
//   body: { placeId, field, status: 'resolved' | 'rejected', resolution?: 'edited' | 'synced' | 'no_change' }
adminPlaceReportsRouter.post('/resolve', asyncHandler(async (req, res) => {
  const { placeId, field, status, resolution } = req.body || {}
  if (!REPORT_FIELDS.includes(field)) throw httpError(400, 'ฟิลด์ไม่ถูกต้อง')
  if (!['resolved', 'rejected'].includes(status)) throw httpError(400, 'สถานะไม่ถูกต้อง')
  if (status === 'resolved' && !['edited', 'synced', 'no_change'].includes(resolution)) throw httpError(400, 'กรุณาระบุวิธีจัดการ')

  const closed = await db.transaction(async (trx) => {
    const rows = await trx('place_reports').where({ place_id: placeId, field, status: 'pending' })
      .update({ status, resolution: status === 'resolved' ? resolution : null, resolved_by: req.user.id, resolved_at: trx.fn.now() })
      .returning('id')
    if (!rows.length) throw httpError(404, 'ไม่พบรายงานที่รอตรวจสอบ')
    await trx('admin_audit_log').insert({
      admin_id: req.user.id, action: 'place.report_resolve',
      details: JSON.stringify({ placeId, field, status, resolution: resolution || null, count: rows.length }),
    })
    return rows.length
  })
  res.json({ closed })
}))
