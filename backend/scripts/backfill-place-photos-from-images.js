// One-off backfill: copies the Cloudinary URLs in places.images (from the old import scripts) into
// place_photos, so the admin form can show, reorder and delete them. Nothing is re-uploaded --
// public_id is parsed from the existing URL. places.images itself is left untouched (SEO pages
// read it). Places that already have place_photos rows are skipped, so it is safe to re-run.
//
// Usage: cd backend && node scripts/backfill-place-photos-from-images.js          (dry run)
//        cd backend && node scripts/backfill-place-photos-from-images.js --apply

import 'dotenv/config'
import { db } from '../src/lib/db.js'

const APPLY = process.argv.includes('--apply')
const CLOUDINARY_URL = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i

const publicIdOf = (url) => CLOUDINARY_URL.exec(url)?.[1] ?? null

async function main() {
  const places = await db('places').select('id', 'name', 'images').whereRaw('cardinality(images) > 0')
  const have = new Set((await db('place_photos').distinct('place_id')).map((r) => r.place_id))

  let migrated = 0, photos = 0, skippedHave = 0, skippedUrls = 0
  for (const place of places) {
    if (have.has(place.id)) { skippedHave++; continue }

    const rows = []
    const seen = new Set()
    for (const url of place.images) {
      const publicId = publicIdOf(url)
      if (!publicId) { skippedUrls++; console.warn(`  skip (not a Cloudinary URL) ${place.name}: ${url}`); continue }
      if (seen.has(publicId)) continue
      seen.add(publicId)
      rows.push({ place_id: place.id, url, public_id: publicId, position: rows.length })
    }
    if (!rows.length) continue

    if (APPLY) await db.transaction((trx) => trx('place_photos').insert(rows))
    migrated++
    photos += rows.length
  }

  console.log(`${APPLY ? 'Applied' : 'Dry run'}: ${migrated} place(s), ${photos} photo(s). Skipped: ${skippedHave} already have place_photos, ${skippedUrls} non-Cloudinary URL(s).`)
  if (!APPLY) console.log('Re-run with --apply to write.')
  await db.destroy()
}

main().catch((err) => { console.error(err); process.exit(1) })
