import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rateLimit } from '../lib/rateLimit.js'
import { invalidateCache } from '../lib/crudRouter.js'
import { eventPayload } from '../lib/mappers.js'
import { db } from '../lib/db.js'
import { createImageUploadMiddleware } from '../lib/imageUpload.js'
import { uploadImageBuffer, deleteImage } from '../lib/cloudinary.js'

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const thaiParts = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { d, m: THAI_MONTHS[m - 1], y: y + 543 } }

// Display text for date_range when the requester only picked dates. Same
// format the admin form writes ("1-3 ธ.ค. 2569") -- see EventsTab.jsx.
function formatDateRange(startIso, endIso) {
  if (!startIso && !endIso) return ''
  if (!startIso || !endIso || startIso === endIso) { const s = thaiParts(startIso || endIso); return `${s.d} ${s.m} ${s.y}` }
  const s = thaiParts(startIso)
  const e = thaiParts(endIso)
  if (s.m === e.m && s.y === e.y) return `${s.d}-${e.d} ${s.m} ${s.y}`
  if (s.y === e.y) return `${s.d} ${s.m} - ${e.d} ${e.m} ${s.y}`
  return `${s.d} ${s.m} ${s.y} - ${e.d} ${e.m} ${e.y}`
}

const STATUSES = ['pending', 'approved', 'rejected']
const REQUEST_COLUMNS =['id', 'user_id', 'name', 'category', 'date_range', 'venue_name', 'admission', 'organizer', 'suitable_for', 'description', 'event_start_date', 'event_end_date', 'place_id', 'status', 'reject_reason', 'reviewed_at', 'event_id', 'created_at']

function rowToRequest(r) {
  return {
    id: r.id, name: r.name, category: r.category, dateRange: r.date_range, venueName: r.venue_name,
    admission: r.admission, organizer: r.organizer, suitableFor: r.suitable_for || [], desc: r.description,
    eventStartDate: r.event_start_date, eventEndDate: r.event_end_date, placeId: r.place_id,
    status: r.status, rejectReason: r.reject_reason, reviewedAt: r.reviewed_at, eventId: r.event_id, createdAt: r.created_at,
    img: r.photoUrls?.[0] || null, images: r.photoUrls || [],
  }
}

const MAX_PHOTOS_PER_REQUEST = 5

// One extra query for the whole page (not N+1): attaches each request's photo
// URLs as `photoUrls`, which rowToRequest() exposes as img/images.
async function attachPhotos(rows) {
  if (!rows.length) return rows
  const photos = await db('event_request_photos').select('request_id', 'url').whereIn('request_id', rows.map((r) => r.id)).orderBy(['request_id', 'position'])
  const byRequest = {}
  for (const p of photos) (byRequest[p.request_id] ??= []).push(p.url)
  return rows.map((r) => ({ ...r, photoUrls: byRequest[r.id] || [] }))
}

// Best-effort Cloudinary removal after the DB change has gone through.
async function deleteAssets(publicIds) {
  await Promise.allSettled(publicIds.filter(Boolean).map((id) => deleteImage(id)))
}

// The caller's own request, only while it is still pending (edit/cancel/photos).
async function ownPending(req) {
  const row = await db('event_requests').select('id').where({ id: req.params.id, user_id: req.user.id, status: 'pending' }).first()
  if (!row) throw httpError(404, 'ไม่พบคำขอที่แก้ไขได้')
  return row
}

// Requester-supplied fields only (never status/user_id from the body). Reuses
// eventPayload for the same validation and normalisation the admin form gets.
function requestPayload(body) {
  const p = eventPayload(body)
  if (p.event_start_date && !p.event_end_date) p.event_end_date = p.event_start_date
  if (!String(p.date_range ?? '').trim()) p.date_range = formatDateRange(p.event_start_date, p.event_end_date)
  for (const key of ['category', 'date_range', 'venue_name', 'admission', 'organizer']) {
    if (p[key] != null && String(p[key]).length > 200) throw httpError(400, 'ข้อมูลบางช่องยาวเกินไป (ไม่เกิน 200 ตัวอักษร)')
  }
  if (p.description != null && String(p.description).length > 3000) throw httpError(400, 'รายละเอียดยาวเกินไป (ไม่เกิน 3000 ตัวอักษร)')
  const { status: _status, ...fields } = p
  return fields
}

// ---------------------------------------------------------------------------
// Requester side: mounted at /api/event-requests
// ---------------------------------------------------------------------------
export const eventRequestsRouter = Router()

const submitLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' })
const MAX_PENDING_PER_USER = 5

