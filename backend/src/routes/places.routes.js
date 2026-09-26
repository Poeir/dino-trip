import { crudRouter, invalidateCache, getCached, setCached } from '../lib/crudRouter.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rowToPlace, placePayload } from '../lib/mappers.js'
import { sortPlacesByWeightedRating } from '../services/placeRanking.js'
import { db } from '../lib/db.js'
import { galleryCleanup } from '../lib/cloudinaryCleanup.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { createImageUploadMiddleware } from '../lib/imageUpload.js'
import { uploadImageBuffer, deleteImage } from '../lib/cloudinary.js'

// Excludes `embedding` (384-float pgvector column, RAG-only) and
// `hours_periods`/`price_level` -- the frontend doesn't read them.
export const PLACE_COLUMNS = 'id, source, google_place_id, name, category, rating, review_count, price, address, district, hours, phone, website, maps_url, lat, lng, description, amenities, tags, has_qr, qr_points, img, images, reviews, business_status, is_active, created_at, updated_at'

// Matches fetch-places.js's own MAX_PHOTOS_PER_PLACE -- same gallery-size
// convention for admin-uploaded photos as Google-imported ones.
const MAX_PHOTOS_PER_PLACE = 5

// Batches in one extra query instead of N+1: attaches each place's uploaded
// photo URLs (if any) as `uploadedPhotoUrls`, which rowToPlace() then prefers
// over the stored `img`/`images` (a Google-imported gallery, or nothing for
// an admin-added place) -- see mappers.js for why uploads win outright
// rather than merging with Google's photos.
export async function attachUploadedPhotos(rows) {
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
  beforeDelete: galleryCleanup('place_photos', 'place_id'),
  // ?search= (PlacesTab/PlacesListPage's search box), ?category= (exact
  // match, both admin sort dropdown and the public category chips),
  // ?isActive=true (PlacesListPage only -- admin sees hidden places too, so
  // it never sends this param), ?hasQR=true (PointsPage's QR-places list),
  // and ?ids= (AppContext's post-trip-plan QR-points lookup, batched by id
  // instead of one `GET /:id` per place in the plan).
  searchColumns: ['name', 'address'],
  // PlacesTab's sort dropdown (name/rating) -- distinct from the weighted
  // ranking sortRows uses when no explicit sort is requested (see
  // crudRouter.js).
  sortable: ['name', 'rating'],
  filters: (query, q) => {
    if (q.category) query = query.where('category', q.category)
    if (q.isActive != null) query = query.where('is_active', q.isActive === 'true')
    if (q.hasQR != null) query = query.where('has_qr', q.hasQR === 'true')
    if (q.ids) query = query.whereIn('id', String(q.ids).split(','))
    return query
  },
})

// Lean id+name listing for EventsTab's venue-name <datalist> -- nested two
// segments deep (not a flat `/names`) so it can't be shadowed by crudRouter's
// generic `GET /:id`, which is registered first and would otherwise treat
// "names" as an id. Shares crudRouter's cache map via getCached/setCached --
// the `places/` prefix means every invalidateCache('places') call already in
// this file clears it too (see crudRouter.js's invalidateCache).
const PLACES_NAMES_CACHE_KEY = 'places/meta/names'
placesRouter.get('/meta/names', asyncHandler(async (req, res) => {
  const cached = getCached(PLACES_NAMES_CACHE_KEY)
  if (cached) return res.json(cached)
  const rows = await db('places').select('id', 'name').orderBy('name')
  setCached(PLACES_NAMES_CACHE_KEY, rows)
  res.json(rows)
}))

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
  invalidateCache('places')
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
  invalidateCache('places')
  res.json(rowToPlace(enriched))
}))
