// Imports backend/data/places.json (raw Google Places API dump, produced by
// `npm run fetch:places`) -> Postgres `places` table (via DATABASE_URL), source='google'.
// Upserts on google_place_id, so re-running with a freshly fetched dump is
// safe to repeat. A place already in the DB only gets its Google-sourced,
// time-varying fields refreshed (see mergeColumns below) -- curated fields
// (LLM-written description, tags, category, QR, is_active, photos) are kept.
//
// Usage: cd backend && npm run import:places

import 'dotenv/config'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { db } from '../src/lib/db.js'
import { uploadImageBuffer } from '../src/lib/cloudinary.js'
import { placeToRow } from '../src/lib/googlePlaceRow.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PHOTOS_DIR = join(__dirname, '..', 'data', 'photos')

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL. Copy backend/.env.example to backend/.env and fill it in.')
  process.exit(1)
}

// Uploads the photos fetch-places.js already downloaded for this place (if
// any) to Cloudinary, so `images` points at URLs we control instead of
// Google's (expiring, API-key-bearing) photo endpoint.
async function uploadPhotos(placeId) {
  const dir = join(PHOTOS_DIR, placeId)
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
  const urls = []
  for (const file of files) {
    try {
      const result = await uploadImageBuffer(readFileSync(join(dir, file)), `dino/places/${placeId}`)
      urls.push(result.secure_url)
    } catch (err) {
      console.error(`  Photo upload failed for ${placeId}/${file}:`, err.message)
    }
  }
  return urls
}

// Same stand-in map used by the frontend's temporary client-side transform.
// TODO: once the admin QR tab writes to the `qrs` table directly, this can go away.
const qrPointsByName = {
  'วัดทุ่งเศรษฐี': 20,
  'พระมหาธาตุแก่นนคร': 25,
  'สวนนันทนา ขอนแก่น': 10,
  'บึงหนองโคตร': 10,
  'บึงแก่นนคร (เมืองขอนแก่น)': 15,
}


async function toRow(p, hasPhotos) {
  const name = p.displayName?.text || 'ไม่ทราบชื่อสถานที่'
  const row = placeToRow(p, { qrPoints: qrPointsByName[name] || 0, fallbackImg: FALLBACK_IMG,
    // Already on Cloudinary -> the upsert keeps the existing images anyway, so
    // don't re-upload (stale data/photos/<id> dirs from earlier runs would
    // otherwise duplicate every gallery on Cloudinary).
    images: hasPhotos.has(p.id) ? [] : await uploadPhotos(p.id) })
  // No category match (a dam typed `government_office`, a farm, ...) -> keep
  // it out of search/trip planning until an admin sets a category and
  // activates it. Only applies on insert: is_active isn't in mergeColumns.
  row.is_active = !!row.category
  return row
}

const FALLBACK_IMG = '/assets/picture01.jpg'

// Refreshed from Google on every re-import: these drift over time (ratings,
// reviews, hours, closures) and nobody edits them by hand.
const REFRESH_COLUMNS = [
  'name', 'rating', 'review_count', 'price_level', 'price', 'address', 'district',
  'hours', 'hours_periods', 'phone', 'website', 'maps_url', 'lat', 'lng',
  'amenities', 'reviews', 'business_status', 'raw_data',
]

// ON CONFLICT DO UPDATE set-list. Anything not listed here (has_qr,
// qr_points, is_active, source, ...) is left exactly as it is in the DB.
function mergeColumns() {
  const merge = {}
  for (const col of REFRESH_COLUMNS) merge[col] = db.raw('excluded.??', [col])
  // Kept once set -- description may be LLM-written by
  // chatbot-service/scripts/generate_descriptions.py, tags/category may be
  // hand-corrected in the admin tab.
  merge.description = db.raw('coalesce(places.description, excluded.description)')
  merge.category = db.raw('coalesce(places.category, excluded.category)')
  merge.tags = db.raw('case when coalesce(cardinality(places.tags), 0) = 0 then excluded.tags else places.tags end')
  // Photos: only replace the placeholder, never real existing photos.
  const noPhoto = `(places.img is null or places.img = '${FALLBACK_IMG}')`
  merge.img = db.raw(`case when ${noPhoto} then excluded.img else places.img end`)
  merge.images = db.raw(`case when ${noPhoto} then excluded.images else places.images end`)
  // chatbot-service's embedder re-embeds rows whose embedding is null. Only
  // clear it when a column that feeds the embedding text (name, category,
  // tags, description, amenities -- see embedder.py place_text) changed.
  merge.embedding = db.raw(`case when places.name is distinct from excluded.name
    or places.amenities is distinct from excluded.amenities
    or places.description is null or places.category is null
    or coalesce(cardinality(places.tags), 0) = 0
    then null else places.embedding end`)
  return merge
}

async function main() {
  const jsonPath = join(__dirname, '..', 'data', 'places.json')
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const existing = await db('places').select('google_place_id', 'img').whereIn('google_place_id', raw.map((p) => p.id))
  const hasPhotos = new Set(existing.filter((r) => r.img?.includes('res.cloudinary.com')).map((r) => r.google_place_id))
  console.log(`${existing.length} of ${raw.length} already in DB (will be refreshed), ${raw.length - existing.length} new.`)
  const rows = await Promise.all(raw.map((p) => toRow(p, hasPhotos)))

  const needsReview = rows.filter((r) => !r.category)
  console.log(`Importing ${rows.length} places (${needsReview.length} need manual category review)...`)

  // Chunked instead of one giant upsert -- a single bad row (e.g. malformed
  // unicode Postgres rejects) fails only its own chunk of 50, not all ~400.
  const CHUNK_SIZE = 50
  const data = []
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    try {
      const d = await db('places')
        .insert(chunk)
        .onConflict('google_place_id')
        .merge(mergeColumns())
        .returning(['id', 'name', 'category'])
      data.push(...d)
    } catch (err) {
      console.error(`Chunk ${i}-${i + chunk.length} failed: ${err.message}`)
      console.error('Places in this chunk:', chunk.map((r) => r.name).join(', '))
    }
  }

  console.log(`Done. Upserted ${data.length} places.`)
  if (needsReview.length) {
    console.log('Review these in the admin Places tab (no clean category mapping found, inserted inactive):')
    needsReview.forEach((r) => console.log(` - ${r.name}`))
  }
  await db.destroy()
}

main()