eventRequestsRouter.post('/', requireAuth, submitLimit, asyncHandler(async (req, res) => {
  const fields = requestPayload(req.body || {})
  const { c } = await db('event_requests').where({ user_id: req.user.id, status: 'pending' }).count('id as c').first()
  if (Number(c) >= MAX_PENDING_PER_USER) throw httpError(429, `มีคำขอที่รออนุมัติอยู่ ${MAX_PENDING_PER_USER} รายการแล้ว กรุณารอการตรวจสอบก่อน`)
  const [row] = await db('event_requests').insert({ ...fields, user_id: req.user.id }).returning(REQUEST_COLUMNS)
  res.status(201).json(rowToRequest({ ...row, photoUrls: [] }))
}))

// The requester's own requests (all statuses), newest first.
eventRequestsRouter.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const q = () => {
    const b = db('event_requests').where('user_id', req.user.id)
    return STATUSES.includes(req.query.status) ? b.where('status', req.query.status) : b
  }
  const [{ count }] = await q().count('* as count')
  const rows = await q().select(REQUEST_COLUMNS).orderBy('created_at', 'desc').limit(pageSize).offset((page - 1) * pageSize)
  res.json({ data: (await attachPhotos(rows)).map(rowToRequest), total: Number(count), page, pageSize, totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) })
}))

// Edit while pending (same form as creating). Reviewed requests are history.
eventRequestsRouter.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  await ownPending(req)
  const fields = requestPayload(req.body || {})
  const [row] = await db('event_requests').where({ id: req.params.id, status: 'pending' }).update(fields).returning(REQUEST_COLUMNS)
  if (!row) throw httpError(409, 'คำขอนี้ถูกตรวจสอบไปแล้ว')
  res.json(rowToRequest((await attachPhotos([row]))[0]))
}))

// A pending request can be withdrawn; reviewed ones stay as history.
eventRequestsRouter.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await ownPending(req)
  const photos = await db('event_request_photos').select('public_id').where('request_id', req.params.id)
  const n = await db('event_requests').where({ id: req.params.id, user_id: req.user.id, status: 'pending' }).delete()
  if (!n) throw httpError(404, 'ไม่พบคำขอที่ยกเลิกได้')
  await deleteAssets(photos.map((p) => p.public_id))
  res.status(204).end()
}))

const photoUpload = createImageUploadMiddleware('photoFile')
const uploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, message: 'อัปโหลดรูปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' })

// The edit form uses this to show the current gallery (with ids to delete).
eventRequestsRouter.get('/:id/photos', requireAuth, asyncHandler(async (req, res) => {
  const owned = await db('event_requests').select('id').where({ id: req.params.id, user_id: req.user.id }).first()
  if (!owned) throw httpError(404, 'ไม่พบข้อมูล')
  res.json(await db('event_request_photos').select('id', 'url').where('request_id', req.params.id).orderBy('position'))
}))

eventRequestsRouter.post('/:id/photos', requireAuth, uploadLimit, photoUpload, asyncHandler(async (req, res) => {
  if (!req.file) throw httpError(400, 'กรุณาเลือกไฟล์รูปภาพ')
  await ownPending(req)
  const { c: count } = await db('event_request_photos').where('request_id', req.params.id).count('id as c').first()
  if (Number(count) >= MAX_PHOTOS_PER_REQUEST) throw httpError(400, `อัปโหลดได้สูงสุด ${MAX_PHOTOS_PER_REQUEST} รูปต่ออีเวนท์`)
  const result = await uploadImageBuffer(req.file.buffer, `dino/event-requests/${req.params.id}`)
  await db('event_request_photos').insert({ request_id: req.params.id, url: result.secure_url, public_id: result.public_id, position: Number(count) })
  const row = await db('event_requests').select(REQUEST_COLUMNS).where('id', req.params.id).first()
  res.status(201).json(rowToRequest((await attachPhotos([row]))[0]))
}))

eventRequestsRouter.delete('/:id/photos/:photoId', requireAuth, asyncHandler(async (req, res) => {
  await ownPending(req)
  const photo = await db('event_request_photos').select('public_id').where({ id: req.params.photoId, request_id: req.params.id }).first()
  if (!photo) throw httpError(404, 'ไม่พบข้อมูล')
  await db('event_request_photos').where({ id: req.params.photoId, request_id: req.params.id }).delete()
  await deleteAssets([photo.public_id])
  // Repack positions so the next upload's count-based position can't collide.
  const remaining = await db('event_request_photos').select('id').where('request_id', req.params.id).orderBy('position')
  await Promise.all(remaining.map((p, i) => db('event_request_photos').where('id', p.id).update({ position: i })))
  const row = await db('event_requests').select(REQUEST_COLUMNS).where('id', req.params.id).first()
  res.json(rowToRequest((await attachPhotos([row]))[0]))
}))

