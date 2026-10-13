import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rateLimit } from '../lib/rateLimit.js'
import { db } from '../lib/db.js'

// Mirrors the CHECK constraint in 20260930000001_event_reports.sql.
export const EVENT_REPORT_FIELDS = ['name', 'date', 'venue', 'admission', 'status', 'organizer', 'photos', 'other']

// ---------------------------------------------------------------------------
// Tourist side: mounted under /api/events (POST /:id/reports, GET /:id/reports/mine)
// ---------------------------------------------------------------------------
export const eventReportsRouter = Router()

const reportLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'ส่งรายงานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' })

// Body: { fields: string[], note? } -- one report row per field, sharing the
// note (same shape as place reports). Only points at what is wrong; the event
// itself is never changed here.
eventReportsRouter.post('/:id/reports', requireAuth, reportLimit, asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.body?.fields) ? req.body.fields : (req.body?.field ? [req.body.field] : [])
  const fields = [...new Set(raw)]
  if (!fields.length || !fields.every((f) => EVENT_REPORT_FIELDS.includes(f))) throw httpError(400, 'กรุณาเลือกข้อมูลที่ไม่ถูกต้อง')
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
  if (note.length > 500) throw httpError(400, 'หมายเหตุยาวเกินไป (ไม่เกิน 500 ตัวอักษร)')
  if (fields.includes('other') && !note) throw httpError(400, 'กรุณาอธิบายปัญหาที่พบ')

  const event = await db('events').select('id').where('id', req.params.id).first()
  if (!event) throw httpError(404, 'ไม่พบกิจกรรม')

  const open = new Set((await db('event_reports').select('field').where({ event_id: event.id, user_id: req.user.id, status: 'pending' })).map((r) => r.field))
  const fresh = fields.filter((f) => !open.has(f))
  if (!fresh.length) throw httpError(409, 'คุณรายงานข้อมูลเหล่านี้ไปแล้ว ทีมงานกำลังตรวจสอบ')

  try {
    await db('event_reports').insert(fresh.map((field) => ({ event_id: event.id, user_id: req.user.id, field, note: note || null })))
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'คุณรายงานข้อมูลเหล่านี้ไปแล้ว ทีมงานกำลังตรวจสอบ')
    throw err
  }
  res.status(201).json({ ok: true, created: fresh.length, skipped: fields.length - fresh.length })
}))

eventReportsRouter.get('/:id/reports/mine', requireAuth, asyncHandler(async (req, res) => {
  const rows = await db('event_reports').select('field').where({ event_id: req.params.id, user_id: req.user.id, status: 'pending' })
  res.json({ pendingFields: rows.map((r) => r.field) })
}))

// ---------------------------------------------------------------------------
// Admin side: mounted at /api/admin/event-reports
// ---------------------------------------------------------------------------
export const adminEventReportsRouter = Router()
adminEventReportsRouter.use(requireAdmin)

const STATUSES = ['pending', 'resolved', 'rejected']

// Reports grouped per event. ?status= (default pending), ?page&limit (max 50).
adminEventReportsRouter.get('/', asyncHandler(async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'pending'
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))

  const [{ count }] = await db('event_reports').where('status', status).countDistinct('event_id as count')
  const groups = await db('event_reports').select('event_id').count('* as total').max('created_at as latest')
    .where('status', status).groupBy('event_id')
    .orderBy([{ column: 'total', order: 'desc' }, { column: 'latest', order: 'desc' }])
    .limit(pageSize).offset((page - 1) * pageSize)

  const eventIds = groups.map((g) => g.event_id)
  const [events, reports] = eventIds.length ? await Promise.all([
    db('events').select('id', 'name', 'date_range', 'venue_name', 'status').whereIn('id', eventIds),
    db('event_reports as r').leftJoin('users as u', 'u.id', 'r.user_id')
      .select('r.id', 'r.event_id', 'r.field', 'r.note', 'r.status', 'r.resolution', 'r.created_at', 'u.display_name as reporter')
      .whereIn('r.event_id', eventIds).where('r.status', status).orderBy('r.created_at', 'desc'),
  ]) : [[], []]

  const eventById = new Map(events.map((e) => [e.id, e]))
  res.json({
    data: groups.map((g) => {
      const e = eventById.get(g.event_id)
      const mine = reports.filter((r) => r.event_id === g.event_id)
      const fields = {}
      for (const r of mine) fields[r.field] = (fields[r.field] || 0) + 1
      return {
        event: e && { id: e.id, name: e.name, dateRange: e.date_range, venueName: e.venue_name, status: e.status },
        total: Number(g.total),
        fields,
        reports: mine.map((r) => ({ id: r.id, field: r.field, note: r.note, status: r.status, resolution: r.resolution, createdAt: r.created_at, reporter: r.reporter || '-' })),
      }
    }),
    total: Number(count), page, pageSize, totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)),
  })
}))

adminEventReportsRouter.get('/count', asyncHandler(async (req, res) => {
  const [{ count }] = await db('event_reports').where('status', 'pending').count('* as count')
  res.json({ pending: Number(count) })
}))

// Closes every pending report for one event + field together.
//   body: { eventId, field, status: 'resolved' | 'rejected', resolution?: 'edited' | 'no_change' }
adminEventReportsRouter.post('/resolve', asyncHandler(async (req, res) => {
  const { eventId, field, status, resolution } = req.body || {}
  if (!EVENT_REPORT_FIELDS.includes(field)) throw httpError(400, 'ฟิลด์ไม่ถูกต้อง')
  if (!['resolved', 'rejected'].includes(status)) throw httpError(400, 'สถานะไม่ถูกต้อง')
  if (status === 'resolved' && !['edited', 'no_change'].includes(resolution)) throw httpError(400, 'กรุณาระบุวิธีจัดการ')

  const closed = await db.transaction(async (trx) => {
    const rows = await trx('event_reports').where({ event_id: eventId, field, status: 'pending' })
      .update({ status, resolution: status === 'resolved' ? resolution : null, resolved_by: req.user.id, resolved_at: trx.fn.now() })
      .returning('id')
    if (!rows.length) throw httpError(404, 'ไม่พบรายงานที่รอตรวจสอบ')
    await trx('admin_audit_log').insert({
      admin_id: req.user.id, action: 'event.report_resolve',
      details: JSON.stringify({ eventId, field, status, resolution: resolution || null, count: rows.length }),
    })
    return rows.length
  })
  res.json({ closed })
}))
