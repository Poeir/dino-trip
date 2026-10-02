import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rateLimit } from '../lib/rateLimit.js'
import { db } from '../lib/db.js'
import { invalidateCache } from '../lib/crudRouter.js'
import { SYNC_FIELDS } from '../lib/placeFields.js'
import { syncPlace, resolveGoogleDiff, GooglePlaceNotFound } from '../services/placeSync.js'
import { previewSelection, createJob, cancelJob } from '../services/placeSyncJobs.js'

// Admin-only Google sync + field-lock management. The web app is the only
// thing that talks to Google for existing places (the CLI seeder is one-shot).
export const adminPlaceSyncRouter = Router()
adminPlaceSyncRouter.use(requireAdmin)

// Every sync call is a billable Places API request -- budget them per admin.
const jobLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'สร้างงานซิงก์บ่อยเกินไป กรุณารอสักครู่' })
const singleLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 120, message: 'ซิงก์รายตัวบ่อยเกินไป กรุณารอสักครู่' })

const selectionInput = (body = {}) => ({
  scope: body.scope,
  ids: body.ids,
  filters: body.filters && typeof body.filters === 'object' ? body.filters : {},
  maxItems: body.maxItems,
})

adminPlaceSyncRouter.post('/preview', asyncHandler(async (req, res) => {
  res.json(await previewSelection(selectionInput(req.body)))
}))

adminPlaceSyncRouter.post('/jobs', jobLimit, asyncHandler(async (req, res) => {
  try {
    const job = await createJob({
      ...selectionInput(req.body),
      fields: req.body?.fields,
      dryRun: req.body?.dryRun,
      confirm: req.body?.confirm,
    }, req.user.id)
    res.status(202).json(jobToResponse(job))
  } catch (err) {
    // The UI needs the count to show its confirmation dialog.
    if (err.needsConfirm) return res.status(409).json({ error: { message: err.message }, needsConfirm: true, count: err.count })
    throw err
  }
}))

adminPlaceSyncRouter.get('/jobs', asyncHandler(async (req, res) => {
  const rows = await db('place_sync_jobs as j').leftJoin('users as u', 'u.id', 'j.created_by')
    .select('j.*', 'u.display_name as creator_name').orderBy('j.created_at', 'desc').limit(20)
  res.json(rows.map((r) => ({ ...jobToResponse(r), createdByName: r.creator_name || null })))
}))

adminPlaceSyncRouter.get('/jobs/:id', asyncHandler(async (req, res) => {
  const job = await db('place_sync_jobs').where('id', req.params.id).first()
  if (!job) throw httpError(404, 'ไม่พบงานซิงก์')
  const results = await db('place_sync_results as r').join('places as p', 'p.id', 'r.place_id')
    .select('r.place_id', 'p.name as place_name', 'r.status', 'r.changed_fields', 'r.skipped_locked', 'r.diff', 'r.error')
    .where('r.job_id', job.id).orderBy('r.created_at').limit(500)
  res.json({
    ...jobToResponse(job),
    results: results.map((r) => ({
      placeId: r.place_id, placeName: r.place_name, status: r.status,
      changedFields: r.changed_fields, skippedLocked: r.skipped_locked, diff: r.diff, error: r.error,
    })),
  })
}))

adminPlaceSyncRouter.post('/jobs/:id/cancel', asyncHandler(async (req, res) => {
  res.json(jobToResponse(await cancelJob(req.params.id)))
}))

// Synchronous single-place sync (row button / report resolution) -- returns
// the outcome immediately instead of going through a job.
adminPlaceSyncRouter.post('/places/:id/sync', singleLimit, asyncHandler(async (req, res) => {
  const fields = Array.isArray(req.body?.fields) && req.body.fields.length ? req.body.fields : SYNC_FIELDS
  if (!fields.every((f) => SYNC_FIELDS.includes(f))) throw httpError(400, 'ฟิลด์ที่เลือกไม่ถูกต้อง')
  try {
    res.json(await syncPlace(req.params.id, { fields, dryRun: !!req.body?.dryRun, actorId: req.user.id }))
  } catch (err) {
    if (err instanceof GooglePlaceNotFound) throw httpError(404, err.message)
    if (!err.status) { console.error(err); throw httpError(502, 'ติดต่อ Google Places API ไม่สำเร็จ กรุณาลองใหม่') }
    throw err
  }
}))

// Lock state, parked Google values and pending report counts for one place.
adminPlaceSyncRouter.get('/places/:id', asyncHandler(async (req, res) => {
  const row = await db('places').select('id', 'name', 'google_place_id', 'locked_fields', 'google_diff', 'last_synced_at').where('id', req.params.id).first()
  if (!row) throw httpError(404, 'ไม่พบสถานที่')
  const pending = await db('place_reports').select('field').count('* as count').where({ place_id: row.id, status: 'pending' }).groupBy('field')
  res.json({
    id: row.id, name: row.name, hasGoogleId: !!row.google_place_id,
    lockedFields: row.locked_fields, googleDiff: row.google_diff, lastSyncedAt: row.last_synced_at,
    pendingReports: Object.fromEntries(pending.map((p) => [p.field, Number(p.count)])),
  })
}))

// Accept (take Google's value + unlock) or dismiss (keep the admin's value).
adminPlaceSyncRouter.post('/places/:id/diff/:field', asyncHandler(async (req, res) => {
  res.json(await resolveGoogleDiff(req.params.id, req.params.field, req.body?.action, req.user.id))
}))

// Replace the whole lock list, e.g. "back to Google's value" = unlock a field.
adminPlaceSyncRouter.put('/places/:id/locked-fields', asyncHandler(async (req, res) => {
  const list = req.body?.lockedFields
  if (!Array.isArray(list) || !list.every((f) => SYNC_FIELDS.includes(f))) throw httpError(400, 'รายการฟิลด์ที่ล็อกไม่ถูกต้อง')
  const lockedFields = [...new Set(list)]
  const row = await db.transaction(async (trx) => {
    const cur = await trx('places').where('id', req.params.id).forUpdate().first()
    if (!cur) throw httpError(404, 'ไม่พบสถานที่')
    // A field that is no longer locked has nothing to hold back, so any parked
    // Google value for it is stale bookkeeping.
    const diff = Object.fromEntries(Object.entries(cur.google_diff || {}).filter(([f]) => lockedFields.includes(f)))
    await trx('places').where('id', cur.id).update({ locked_fields: lockedFields, google_diff: JSON.stringify(diff) })
    await trx('admin_audit_log').insert({
      admin_id: req.user.id, action: 'place.locks_update',
      details: JSON.stringify({ placeId: cur.id, name: cur.name, from: cur.locked_fields, to: lockedFields }),
    })
    return cur
  })
  invalidateCache('places')
  res.json({ id: row.id, lockedFields })
}))

function jobToResponse(j) {
  return {
    id: j.id, scope: j.scope, filters: j.filters, fields: j.fields, dryRun: j.dry_run, maxItems: j.max_items,
    status: j.status, total: j.total, done: j.done, failed: j.failed, error: j.error,
    createdAt: j.created_at, startedAt: j.started_at, finishedAt: j.finished_at,
  }
}
