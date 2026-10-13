import { db } from '../lib/db.js'
import { httpError } from '../middleware/errorHandler.js'
import { SYNC_FIELDS } from '../lib/placeFields.js'
import { syncPlace } from './placeSync.js'

export const SCOPES = ['single', 'selected', 'filter', 'all']
export const MAX_JOB_ITEMS = 500
// Above this many places (or for scope 'all') the caller must pass
// confirm:true -- the UI shows the preview count first. Each place is one
// billable Places API request.
export const CONFIRM_THRESHOLD = 100
const CONCURRENCY = 3

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Filters an admin can combine for scope 'filter':
//   staleDays          - never synced, or last sync older than N days
//   hasPendingReports  - at least one pending user report
//   hasGoogleDiff      - Google has a newer value parked behind a lock
//   district, category - exact match
//   businessStatus     - exact match (e.g. CLOSED_TEMPORARILY)
//   includeInactive    - default false: hidden places are not worth an API call
function buildSelection({ scope, ids, filters = {} }) {
  if (!SCOPES.includes(scope)) throw httpError(400, 'ขอบเขตการซิงก์ไม่ถูกต้อง')
  const q = db('places').whereNotNull('google_place_id')

  if (scope === 'single' || scope === 'selected') {
    const list = Array.isArray(ids) ? [...new Set(ids)] : []
    if (!list.length) throw httpError(400, 'กรุณาเลือกสถานที่อย่างน้อย 1 แห่ง')
    if (list.length > MAX_JOB_ITEMS) throw httpError(400, `เลือกได้สูงสุด ${MAX_JOB_ITEMS} แห่งต่อครั้ง`)
    if (scope === 'single' && list.length !== 1) throw httpError(400, 'โหมดรายตัวต้องระบุสถานที่ 1 แห่ง')
    if (!list.every((id) => typeof id === 'string' && UUID_RE.test(id))) throw httpError(400, 'รหัสสถานที่ไม่ถูกต้อง')
    return q.whereIn('id', list) // explicit picks are honored even if inactive
  }

  if (!filters.includeInactive) q.where('is_active', true)
  if (scope === 'filter') {
    const days = Number(filters.staleDays)
    if (filters.staleDays != null && filters.staleDays !== '') {
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw httpError(400, 'จำนวนวันไม่ถูกต้อง')
      q.where((w) => w.whereNull('last_synced_at').orWhereRaw("last_synced_at < now() - (? * interval '1 day')", [days]))
    }
    if (filters.hasPendingReports) q.whereExists(db('place_reports').whereRaw('place_reports.place_id = places.id').where('status', 'pending'))
    if (filters.hasGoogleDiff) q.whereRaw("google_diff <> '{}'::jsonb")
    if (filters.district) q.where('district', String(filters.district))
    if (filters.category) q.where('category', String(filters.category))
    if (filters.businessStatus) q.where('business_status', String(filters.businessStatus))
  }
  return q
}

// Oldest-synced first, so a capped run always makes progress on the stalest.
function orderAndLimit(q, maxItems) {
  return q.orderByRaw('last_synced_at asc nulls first').orderBy('id').limit(maxItems)
}

function normalizeMax(maxItems) {
  if (maxItems == null || maxItems === '') return MAX_JOB_ITEMS
  const n = Number(maxItems)
  if (!Number.isInteger(n) || n < 1) throw httpError(400, 'จำนวนสูงสุดไม่ถูกต้อง')
  return Math.min(n, MAX_JOB_ITEMS)
}

export async function previewSelection(input) {
  const max = normalizeMax(input.maxItems)
  const rows = await orderAndLimit(buildSelection(input).select('id', 'name', 'last_synced_at'), max)
  // Unbounded match count so the UI can say "matches 1,240, will sync the
  // oldest 500" rather than silently truncating.
  const [{ count }] = await buildSelection(input).count('* as count')
  return {
    count: rows.length,
    matched: Number(count),
    capped: Number(count) > rows.length,
    needsConfirm: input.scope === 'all' || rows.length > CONFIRM_THRESHOLD,
    sample: rows.slice(0, 5).map((r) => ({ id: r.id, name: r.name })),
  }
}

let runningJobId = null

