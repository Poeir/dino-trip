import { crudRouter } from '../lib/crudRouter.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { rowToEvent, eventPayload } from '../lib/mappers.js'
import { forwardToChatbotService } from '../lib/chatbotProxy.js'
import { db } from '../lib/db.js'
import { createImageUploadMiddleware } from '../lib/imageUpload.js'
import { uploadImageBuffer, deleteImage } from '../lib/cloudinary.js'

// Includes `embedding` so rowToEvent() can report isEmbedded -- unlike
// places/knowledge_base, admins see this status per event (see
// EventsTab.jsx), so it has to actually reach the mapper. The raw vector
// itself never leaves rowToEvent(). `img` is only the pre-gallery legacy
// column now -- rowToEvent() prefers event_photos (attached below as
// `uploadedPhotoUrls`) and falls back to this for any row that predates it.
const EVENT_COLUMNS = 'id, name, category, date_range, venue_name, admission, organizer, suitable_for, description, status, event_start_date, event_end_date, place_id, embedding, img'
const EVENT_COLUMN_LIST = EVENT_COLUMNS.split(',').map((s) => s.trim())

// Matches places.routes.js's MAX_PHOTOS_PER_PLACE -- same gallery-size
// convention for both.
const MAX_PHOTOS_PER_EVENT = 5

// Batches in one extra query instead of N+1: attaches each event's uploaded
// photo URLs (if any) as `uploadedPhotoUrls`, which rowToEvent() then prefers
// over the legacy `img` column (see mappers.js).
async function attachEventPhotos(rows) {
  if (!rows.length) return rows
  const photos = await db('event_photos').select('id', 'event_id', 'url').whereIn('event_id', rows.map((r) => r.id)).orderBy(['event_id', 'position'])
  const byEvent = {}
  for (const p of photos) (byEvent[p.event_id] ??= []).push(p.url)
  return rows.map((r) => ({ ...r, uploadedPhotoUrls: byEvent[r.id] || [] }))
}

export const eventsRouter = crudRouter({
  table: 'events',
  select: EVENT_COLUMNS,
  order: { column: 'created_at' },
  toRow: eventPayload,
  toResponse: rowToEvent,
  mutateAuth: [requireAdmin],
  // name/category/venueName/suitableFor/desc feed the RAG embedding text
  // (chatbot-service/src/services/rag/embedder.py) -- any create/edit here
  // makes the stored vector stale until the admin dashboard's reindex button
  // recomputes it.
  invalidateColumns: ['embedding'],
  enrichRows: attachEventPhotos,
})

// LLM-extracts event form fields from a pasted Facebook post (see
// EventsTab.jsx's "paste text" box). Proxied through here instead of the
// browser calling chatbot-service directly -- that service has no auth of
// its own, so requireAdmin is what actually gates it.
eventsRouter.post('/extract', requireAdmin, asyncHandler(async (req, res) => {
  res.json(await forwardToChatbotService('/events/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: req.body.text }),
  }))
}))

const photoUpload = createImageUploadMiddleware('photoFile')

// The admin form uses this to render the current gallery (with per-photo ids
// to delete) when opening an existing event.
eventsRouter.get('/:id/photos', asyncHandler(async (req, res) => {
  const rows = await db('event_photos').select('id', 'url').where('event_id', req.params.id).orderBy('position')
  res.json(rows)
}))

eventsRouter.post('/:id/photos', requireAdmin, photoUpload, asyncHandler(async (req, res) => {
  if (!req.file) throw httpError(400, 'กรุณาเลือกไฟล์รูปภาพ')
  const eventId = req.params.id
  const event = await db('events').select('id').where('id', eventId).first()
  if (!event) throw httpError(404, 'ไม่พบข้อมูล')
  const { c: count } = await db('event_photos').where('event_id', eventId).count('id as c').first()
  if (Number(count) >= MAX_PHOTOS_PER_EVENT) throw httpError(400, `อัปโหลดได้สูงสุด ${MAX_PHOTOS_PER_EVENT} รูปต่ออีเวนท์`)
  const result = await uploadImageBuffer(req.file.buffer, `dino/events/${eventId}`)
  await db('event_photos').insert({ event_id: eventId, url: result.secure_url, public_id: result.public_id, position: Number(count) })

  const row = await db('events').select(EVENT_COLUMN_LIST).where('id', eventId).first()
  const [enriched] = await attachEventPhotos([row])
  res.status(201).json(rowToEvent(enriched))
}))

eventsRouter.delete('/:id/photos/:photoId', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db('event_photos').select('public_id').where({ id: req.params.photoId, event_id: req.params.id }).first()
  if (!photo) throw httpError(404, 'ไม่พบข้อมูล')
  await deleteImage(photo.public_id)
  await db('event_photos').where({ id: req.params.photoId, event_id: req.params.id }).delete()
  // Repack positions to stay contiguous (0..N-1) so the next upload's
  // count-based position doesn't collide with a gap left by the deletion.
  const remaining = await db('event_photos').select('id').where('event_id', req.params.id).orderBy('position')
  await Promise.all(remaining.map((p, i) => db('event_photos').where('id', p.id).update({ position: i })))

  const row = await db('events').select(EVENT_COLUMN_LIST).where('id', req.params.id).first()
  const [enriched] = await attachEventPhotos([row])
  res.json(rowToEvent(enriched))
}))
