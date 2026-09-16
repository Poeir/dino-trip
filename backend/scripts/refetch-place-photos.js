// Re-fetches photos for Google-sourced places from the Google Places API and
// uploads them to Cloudinary, replacing the dead Supabase Storage URLs left
// over from the original import (see fetch-places.js/import-places.js --
// Supabase Storage on this project is now permanently 402'ing on
// exceed_storage_size_quota, so the original bytes are unrecoverable).
//
// Only requests `id,photos` from Place Details -- every other field is
// already on file, so this avoids re-billing the Enterprise+Atmosphere SKU
// fetch-places.js's full DETAILS_FIELD_MASK needed for reviews/editorial
// summary. Photo Media downloads are billed past the first 1,000/month
// though (see fetch-places.js), so default to a small LIMIT for a test run
// before doing all ~424 places.
//
// Usage: cd backend && LIMIT=5 node scripts/refetch-place-photos.js
//        cd backend && node scripts/refetch-place-photos.js          # all remaining places
//        cd backend && FORCE=1 node scripts/refetch-place-photos.js  # also redo ones already on Cloudinary

import 'dotenv/config'
import { db } from '../src/lib/db.js'
import { uploadImageBuffer } from '../src/lib/cloudinary.js'

const API_KEY = process.env.GOOGLE_PLACES_API_KEY
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_API_KEY. Copy backend/.env.example to backend/.env and fill it in.')
  process.exit(1)
}

const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : null
const FORCE = !!process.env.FORCE

// Same gallery-size convention as fetch-places.js / places.routes.js.
const MAX_PHOTOS_PER_PLACE = 5

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPhotoRefs(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=th&regionCode=TH`, {
    headers: { 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': 'id,photos' },
  })
  if (!res.ok) {
    console.error(`  Place Details failed (${res.status}) for ${placeId}:`, await res.text())
    return null
  }
  return res.json()
}

// Photo `name` values expire and can't be cached -- resolve + download right
// after the Details call, same as fetch-places.js's downloadPhotos.
async function downloadPhoto(photoName) {
  const res = await fetch(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1200&key=${API_KEY}`)
  if (!res.ok) {
    console.error(`  Photo download failed (${res.status}) for ${photoName}`)
    return null
  }
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  let query = db('places').select('id', 'google_place_id', 'name', 'img').where('source', 'google').whereNotNull('google_place_id')
  if (!FORCE) query = query.where((q) => q.whereNull('img').orWhereNot('img', 'like', '%res.cloudinary.com%'))
  if (LIMIT) query = query.limit(LIMIT)
  const places = await query
  console.log(`${places.length} place(s) to refetch photos for.`)

  let done = 0
  let failed = 0
  for (const place of places) {
    const details = await fetchPhotoRefs(place.google_place_id)
    await sleep(150)
    if (!details?.photos?.length) {
      console.log(`  [${place.name}] no photos from Google, skipping`)
      done++
      continue
    }

    const urls = []
    for (const photo of details.photos.slice(0, MAX_PHOTOS_PER_PLACE)) {
      const bytes = await downloadPhoto(photo.name)
      await sleep(150)
      if (!bytes) continue
      const result = await uploadImageBuffer(bytes, `dino/places/${place.id}`)
      urls.push(result.secure_url)
    }

    if (urls.length) {
      await db('places').where('id', place.id).update({ img: urls[0], images: urls })
      console.log(`  [${place.name}] uploaded ${urls.length} photo(s)`)
    } else {
      console.log(`  [${place.name}] all photo downloads/uploads failed`)
      failed++
    }
    done++
    if (done % 20 === 0) console.log(`${done}/${places.length}...`)
  }

  console.log(`Done. ${done - failed}/${places.length} updated, ${failed} failed entirely.`)
  await db.destroy()
}

main()
