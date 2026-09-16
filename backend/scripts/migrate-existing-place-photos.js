// One-off backfill: uploads every place_photos row still holding raw bytea
// (data/mime, from the pre-Cloudinary version of this feature) to Cloudinary
// and fills in its url/public_id. Run once, after
// 20260914000001_place_photos_add_cloudinary_cols.sql and before
// 20260914000002_place_photos_drop_bytea.sql.
//
// Usage: cd backend && node scripts/migrate-existing-place-photos.js

import 'dotenv/config'
import { db } from '../src/lib/db.js'
import { uploadImageBuffer } from '../src/lib/cloudinary.js'

async function main() {
  const rows = await db('place_photos').select('id', 'place_id', 'data', 'mime').whereNotNull('data').whereNull('url')
  console.log(`${rows.length} row(s) to migrate.`)

  for (const row of rows) {
    const result = await uploadImageBuffer(row.data, `dino/places/${row.place_id}`)
    await db('place_photos').where('id', row.id).update({ url: result.secure_url, public_id: result.public_id })
    console.log(`  migrated ${row.id} -> ${result.secure_url}`)
  }

  console.log('Done. Once every row has a url, apply 20260914000002_place_photos_drop_bytea.sql.')
  await db.destroy()
}

main()
