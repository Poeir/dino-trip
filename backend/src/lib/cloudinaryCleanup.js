import { db } from './db.js'
import { deleteImage } from './cloudinary.js'

// crudRouter's `beforeDelete` hooks: look up the Cloudinary assets that belong
// to a row *before* it is deleted (the rows holding their public ids are gone
// afterwards) and hand back a function that removes them once the delete has
// gone through. Best-effort: crudRouter logs a failure instead of failing the
// request, so a Cloudinary hiccup can't block deleting the row itself.

// A gallery table: many photos per parent row (place_photos, event_photos).
export const galleryCleanup = (table, parentColumn) => async (id) => {
  const rows = await db(table).select('public_id').where(parentColumn, id)
  const publicIds = rows.map((r) => r.public_id).filter(Boolean)
  return publicIds.length ? () => Promise.all(publicIds.map((publicId) => deleteImage(publicId))) : null
}

// A single image kept on the row itself (rewards.image_public_id).
export const singleImageCleanup = (table, column = 'image_public_id') => async (id) => {
  const row = await db(table).select(column).where('id', id).first()
  const publicId = row?.[column]
  return publicId ? () => deleteImage(publicId) : null
}
