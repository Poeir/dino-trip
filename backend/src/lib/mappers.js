// DB rows use snake_case; the frontend consumes camelCase. These mappers used
// to live in frontend/src/context/AppContext.jsx -- moved server-side so the
// API is the single place that knows about the DB column shape.
import { httpError } from '../middleware/errorHandler.js'

export function rowToPlace(row) {
  return {
    id: row.id,
    source: row.source,
    googlePlaceId: row.google_place_id,
    name: row.name,
    category: row.category,
    rating: row.rating,
    reviews: row.review_count,
    price: row.price,
    address: row.address,
    district: row.district,
    hours: row.hours,
    phone: row.phone,
    website: row.website,
    mapsUrl: row.maps_url,
    desc: row.description,
    amenities: row.amenities || [],
    tags: row.tags || [],
    hasQR: row.has_qr,
    qrPoints: row.qr_points,
    reviewsList: row.reviews || [],
    location: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null,
    isActive: row.is_active !== false,
    // An admin-uploaded gallery (row.uploadedPhotoUrls, attached by
    // places.routes.js's attachUploadedPhotos()) wins outright over whatever
    // was in `img`/`images` (a Google-imported gallery from import-places.js,
    // or nothing for an admin-added place) rather than merging the two --
    // once an admin has curated their own photos, those are the gallery.
    // Both are absolute Cloudinary URLs (src/lib/cloudinary.js) -- nothing
    // to resolve against the API's own origin.
    img: (row.uploadedPhotoUrls?.[0]) || row.img,
    images: (row.uploadedPhotoUrls?.length ? row.uploadedPhotoUrls : null) || (row.images && row.images.length ? row.images : (row.img ? [row.img] : [])),
    businessStatus: row.business_status,
    // Sync bookkeeping (admin badges). The parked Google values themselves are
    // only served by the admin place-sync endpoints, not on every public list.
    lockedFields: row.locked_fields || [],
    lastSyncedAt: row.last_synced_at || null,
    hasGoogleDiff: !!row.google_diff && Object.keys(row.google_diff).length > 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Today in Thailand as YYYY-MM-DD (event dates are plain date strings, see
// the pg DATE parser note in CLAUDE.md), independent of the server's timezone.
export function todayInBangkok() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

// Real-date status: cancelled (admin-set) wins, otherwise upcoming/ongoing/
// ended from event_start_date..event_end_date. null when the event has no
// start date, so the UI can fall back to showing nothing.
export function eventTimeStatus(row, today = todayInBangkok()) {
  if (row.status === 'cancelled') return 'cancelled'
  const start = row.event_start_date
  if (!start) return null
  const end = row.event_end_date || start
  if (today < start) return 'upcoming'
  if (today > end) return 'ended'
  return 'ongoing'
}

export function rowToEvent(row) {
  return {
    timeStatus: eventTimeStatus(row),
    id: row.id, name: row.name, category: row.category, dateRange: row.date_range, venueName: row.venue_name,
    admission: row.admission, organizer: row.organizer, suitableFor: row.suitable_for || [], desc: row.description,
    status: row.status,
    // row.uploadedPhotoUrls is attached by events.routes.js's
    // attachEventPhotos() -- falls back to the legacy single `img` column
    // (from before the gallery existed) for any event that still only has
    // that. `img` (first photo) is what list/card views and
    // EventDetailView.jsx already read; `images` is the full gallery for
    // whenever a public gallery view wants it (mirrors rowToPlace above).
    img: row.uploadedPhotoUrls?.[0] || row.img,
    images: row.uploadedPhotoUrls?.length ? row.uploadedPhotoUrls : (row.img ? [row.img] : []),
    eventStartDate: row.event_start_date, eventEndDate: row.event_end_date,
    // Optional link to an existing places row (see eventPayload below).
    placeId: row.place_id,
    // The vector itself never needs to leave the server -- admins only need
    // to know whether the RAG reindex has picked this row up yet.
    isEmbedded: row.embedding != null,
  }
}

export function rowToKb(row) {
  return { id: row.id, title: row.title, category: row.category, content: row.content, isPinned: row.is_pinned, isActive: row.is_active, isEmbedded: row.embedding != null }
}

export function rowToQr(row) {
  return {
    id: row.id,
    placeId: row.place_id,
    points: row.points,
    isActive: row.is_active !== false,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    radiusM: row.radius_m,
  }
}

const splitList = (v) => (Array.isArray(v) ? v : (v || '').split(',').map((s) => s.trim()).filter(Boolean))

// Inverse mappers: request body (camelCase form fields) -> DB row payload.
// Mirrors the payload-building blocks that used to be inline in
// AppContext.jsx's saveForm().

export function placePayload(body) {
  // lat/lng normally arrive as flat form fields (PlacesTab's LocationPicker),
  // but togglePlaceActive (AppContext.jsx) round-trips a place through this
  // same payload just to flip visibility, passing the API's own `location`
  // shape ({lat,lng}) instead -- accept either so that path doesn't null out
  // coordinates it never touched.
  const lat = body.lat != null && body.lat !== '' ? parseFloat(body.lat) : (body.location?.lat ?? null)
  const lng = body.lng != null && body.lng !== '' ? parseFloat(body.lng) : (body.location?.lng ?? null)
  const name = String(body.name ?? '').trim()
  if (!name) throw httpError(400, 'กรุณากรอกชื่อสถานที่')
  if (name.length > 200) throw httpError(400, 'ชื่อสถานที่ยาวเกินไป (ไม่เกิน 200 ตัวอักษร)')
  const rating = parseFloat(body.rating)
  if (Number.isFinite(rating) && (rating < 0 || rating > 5)) throw httpError(400, 'คะแนนต้องอยู่ระหว่าง 0 ถึง 5')
  const qrPoints = body.qrPoints === '' || body.qrPoints == null ? 0 : parseWholeNumber(body.qrPoints)
  if (!(qrPoints >= 0 && qrPoints <= QR_POINTS_MAX)) throw httpError(400, `พอยท์ QR ต้องเป็นจำนวนเต็ม 0 ถึง ${QR_POINTS_MAX}`)
  // Present-but-unreadable or out-of-range coordinates are an error, not a
  // silent "no location".
  const hasLat = (body.lat != null && body.lat !== '') || body.location?.lat != null
  const hasLng = (body.lng != null && body.lng !== '') || body.location?.lng != null
  if ((hasLat && !Number.isFinite(lat)) || (hasLng && !Number.isFinite(lng)) || (Number.isFinite(lat) && Math.abs(lat) > 90) || (Number.isFinite(lng) && Math.abs(lng) > 180)) {
    throw httpError(400, 'พิกัดไม่ถูกต้อง (ละติจูด -90 ถึง 90, ลองจิจูด -180 ถึง 180)')
  }
  return {
    name, category: body.category, rating: Number.isFinite(rating) && rating !== 0 ? rating : null,
    review_count: parseInt(body.reviews) || 0, price: body.price, address: body.address,
    hours: body.hours, phone: body.phone, description: body.desc,
    amenities: splitList(body.amenities), tags: splitList(body.tags),
    has_qr: !!body.hasQR, qr_points: qrPoints,
    lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
    // Defaults to visible/true unless explicitly turned off -- matches
    // openCreateForm's `isActive: true` default and lets any caller that
    // omits the field (older code paths) leave existing rows untouched.
    is_active: body.isActive !== false,
  }
}

const EVENT_STATUSES = ['upcoming', 'published', 'cancelled']

export function eventPayload(body) {
  const name = String(body.name ?? '').trim()
  if (!name) throw httpError(400, 'กรุณากรอกชื่ออีเวนท์')
  if (name.length > 200) throw httpError(400, 'ชื่ออีเวนท์ยาวเกินไป (ไม่เกิน 200 ตัวอักษร)')
  if (body.status != null && body.status !== '' && !EVENT_STATUSES.includes(body.status)) throw httpError(400, 'สถานะอีเวนท์ไม่ถูกต้อง')
  for (const key of ['eventStartDate', 'eventEndDate']) {
    if (body[key] && Number.isNaN(Date.parse(body[key]))) throw httpError(400, 'วันที่จัดงานไม่ถูกต้อง')
  }
  if (body.eventStartDate && body.eventEndDate && body.eventEndDate < body.eventStartDate) {
    throw httpError(400, 'วันที่สิ้นสุดต้องไม่มาก่อนวันที่เริ่มงาน')
  }
  return {
    name, category: body.category, date_range: body.dateRange, venue_name: body.venueName,
    admission: body.admission, organizer: body.organizer, suitable_for: splitList(body.suitableFor),
    description: body.desc, status: body.status || 'upcoming',
    event_start_date: body.eventStartDate || null, event_end_date: body.eventEndDate || null,
    place_id: body.placeId || null,
  }
}

export function kbPayload(body) {
  const title = String(body.title ?? '').trim()
  const content = String(body.content ?? '').trim()
  if (!title) throw httpError(400, 'กรุณากรอกหัวข้อ')
  if (title.length > 200) throw httpError(400, 'หัวข้อยาวเกินไป (ไม่เกิน 200 ตัวอักษร)')
  if (!content) throw httpError(400, 'กรุณากรอกเนื้อหา')
  return { title, category: body.category, content, is_pinned: !!body.isPinned, is_active: !!body.isActive }
}

export const QR_POINTS_MAX = 10000
export const QR_RADIUS_MIN_M = 20
export const QR_RADIUS_MAX_M = 5000
const REWARD_COST_MAX = 1000000

// Whole numbers only: parseInt would silently accept "12abc" or "3.9".
function parseWholeNumber(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : NaN
  return /^\d+$/.test(String(value ?? '').trim()) ? Number(String(value).trim()) : NaN
}

// Invalid input is rejected with a 400 that says what is wrong, instead of
// being quietly replaced with a default the admin never asked for.
export function qrPayload(body) {
  if (!body.placeId) throw httpError(400, 'กรุณาเลือกสถานที่')

  const points = parseWholeNumber(body.points)
  if (!(points >= 1 && points <= QR_POINTS_MAX)) throw httpError(400, `พอยท์ต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ${QR_POINTS_MAX}`)

  const radiusRaw = body.radiusM === '' || body.radiusM == null ? 200 : parseWholeNumber(body.radiusM)
  if (!(radiusRaw >= QR_RADIUS_MIN_M && radiusRaw <= QR_RADIUS_MAX_M)) {
    throw httpError(400, `รัศมีต้องอยู่ระหว่าง ${QR_RADIUS_MIN_M} ถึง ${QR_RADIUS_MAX_M} เมตร`)
  }

  let expiresAt = null
  if (body.expiresAt) {
    expiresAt = new Date(body.expiresAt)
    if (Number.isNaN(expiresAt.getTime())) throw httpError(400, 'วันและเวลาหมดอายุไม่ถูกต้อง')
  }

  return { place_id: body.placeId, points, is_active: body.isActive !== false, expires_at: expiresAt, radius_m: radiusRaw }
}

export function rewardPayload(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw httpError(400, 'กรุณากรอกชื่อของรางวัล')
  const cost = parseWholeNumber(body.cost)
  if (!(cost >= 1 && cost <= REWARD_COST_MAX)) throw httpError(400, `พอยท์ที่ใช้แลกต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ${REWARD_COST_MAX}`)
  // Blank stock = unlimited (null); 0 = sold out.
  let stock = null
  if (body.stock !== '' && body.stock != null) {
    stock = parseWholeNumber(body.stock)
    if (!(stock >= 0 && stock <= REWARD_COST_MAX)) throw httpError(400, `จำนวนคงเหลือต้องเป็นจำนวนเต็ม 0 ถึง ${REWARD_COST_MAX} (เว้นว่าง = ไม่จำกัด)`)
  }
  return { name, cost, stock }
}

export function rowToReward(row) {
  return { id: row.id, name: row.name, cost: row.cost, stock: row.stock ?? null, imageUrl: row.image_url || '' }
}