// ---------------------------------------------------------------------------
// Admin side: mounted at /api/admin/event-requests
// ---------------------------------------------------------------------------
export const adminEventRequestsRouter = Router()
adminEventRequestsRouter.use(requireAdmin)

adminEventRequestsRouter.get('/',asyncHandler(async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'pending'
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const [{ count }] = await db('event_requests').where('status', status).count('* as count')
  const rows = await db('event_requests as r').leftJoin('users as u', 'u.id', 'r.user_id')
    .select(REQUEST_COLUMNS.map((c) => `r.${c}`), 'u.display_name as requester', 'u.email as requester_email')
    .where('r.status', status)
    .orderBy('r.created_at', status === 'pending' ? 'asc' : 'desc') // oldest waiting first
    .limit(pageSize).offset((page - 1) * pageSize)
  res.json({
    data: (await attachPhotos(rows)).map((r) => ({ ...rowToRequest(r), requester: r.requester || '-', requesterEmail: r.requester_email || null })),
    total: Number(count), page, pageSize, totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)),
  })
}))

adminEventRequestsRouter.get('/count', asyncHandler(async (req, res) => {
  const [{ count }] = await db('event_requests').where('status', 'pending').count('* as count')
  res.json({ pending: Number(count) })
}))

// Copies the request into `events` (status 'upcoming', like any admin-created
// event) and marks it approved, atomically. The row lock makes a double-click
// or two admins approving at once create exactly one event.
adminEventRequestsRouter.post('/:id/approve', asyncHandler(async (req, res) => {
  const result = await db.transaction(async (trx) => {
    const r = await trx('event_requests').where('id', req.params.id).forUpdate().first()
    if (!r) throw httpError(404, 'ไม่พบคำขอ')
    if (r.status !== 'pending') throw httpError(409, 'คำขอนี้ถูกตรวจสอบไปแล้ว')
    const [event] = await trx('events').insert({
      name: r.name, category: r.category, date_range: r.date_range, venue_name: r.venue_name,
      admission: r.admission, organizer: r.organizer, suitable_for: r.suitable_for, description: r.description,
      event_start_date: r.event_start_date, event_end_date: r.event_end_date, place_id: r.place_id, status: 'upcoming',
    }).returning('id')
    // Photos move to the event's gallery (same Cloudinary assets), so they
    // show up with the event and the admin can still manage them there.
    const photos = await trx('event_request_photos').select('url', 'public_id', 'position').where('request_id', r.id).orderBy('position')
    if (photos.length) await trx('event_photos').insert(photos.map((p) => ({ event_id: event.id, url: p.url, public_id: p.public_id, position: p.position })))
    await trx('event_request_photos').where('request_id', r.id).delete()
    await trx('event_requests').where('id', r.id).update({ status: 'approved', reviewed_by: req.user.id, reviewed_at: trx.fn.now(), event_id: event.id })
    await trx('admin_audit_log').insert({
      admin_id: req.user.id, action: 'event_request.approve', target_user_id: r.user_id,
      details: JSON.stringify({ requestId: r.id, eventId: event.id, name: r.name }),
    })
    return { id: r.id, eventId: event.id }
  })
  // The list cache would otherwise hide the new event for up to its TTL.
  invalidateCache('events')
  res.json(result)
}))

adminEventRequestsRouter.post('/:id/reject', asyncHandler(async (req, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
  if (!reason) throw httpError(400, 'กรุณาระบุเหตุผลที่ปฏิเสธ')
  if (reason.length > 500) throw httpError(400, 'เหตุผลยาวเกินไป (ไม่เกิน 500 ตัวอักษร)')
  const publicIds = await db.transaction(async (trx) => {
    const r = await trx('event_requests').where('id', req.params.id).forUpdate().first()
    if (!r) throw httpError(404, 'ไม่พบคำขอ')
    if (r.status !== 'pending') throw httpError(409, 'คำขอนี้ถูกตรวจสอบไปแล้ว')
    const photos = await trx('event_request_photos').select('public_id').where('request_id', r.id)
    await trx('event_request_photos').where('request_id', r.id).delete()
    await trx('event_requests').where('id', r.id).update({ status: 'rejected', reject_reason: reason, reviewed_by: req.user.id, reviewed_at: trx.fn.now() })
    await trx('admin_audit_log').insert({
      admin_id: req.user.id, action: 'event_request.reject', target_user_id: r.user_id,
      details: JSON.stringify({ requestId: r.id, name: r.name, reason }),
    })
    return photos.map((p) => p.public_id)
  })
  await deleteAssets(publicIds)
  res.json({ id: req.params.id, status: 'rejected' })
}))
