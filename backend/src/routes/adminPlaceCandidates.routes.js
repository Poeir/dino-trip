import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rateLimit } from '../lib/rateLimit.js'
import { invalidateCache } from '../lib/crudRouter.js'
import { forwardToChatbotService } from '../lib/chatbotProxy.js'
import { grossCostThb } from '../lib/apiPricing.js'
import { db } from '../lib/db.js'
import { importGooglePlace } from '../services/placeImport.js'
import { describeImportedPlace } from '../services/placeBulkDescribe.js'
import { importQualityProblems } from '../services/placeQuality.js'

// "Places users asked for": Google places the chatbot showed for a thin "แถว X"
// question (chatbot-service rag/google_fallback.py records them via
// record_place_candidates, migration 20261022000001). Admins import the ones
// worth keeping: import -> AI description -> quality gate -> published if it
// passes, else left a hidden draft with the reasons.
export const adminPlaceCandidatesRouter = Router()
adminPlaceCandidatesRouter.use(requireAdmin)

const STATUSES = ['pending', 'imported', 'dismissed']

const rowToCandidate = (r) => ({
  googlePlaceId: r.google_place_id, name: r.name, address: r.address, areaQuery: r.area_query,
  category: r.category, rating: r.rating == null ? null : Number(r.rating), reviewCount: r.review_count,
  mapsUrl: r.maps_url, askCount: r.ask_count, firstAskedAt: r.first_asked_at, lastAskedAt: r.last_asked_at,
  status: r.status, placeId: r.place_id, decidedAt: r.decided_at,
})

adminPlaceCandidatesRouter.get('/', asyncHandler(async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'pending'
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const search = String(req.query.search ?? '').trim()
  const q = () => {
    const b = db('place_candidates').where({ status })
    if (search) b.andWhere((w) => w.whereILike('name', `%${search}%`).orWhereILike('area_query', `%${search}%`))
    return b
  }
  const [{ count }] = await q().count('* as count')
  const rows = await q().select('*').orderBy([{ column: 'ask_count', order: 'desc' }, { column: 'last_asked_at', order: 'desc' }])
    .limit(pageSize).offset((page - 1) * pageSize)
  res.json({ data: rows.map(rowToCandidate), total: Number(count), page, pageSize, totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) })
}))

adminPlaceCandidatesRouter.get('/count', asyncHandler(async (req, res) => {
  const [{ count }] = await db('place_candidates').where({ status: 'pending' }).count('* as count')
  res.json({ pending: Number(count) })
}))

// Chat's paid Google searches: today and this month (Asia/Bangkok), with a cost estimate.
adminPlaceCandidatesRouter.get('/usage', asyncHandler(async (req, res) => {
  const { rows } = await db.raw(`
    select
      coalesce(sum(calls) filter (where day = (now() at time zone 'Asia/Bangkok')::date), 0) as today,
      coalesce(sum(calls) filter (where day >= date_trunc('month', now() at time zone 'Asia/Bangkok')::date), 0) as month
    from google_fallback_usage`)
  const today = Number(rows[0].today)
  const month = Number(rows[0].month)
  res.json({
    today, month,
    costPerSearchThb: grossCostThb({ 'places.text_search.enterprise_atmosphere': 1 }),
    monthCostThb: grossCostThb({ 'places.text_search.enterprise_atmosphere': month }),
  })
}))

// One import = one Details call + up to 5 photos + one describe (Serper + LLM),
// like the admin's single-place import, so the same hourly budget.
const importLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 40, message: 'นำเข้าสถานที่จาก Google บ่อยเกินไป กรุณารอสักครู่' })

adminPlaceCandidatesRouter.post('/:gid/import', importLimit, asyncHandler(async (req, res) => {
  const gid = req.params.gid
  const cand = await db('place_candidates').where({ google_place_id: gid }).first()
  if (!cand) throw httpError(404, 'ไม่พบรายการนี้')
  if (cand.status === 'imported') throw httpError(409, 'นำเข้าไปแล้ว')

  let r
  try {
    r = await importGooglePlace(gid, req.user.id)
  } catch (err) {
    if (!err.status) { console.error(err); throw httpError(502, 'ติดต่อ Google Places API ไม่สำเร็จ กรุณาลองใหม่') }
    throw err
  }

  // A place already in the DB (imported some other way) is only linked: it may
  // have been edited, so it's neither rewritten nor republished here.
  let description = null
  let problems = []
  let published = false
  if (r.created) {
    description = (await describeImportedPlace(r.id, { replaceGoogleSummary: true })).status
    problems = await importQualityProblems(r.id)
    if (!problems.length) {
      published = (await db('places').where({ id: r.id, is_active: false }).update({ is_active: true, updated_at: db.fn.now() })) > 0
    }
    invalidateCache('places')
  }

  await db('place_candidates').where({ google_place_id: gid })
    .update({ status: 'imported', place_id: r.id, decided_at: db.fn.now(), decided_by: req.user.id })
  await db('admin_audit_log').insert({
    admin_id: req.user.id, action: 'place.import_candidate',
    details: JSON.stringify({ googlePlaceId: gid, placeId: r.id, created: r.created, published, problems, askCount: cand.ask_count }),
  }).catch((err) => console.error('Candidate import audit log failed:', err))

  // New places have no embedding yet; without a reindex the chatbot can't find them.
  let reindex = 'skipped'
  if (published) {
    try {
      await forwardToChatbotService('/admin/reindex', { method: 'POST' })
      reindex = 'started'
    } catch (err) {
      reindex = err.status === 409 ? 'busy' : 'failed'
      if (err.status !== 409) console.error('Reindex after candidate import failed:', err.message)
    }
  }
  res.json({ placeId: r.id, created: r.created, description, problems, published, reindex })
}))

adminPlaceCandidatesRouter.post('/:gid/dismiss', asyncHandler(async (req, res) => {
  const n = await db('place_candidates').where({ google_place_id: req.params.gid, status: 'pending' })
    .update({ status: 'dismissed', decided_at: db.fn.now(), decided_by: req.user.id })
  if (!n) throw httpError(404, 'ไม่พบรายการที่รอพิจารณา')
  res.json({ ok: true })
}))

// Undo a dismissal: back to the queue.
adminPlaceCandidatesRouter.post('/:gid/restore', asyncHandler(async (req, res) => {
  const n = await db('place_candidates').where({ google_place_id: req.params.gid, status: 'dismissed' })
    .update({ status: 'pending', decided_at: null, decided_by: null })
  if (!n) throw httpError(404, 'ไม่พบรายการที่ซ่อนไว้')
  res.json({ ok: true })
}))