export async function createJob(input, actorId) {
  const fields = Array.isArray(input.fields) && input.fields.length ? input.fields : SYNC_FIELDS
  if (!fields.every((f) => SYNC_FIELDS.includes(f))) throw httpError(400, 'ฟิลด์ที่เลือกไม่ถูกต้อง')
  const dryRun = !!input.dryRun
  const max = normalizeMax(input.maxItems)

  if (runningJobId) throw httpError(409, 'มีงานซิงก์กำลังทำงานอยู่ กรุณารอให้เสร็จหรือยกเลิกก่อน')
  // Claim the slot synchronously so two simultaneous requests can't both pass
  // the check above while the awaits below are in flight.
  runningJobId = 'pending'

  let job
  let ids
  try {
    ids = (await orderAndLimit(buildSelection(input).select('id'), max)).map((r) => r.id)
    if (!ids.length) throw httpError(400, 'ไม่พบสถานที่ที่ตรงกับเงื่อนไข')
    if ((input.scope === 'all' || ids.length > CONFIRM_THRESHOLD) && input.confirm !== true) {
      throw Object.assign(httpError(409, `ต้องยืนยันก่อนซิงก์ ${ids.length} แห่ง (แต่ละแห่งคือ 1 คำขอไปยัง Google Places API)`), { needsConfirm: true, count: ids.length })
    }

    ;[job] = await db('place_sync_jobs').insert({
      created_by: actorId,
      scope: input.scope,
      filters: JSON.stringify(input.filters || {}),
      fields,
      dry_run: dryRun,
      max_items: max,
      total: ids.length,
    }).returning('*')
    await db('admin_audit_log').insert({
      admin_id: actorId, action: 'place.sync_job',
      details: JSON.stringify({ jobId: job.id, scope: input.scope, total: ids.length, dryRun, fields }),
    })
  } catch (err) {
    runningJobId = null
    throw err
  }

  runningJobId = job.id
  // Fire and forget: the HTTP request returns the queued job, the client polls.
  runJob(job, ids, actorId).catch((err) => console.error('Place sync job crashed:', err)).finally(() => { runningJobId = null })
  return job
}

async function runJob(job, ids, actorId) {
  await db('place_sync_jobs').where('id', job.id).update({ status: 'running', started_at: db.fn.now() })
  let cursor = 0
  let cancelled = false

  const worker = async () => {
    while (!cancelled) {
      const i = cursor++
      if (i >= ids.length) return
      // Cheap per-item check so "cancel" takes effect within a few requests.
      const { status } = await db('place_sync_jobs').select('status').where('id', job.id).first()
      if (status === 'cancelled') { cancelled = true; return }

      const placeId = ids[i]
      let result
      try {
        const r = await syncPlace(placeId, { fields: job.fields, dryRun: job.dry_run, actorId, jobId: job.id })
        result = { status: r.status, changed_fields: r.changedFields, skipped_locked: r.skippedLocked, diff: JSON.stringify(r.diff) }
      } catch (err) {
        // Never echo raw driver text into a row admins read; status/message
        // written for people is fine.
        result = { status: 'failed', error: (err.status ? err.message : 'เกิดข้อผิดพลาดระหว่างซิงก์').slice(0, 300), changed_fields: [], skipped_locked: [], diff: '{}' }
      }
      await db('place_sync_results').insert({ job_id: job.id, place_id: placeId, ...result }).onConflict(['job_id', 'place_id']).ignore()
      await db('place_sync_jobs').where('id', job.id).update({
        done: db.raw('done + 1'),
        failed: db.raw(result.status === 'failed' ? 'failed + 1' : 'failed'),
      })
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker))
    await db('place_sync_jobs').where('id', job.id).whereNot('status', 'cancelled')
      .update({ status: 'completed', finished_at: db.fn.now() })
    if (cancelled) await db('place_sync_jobs').where('id', job.id).update({ finished_at: db.fn.now() })
  } catch (err) {
    await db('place_sync_jobs').where('id', job.id).update({ status: 'failed', error: 'งานซิงก์หยุดกะทันหัน', finished_at: db.fn.now() })
    throw err
  }
}

export async function cancelJob(jobId) {
  const [job] = await db('place_sync_jobs').where('id', jobId).whereIn('status', ['queued', 'running']).update({ status: 'cancelled' }).returning('*')
  if (!job) throw httpError(404, 'ไม่พบงานที่กำลังทำงานอยู่')
  return job
}

// A job left 'running' by a previous process can never finish (the runner
// lives in memory); close it out at boot so the admin UI doesn't show a
// forever-spinning job and the "one job at a time" guard isn't stuck.
export async function failOrphanedJobs() {
  await db('place_sync_jobs').whereIn('status', ['queued', 'running'])
    .update({ status: 'failed', error: 'เซิร์ฟเวอร์รีสตาร์ทระหว่างซิงก์', finished_at: db.fn.now() })
}
