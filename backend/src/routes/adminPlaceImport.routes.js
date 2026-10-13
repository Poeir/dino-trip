import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rateLimit } from '../lib/rateLimit.js'
import { db } from '../lib/db.js'
import { rowToPlace } from '../lib/mappers.js'
import { PLACE_COLUMNS, attachUploadedPhotos } from './places.routes.js'
import { searchGooglePlaces, importGooglePlace } from '../services/placeImport.js'
import { GooglePlaceNotFound } from '../services/placeSync.js'

// Admin-only "add a place from Google Maps". Same billing concern as place
// sync: each search / import is a paid Places API request.
export const adminPlaceImportRouter = Router()
adminPlaceImportRouter.use(requireAdmin)

const searchLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 120, message: 'ค้นหาจาก Google บ่อยเกินไป กรุณารอสักครู่' })
const importLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 40, message: 'นำเข้าสถานที่จาก Google บ่อยเกินไป กรุณารอสักครู่' })

adminPlaceImportRouter.get('/search', searchLimit, asyncHandler(async (req, res) => {
  try {
    res.json(await searchGooglePlaces(req.query.q))
  } catch (err) {
    if (!err.status) { console.error(err); throw httpError(502, 'ติดต่อ Google Places API ไม่สำเร็จ กรุณาลองใหม่') }
    throw err
  }
}))

// Creates a hidden draft from Google; the admin then reviews it in the normal
// edit form. 200 (not 201) with `created: false` when it was already imported.
adminPlaceImportRouter.post('/', importLimit, asyncHandler(async (req, res) => {
  let result
  try {
    result = await importGooglePlace(req.body?.googlePlaceId, req.user.id)
  } catch (err) {
    if (err instanceof GooglePlaceNotFound) throw httpError(404, err.message)
    if (!err.status) { console.error(err); throw httpError(502, 'นำเข้าจาก Google ไม่สำเร็จ กรุณาลองใหม่') }
    throw err
  }
  const row = await db('places').select(PLACE_COLUMNS.split(',').map((s) => s.trim())).where('id', result.id).first()
  const [enriched] = await attachUploadedPhotos([row])
  res.status(result.created ? 201 : 200).json({ created: result.created, place: rowToPlace(enriched) })
}))
