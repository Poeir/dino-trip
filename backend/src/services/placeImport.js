import { db } from '../lib/db.js'
import { httpError } from '../middleware/errorHandler.js'
import { invalidateCache } from '../lib/crudRouter.js'
import { uploadImageBuffer, deleteImage } from '../lib/cloudinary.js'
import { placeToRow } from '../lib/googlePlaceRow.js'
import { GooglePlaceNotFound } from './placeSync.js'

// Admin "add a place from Google Maps": search Google, pick a result, and the
// place (plus its photos) is created as a hidden draft for the admin to review.
// Every call here is billable, so the callers are admin-only and rate limited.

const SEARCH_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.primaryType', 'places.businessStatus',
].join(',')

// Same Enterprise+Atmosphere mask as scripts/fetch-places.js, so the new row has
// every column a seeded one has (description, amenities, reviews, ...).
const DETAILS_FIELD_MASK = [
  'id', 'displayName', 'primaryType', 'types', 'rating', 'userRatingCount',
  'priceLevel', 'priceRange', 'formattedAddress', 'addressComponents',
  'regularOpeningHours', 'internationalPhoneNumber', 'websiteUri',
  'googleMapsUri', 'location',
  'editorialSummary', 'generativeSummary', 'reviews',
  'businessStatus', 'goodForChildren', 'parkingOptions', 'accessibilityOptions',
  'restroom', 'outdoorSeating', 'allowsDogs', 'delivery', 'takeout', 'dineIn',
  'curbsidePickup', 'reservable', 'paymentOptions', 'servesVegetarianFood',
  'servesBreakfast', 'servesLunch', 'servesDinner', 'servesBrunch',
  'servesCoffee', 'servesBeer', 'servesWine', 'servesCocktails', 'servesDessert',
  'menuForChildren', 'liveMusic', 'goodForGroups', 'goodForWatchingSports',
  'photos',
].join(',')

// Same gallery-size convention as places.routes.js / fetch-places.js.
const MAX_PHOTOS_PER_PLACE = 5

// Bias (not restrict) results towards Khon Kaen: a more specific query that
// names another province still finds its place.
const KHON_KAEN_BIAS = { circle: { center: { latitude: 16.4322, longitude: 102.8236 }, radius: 50000 } }

function apiKey() {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw httpError(503, 'ยังไม่ได้ตั้งค่า GOOGLE_PLACES_API_KEY บนเซิร์ฟเวอร์')
  return key
}

async function googleError(res, what) {
  // Body can echo request details; log it, but keep the message user-safe.
  console.error(`Places API ${res.status} (${what}):`, await res.text().catch(() => ''))
  return httpError(502, `Google Places API ตอบกลับ ${res.status}`)
}

export async function searchGooglePlaces(query) {
  const q = String(query ?? '').trim()
  if (q.length < 2) throw httpError(400, 'กรุณาพิมพ์คำค้นอย่างน้อย 2 ตัวอักษร')
  if (q.length > 200) throw httpError(400, 'คำค้นยาวเกินไป')

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': SEARCH_FIELD_MASK },
    body: JSON.stringify({ textQuery: q, languageCode: 'th', regionCode: 'TH', pageSize: 10, locationBias: KHON_KAEN_BIAS }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw await googleError(res, 'searchText')
  const places = (await res.json()).places || []

  // Flag the ones already in the DB so the admin doesn't import a duplicate.
  const existing = places.length
    ? await db('places').select('id', 'google_place_id').whereIn('google_place_id', places.map((p) => p.id))
    : []
  const byGoogleId = new Map(existing.map((r) => [r.google_place_id, r.id]))

  return places.map((p) => ({
    googlePlaceId: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
    primaryType: p.primaryType || null,
    businessStatus: p.businessStatus || null,
    existingPlaceId: byGoogleId.get(p.id) || null,
  }))
}

async function fetchDetails(googlePlaceId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}?languageCode=th&regionCode=TH`, {
    headers: { 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404) throw new GooglePlaceNotFound('Google ไม่พบสถานที่นี้')
  if (!res.ok) throw await googleError(res, `details ${googlePlaceId}`)
  return res.json()
}

// Photo `name` values expire and can't be cached -- resolve + download right
// after the Details call. A failed photo is skipped, not fatal.
async function downloadPhoto(photoName) {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1200`, {
      headers: { 'X-Goog-Api-Key': apiKey() },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) { console.error(`Photo download failed (${res.status}) for ${photoName}`); return null }
    return Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.error(`Photo download failed for ${photoName}:`, err.message)
    return null
  }
}

// Creates the place from Google as a hidden draft (is_active=false) with its
// photos in place_photos (so the admin gallery can reorder/delete them like an
// uploaded one). Returns { id, created: true }, or { id, created: false } if
// that Google place is already in the DB.
export async function importGooglePlace(googlePlaceId, actorId) {
  const gid = String(googlePlaceId ?? '').trim()
  if (!gid || gid.length > 300) throw httpError(400, 'google place id ไม่ถูกต้อง')

  const dup = await db('places').select('id').where('google_place_id', gid).first()
  if (dup) return { id: dup.id, created: false }

  const details = await fetchDetails(gid)
  // Create first (hidden), then attach photos: the Cloudinary folder needs the
  // new place's id, and a photo failure must not lose the place.
  const row = { ...placeToRow(details), is_active: false }
  let place
  try {
    ;[place] = await db('places').insert(row).returning(['id', 'name'])
  } catch (err) {
    // Lost a race with a concurrent import of the same place (unique google_place_id).
    if (err.code === '23505') {
      const again = await db('places').select('id').where('google_place_id', gid).first()
      if (again) return { id: again.id, created: false }
    }
    throw err
  }

  const uploaded = []
  try {
    for (const photo of (details.photos || []).slice(0, MAX_PHOTOS_PER_PLACE)) {
      const bytes = await downloadPhoto(photo.name)
      if (!bytes) continue
      const result = await uploadImageBuffer(bytes, `dino/places/${place.id}`)
      uploaded.push({ place_id: place.id, url: result.secure_url, public_id: result.public_id, position: uploaded.length })
    }
    if (uploaded.length) await db('place_photos').insert(uploaded)
  } catch (err) {
    console.error(`Photo import failed for place ${place.id}:`, err)
    // Don't leave orphaned Cloudinary assets that no place_photos row points at.
    await Promise.all(uploaded.map((u) => deleteImage(u.public_id).catch(() => {})))
    uploaded.length = 0
  }

  await db('admin_audit_log').insert({
    admin_id: actorId, action: 'place.import_google',
    details: JSON.stringify({ placeId: place.id, name: place.name, googlePlaceId: gid, photos: uploaded.length }),
  })
  invalidateCache('places')
  return { id: place.id, created: true, photos: uploaded.length }
}
