import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rateLimit } from '../lib/rateLimit.js'
import { invalidateCache } from '../lib/crudRouter.js'
import { forwardToChatbotService } from '../lib/chatbotProxy.js'
import { db } from '../lib/db.js'
import { rowToPlace } from '../lib/mappers.js'
import { PLACE_COLUMNS, attachUploadedPhotos } from './places.routes.js'
import { searchGooglePlaces, importGooglePlace } from '../services/placeImport.js'
import { searchArea,startImportJob, getImportJob, cancelImportJob } from '../services/placeAreaImport.js'
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

// Area import: search around a named area (1 geocode + 1 nearby request per
// category), then import the ticked results as one background job. Imports are
// the expensive part, so the hourly budget is per place via MAX_BATCH, not per request.
const areaSearchLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: 'ค้นหาตามพื้นที่บ่อยเกินไป กรุณารอสักครู่' })
const batchLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 6, message: 'นำเข้าเป็นชุดบ่อยเกินไป กรุณารอสักครู่' })

adminPlaceImportRouter.post('/area-search', areaSearchLimit, asyncHandler(async (req, res) => {
  try {
    res.json(await searchArea(req.body ?? {}))
  } catch (err) {
    if (!err.status) { console.error(err); throw httpError(502, 'ติดต่อ Google Places API ไม่สำเร็จ กรุณาลองใหม่') }
    throw err
  }
}))

// `describe: true` also writes an AI description per new place (one Serper + one LLM
// request each, same cost as the form's AI button, whose budget is ~60/hour), so those
// jobs have their own tighter limit on top of batchLimit.
const describeImportLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: 'นำเข้าพร้อมสร้างคำอธิบายบ่อยเกินไป กรุณารอสักครู่' })
const describeOnlyWhenAsked = (req, res, next) => (req.body?.describe === true ? describeImportLimit(req, res, next) : next())

adminPlaceImportRouter.post('/batch', batchLimit, describeOnlyWhenAsked, asyncHandler(async (req, res) => {
  res.status(202).json(startImportJob(req.body?.googlePlaceIds, req.user.id, { describe: req.body?.describe === true }))
}))

adminPlaceImportRouter.get('/batch/:id', asyncHandler(async (req, res) => {
  res.json(getImportJob(req.params.id))
}))

adminPlaceImportRouter.post('/batch/:id/cancel', asyncHandler(async (req, res) => {
  res.json(cancelImportJob(req.params.id))
}))

// Bulk "publish" for reviewed drafts. Only rows that are currently hidden are
// touched. Publishing doesn't change any embedded text, so rows that already have
// an embedding stay valid; the reindex kick below covers the ones that don't
// (it only embeds rows with a null embedding). The kick is best-effort: places
// are published either way, and `reindex` tells the UI what happened.
const publishLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: 'เผยแพร่เป็นชุดบ่อยเกินไป กรุณารอสักครู่' })
const MAX_PUBLISH = 100
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

adminPlaceImportRouter.post('/publish', publishLimit, asyncHandler(async (req, res) => {
  const ids = [...new Set(Array.isArray(req.body?.placeIds) ? req.body.placeIds : [])]
  if (!ids.length) throw httpError(400, 'กรุณาเลือกสถานที่อย่างน้อย 1 แห่ง')
  if (ids.length > MAX_PUBLISH) throw httpError(400, `เผยแพร่ได้สูงสุด ${MAX_PUBLISH} แห่งต่อครั้ง`)
  if (!ids.every((id) => typeof id === 'string' && UUID_RE.test(id))) throw httpError(400, 'รหัสสถานที่ไม่ถูกต้อง')

  const published = await db('places').whereIn('id', ids).where('is_active', false)
    .update({ is_active: true, updated_at: db.fn.now() }).returning(['id', 'name'])
  if (published.length) {
    await db('admin_audit_log').insert({
      admin_id: req.user.id, action: 'place.publish_batch',
      details: JSON.stringify({ count: published.length, placeIds: published.map((p) => p.id) }),
    })
    invalidateCache('places')
  }

  let reindex = 'skipped'
  if (published.length) {
    try {
      await forwardToChatbotService('/admin/reindex', { method: 'POST' })
      reindex = 'started'
    } catch (err) {
      // 409 = a reindex is already running; it won't cover rows published after it
      // read its pending list, so tell the admin to run it again from the dashboard.
      reindex = err.status === 409 ? 'busy' : 'failed'
      if (err.status !== 409) console.error('Reindex after bulk publish failed:', err.message)
    }
  }
  res.json({ published: published.length, alreadyPublishedOrMissing: ids.length - published.length, reindex })
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
