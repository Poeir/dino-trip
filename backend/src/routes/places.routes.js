import { crudRouter } from '../lib/crudRouter.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rowToPlace, placePayload } from '../lib/mappers.js'
import { sortPlacesByWeightedRating } from '../services/placeRanking.js'
import { db } from '../lib/db.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { createImageUploadMiddleware } from '../lib/imageUpload.js'
import { uploadImageBuffer, deleteImage } from '../lib/cloudinary.js'

// Excludes `embedding` (384-float pgvector column, RAG-only) and
// `hours_periods`/`price_level` -- the frontend doesn't read them.
const PLACE_COLUMNS = 'id, source, google_place_id, name, category, rating, review_count, price, address, district, hours, phone, website, maps_url, lat, lng, description, amenities, tags, has_qr, qr_points, img, images, reviews, business_status, is_active, created_at, updated_at'

// Matches fetch-places.js's own MAX_PHOTOS_PER_PLACE -- same gallery-size
// convention for admin-uploaded photos as Google-imported ones.
const MAX_PHOTOS_PER_PLACE = 5

// Batches in one extra query instead of N+1: attaches each place's uploaded
// photo URLs (if any) as `uploadedPhotoUrls`, which rowToPlace() then prefers
// over the stored `img`/`images` (a Google-imported gallery, or nothing for
// an admin-added place) -- see mappers.js for why uploads win outright
// rather than merging with Google's photos.
async function attachUploadedPhotos(rows) {
  if (!rows.length) return rows
  const photos = await db('place_photos').select('id', 'place_id', 'url').whereIn('place_id', rows.map((r) => r.id)).orderBy(['place_id', 'position'])
  const byPlace = {}
  for (const p of photos) (byPlace[p.place_id] ??= []).push(p.url)
  return rows.map((r) => ({ ...r, uploadedPhotoUrls: byPlace[r.id] || [] }))
}

export const placesRouter = crudRouter({
  table: 'places',
  select: PLACE_COLUMNS,
  sortRows: sortPlacesByWeightedRating,
  toRow: placePayload,
  toResponse: rowToPlace,
  mutateAuth: [requireAdmin],
  // name/category/tags/description/amenities feed the RAG embedding text
  // (chatbot-service/src/services/rag/embedder.py) -- any create/edit here
  // makes the stored vector stale until the admin dashboard's reindex button
  // (or scripts/embed_content.py) recomputes it.
  invalidateColumns: ['embedding'],
  enrichRows: attachUploadedPhotos,
})

const photoUpload = createImageUploadMiddleware('photoFile')

// The admin form uses this to render the current gallery (with per-photo ids
// to delete) when opening an existing place.
placesRouter.get('/:id/photos', asyncHandler(async (req, res) => {
  const rows = await db('place_photos').select('id', 'url').where('place_id', req.params.id).orderBy('position')
  res.json(rows)
}))

placesRouter.post('/:id/photos', requireAdmin, photoUpload, asyncHandler(async (req, res) => {
  if (!req.file) throw httpError(400, 'กรุณาเลือกไฟล์รูปภาพ')
  const placeId = req.params.id
  const place = await db('places').select('id').where('id', placeId).first()
  if (!place) throw httpError(404, 'ไม่พบข้อมูล')
  const { c: count } = await db('place_photos').where('place_id', placeId).count('id as c').first()
  if (Number(count) >= MAX_PHOTOS_PER_PLACE) throw httpError(400, `อัปโหลดได้สูงสุด ${MAX_PHOTOS_PER_PLACE} รูปต่อสถานที่`)
  const result = await uploadImageBuffer(req.file.buffer, `dino/places/${placeId}`)
  await db('place_photos').insert({ place_id: placeId, url: result.secure_url, public_id: result.public_id, position: Number(count) })

  const row = await db('places').select(PLACE_COLUMNS.split(',').map((s) => s.trim())).where('id', placeId).first()
  const [enriched] = await attachUploadedPhotos([row])
  res.status(201).json(rowToPlace(enriched))
}))

placesRouter.delete('/:id/photos/:photoId', requireAdmin, asyncHandler(async (req, res) => {
  const photo = await db('place_photos').select('public_id').where({ id: req.params.photoId, place_id: req.params.id }).first()
  if (!photo) throw httpError(404, 'ไม่พบข้อมูล')
  await deleteImage(photo.public_id)
  await db('place_photos').where({ id: req.params.photoId, place_id: req.params.id }).delete()
  // Repack positions to stay contiguous (0..N-1) so the next upload's
  // count-based position doesn't collide with a gap left by the deletion.
  const remaining = await db('place_photos').select('id').where('place_id', req.params.id).orderBy('position')
  await Promise.all(remaining.map((p, i) => db('place_photos').where('id', p.id).update({ position: i })))

  const row = await db('places').select(PLACE_COLUMNS.split(',').map((s) => s.trim())).where('id', req.params.id).first()
  const [enriched] = await attachUploadedPhotos([row])
  res.json(rowToPlace(enriched))
}))
