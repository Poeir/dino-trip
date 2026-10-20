import { db } from '../lib/db.js'
import { httpError } from '../middleware/errorHandler.js'
import { invalidateCache } from '../lib/crudRouter.js'
import { forwardToChatbotService } from '../lib/chatbotProxy.js'
import { SKUS, THB_PER_USD } from '../lib/apiPricing.js'
import { startAutoJob, isJobRunning, MAX_JOB_ITEMS } from './placeSyncJobs.js'

// Scheduled Google sync. Settings live in one DB row (place_auto_sync_settings,
// edited from the admin UI); a timer checks every TICK_MS whether today's run is
// due, picks the places whose data is older than their interval and hands them to
// the same job runner the manual dialog uses. Locked fields still only park a diff.
// The monthly call cap is the cost guard: every place is one billable Places API
// request, and manual syncs count against the same cap.

const TICK_MS = 10 * 60 * 1000
const FIRST_TICK_MS = 60 * 1000
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000
// A failed job (crash / restart mid-run) lets the day's run be retried, but not forever.
const MAX_FAILED_RETRIES_PER_DAY = 3

// Place Details Enterprise (what syncPlace requests), first paid tier, per Google's
// price list as of 2026-10-20; the monthly free allowance is per SKU. Only used for
// the cost estimates shown to admins -- override if Google or the exchange rate moves.
export const PRICING = {
  freeCallsPerMonth: SKUS['places.details.enterprise'].freePerMonth,
  usdPer1000: SKUS['places.details.enterprise'].usdPer1000,
  thbPerUsd: THB_PER_USD,
}

export const estimateCostThb = (calls) =>
  Math.round(Math.max(0, calls - PRICING.freeCallsPerMonth) / 1000 * PRICING.usdPer1000 * PRICING.thbPerUsd)

// API (camelCase) <-> column (snake_case), with the allowed range per number.
const INT_SETTINGS = {
  runHour: ['run_hour', 0, 23, 'เวลาเริ่มรัน (ชั่วโมง)'],
  normalIntervalDays: ['normal_interval_days', 1, 365, 'ความถี่ซิงก์ทั่วไป (วัน)'],
  priorityIntervalDays: ['priority_interval_days', 1, 365, 'ความถี่ซิงก์แห่งสำคัญ (วัน)'],
  monthlyCallCap: ['monthly_call_cap', 0, 100_000, 'เพดานคำขอต่อเดือน'],
  dailyMaxItems: ['daily_max_items', 1, MAX_JOB_ITEMS, 'จำนวนสูงสุดต่อวัน'],
}
const BOOL_SETTINGS = {
  enabled: 'enabled',
  priorityFeatured: 'priority_featured',
  priorityQr: 'priority_qr',
  priorityWithReports: 'priority_with_reports',
  autoHideClosed: 'auto_hide_closed',
  includeInactive: 'include_inactive',
}

// Validates a (partial) settings update from the admin form -> column patch.
// Unknown keys are ignored; a wrong type or out-of-range number is a 400.
export function validateSettingsPatch(body) {
  const src = body && typeof body === 'object' ? body : {}
  const patch = {}
  for (const [key, [column, min, max, label]] of Object.entries(INT_SETTINGS)) {
    if (!(key in src)) continue
    const n = src[key]
    if (!Number.isInteger(n) || n < min || n > max) throw httpError(400, `${label} ต้องเป็นจำนวนเต็มระหว่าง ${min}–${max}`)
    patch[column] = n
  }
  for (const [key, column] of Object.entries(BOOL_SETTINGS)) {
    if (!(key in src)) continue
    if (typeof src[key] !== 'boolean') throw httpError(400, 'ค่าที่ส่งมาไม่ถูกต้อง')
    patch[column] = src[key]
  }
  if (!Object.keys(patch).length) throw httpError(400, 'ไม่มีค่าที่จะบันทึก')
  return patch
}

function rowToSettings(r) {
  return {
    enabled: r.enabled,
    runHour: r.run_hour,
    normalIntervalDays: r.normal_interval_days,
    priorityIntervalDays: r.priority_interval_days,
    priorityFeatured: r.priority_featured,
    priorityQr: r.priority_qr,
    priorityWithReports: r.priority_with_reports,
    monthlyCallCap: r.monthly_call_cap,
    dailyMaxItems: r.daily_max_items,
    autoHideClosed: r.auto_hide_closed,
    includeInactive: r.include_inactive,
    updatedAt: r.updated_at,
  }
}

// ---------------------------------------------------------------- Asia/Bangkok calendar
// Thailand has no DST, so a fixed +7h shift is exact.
const bangkok = (date) => new Date(date.getTime() + BANGKOK_OFFSET_MS)
export const bangkokDayStart = (date) => {
  const b = bangkok(date)
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - BANGKOK_OFFSET_MS)
}
export const bangkokMonthStart = (date) => {
  const b = bangkok(date)
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1) - BANGKOK_OFFSET_MS)
}
const bangkokHour = (date) => bangkok(date).getUTCHours()

// Catch-up semantics: any tick at or after run_hour starts the day's run if it hasn't
// happened, so a deploy/restart at 03:00 doesn't cost the whole day.
export function shouldRunNow({ enabled, runHour }, now, ranToday) {
  return !!enabled && !ranToday && bangkokHour(now) >= runHour
}

export function nextRunAt({ enabled, runHour }, now, ranToday) {
  if (!enabled) return null
  const todayRun = new Date(bangkokDayStart(now).getTime() + runHour * 3_600_000)
  if (!ranToday) return now < todayRun ? todayRun : now // already due: starts at the next tick
  return new Date(todayRun.getTime() + 24 * 3_600_000)
}

// ---------------------------------------------------------------- settings
function undefinedTable(err) {
  return err?.code === '42P01'
    ? httpError(503, 'ยังไม่ได้รัน migration 20261021000001_place_auto_sync.sql บนฐานข้อมูล')
    : err
}

async function loadRow() {
  try {
    let row = await db('place_auto_sync_settings').where('id', true).first()
    if (!row) {
      await db('place_auto_sync_settings').insert({ id: true }).onConflict('id').ignore()
      row = await db('place_auto_sync_settings').where('id', true).first()
    }
    return row
  } catch (err) {
    throw undefinedTable(err)
  }
}

export async function saveSettings(body, actorId) {
  const patch = validateSettingsPatch(body)
  await loadRow()
  await db('place_auto_sync_settings').where('id', true).update({ ...patch, updated_at: db.fn.now(), updated_by: actorId })
  await db('admin_audit_log').insert({ admin_id: actorId, action: 'place.auto_sync_settings', details: JSON.stringify(patch) })
  skippedDay = null // a raised cap / new interval should take effect at the next tick, not tomorrow
  return rowToSettings(await loadRow())
}

// ---------------------------------------------------------------- which places are due
// "Priority" places are synced at priority_interval_days, the rest at
// normal_interval_days; never-synced places are always due.
function priorityPredicate(s) {
  const parts = []
  if (s.priority_featured) parts.push('places.is_featured')
  if (s.priority_qr) parts.push('places.has_qr')
  if (s.priority_with_reports) parts.push("exists (select 1 from place_reports r where r.place_id = places.id and r.status = 'pending')")
  return parts.length ? `(${parts.join(' or ')})` : 'false'
}

function eligible(s) {
  const q = db('places').whereNotNull('google_place_id')
  if (!s.include_inactive) q.where('is_active', true)
  return q
}

function dueQuery(s) {
  const prio = priorityPredicate(s)
  return {
    prio,
    q: eligible(s).whereRaw(
      `(places.last_synced_at is null or places.last_synced_at < now() - (case when ${prio} then ?::int else ?::int end) * interval '1 day')`,
      [s.priority_interval_days, s.normal_interval_days],
    ),
  }
}

async function selectDue(s, limit) {
  const { q, prio } = dueQuery(s)
  const rows = await q.select('places.id').orderByRaw(`${prio} desc, places.last_synced_at asc nulls first, places.id`).limit(limit)
  return rows.map((r) => r.id)
}

async function countDue(s) {
  const [{ count }] = await dueQuery(s).q.count('* as count')
  return Number(count)
}

// Syncs this calendar month (Asia/Bangkok), manual + automatic + dry runs: all of
// them are real Google requests.
async function monthlyUsage(now) {
  const [{ count }] = await db('place_sync_results').where('created_at', '>=', bangkokMonthStart(now)).count('* as count')
  return Number(count)
}

// Hand-started "run now" jobs are flagged in filters so they don't count as the
// day's scheduled run.
async function ranToday(now) {
  const start = bangkokDayStart(now)
  const scheduled = () => db('place_sync_jobs').where('triggered_by', 'auto').where('created_at', '>=', start).whereRaw("coalesce(filters->>'runNow', 'false') <> 'true'")
  const [{ count: ok }] = await scheduled().whereNot('status', 'failed').count('* as count')
  if (Number(ok) > 0) return true
  const [{ count: failed }] = await scheduled().where('status', 'failed').count('* as count')
  return Number(failed) >= MAX_FAILED_RETRIES_PER_DAY
}

// ---------------------------------------------------------------- the run
export const SKIP_MESSAGE = {
  cap_reached: 'ใช้คำขอครบเพดานของเดือนนี้แล้ว',
  nothing_due: 'ยังไม่มีสถานที่ที่ถึงรอบซิงก์',
  busy: 'มีงานซิงก์อื่นกำลังทำงานอยู่',
}

let skippedDay = null

export async function runAutoSync({ runNow = false } = {}) {
  const s = await loadRow()
  const now = new Date()
  const used = await monthlyUsage(now)
  const remaining = Math.max(0, s.monthly_call_cap - used)
  if (remaining === 0) return { started: false, reason: 'cap_reached' }

  const ids = await selectDue(s, Math.min(s.daily_max_items, remaining, MAX_JOB_ITEMS))
  if (!ids.length) return { started: false, reason: 'nothing_due' }

  const job = await startAutoJob(ids, { runNow, onFinished: (j) => afterRun(j, s) })
  if (!job) return { started: false, reason: 'busy' }
  return { started: true, jobId: job.id, total: ids.length }
}

// Closed-for-good handling + embedding refresh once the run is done.
async function afterRun(job, s) {
  try {
    const results = await db('place_sync_results').select('place_id', 'changed_fields').where('job_id', job.id)
    let hidden = 0
    if (s.auto_hide_closed) {
      // Only places whose status *changed* to closed in this run: an admin who
      // re-publishes a place anyway isn't fought on every later sync.
      const flipped = results.filter((r) => r.changed_fields?.includes('business_status')).map((r) => r.place_id)
      if (flipped.length) {
        const rows = await db('places').whereIn('id', flipped).where({ is_active: true, business_status: 'CLOSED_PERMANENTLY' })
          .update({ is_active: false }).returning(['id', 'name'])
        hidden = rows.length
        if (hidden) {
          await db('admin_audit_log').insert({
            admin_id: null, action: 'place.auto_hide_closed',
            details: JSON.stringify({ jobId: job.id, places: rows }),
          })
          invalidateCache('places')
        }
      }
    }
    await db('place_sync_jobs').where('id', job.id).update({ auto_hidden: hidden })

    // A synced name nulls the embedding (see placeSync.js); embed it again while we're here.
    if (results.some((r) => r.changed_fields?.includes('name'))) {
      await forwardToChatbotService('/admin/reindex', { method: 'POST' }).catch((err) => {
        if (err.status !== 409) console.error('Reindex after auto sync failed:', err.message)
      })
    }
  } catch (err) {
    console.error('Auto sync post-processing failed:', err)
  }
}

// ---------------------------------------------------------------- status for the admin UI
export async function getAutoSyncStatus() {
  const row = await loadRow()
  const settings = rowToSettings(row)
  const now = new Date()
  const [used, due, ran, lastRun, shape] = await Promise.all([
    monthlyUsage(now),
    countDue(row),
    ranToday(now),
    db('place_sync_jobs').where('triggered_by', 'auto').orderBy('created_at', 'desc')
      .select('id', 'status', 'total', 'done', 'failed', 'auto_hidden', 'created_at', 'finished_at', db.raw("coalesce(filters->>'runNow', 'false') = 'true' as run_now")).first(),
    eligible(row).select(db.raw(`count(*)::int as total, (count(*) filter (where ${priorityPredicate(row)}))::int as priority`)).first(),
  ])

  // Steady-state calls per month at these intervals (30-day month).
  const normal = shape.total - shape.priority
  const projectedMonthlyCalls = Math.round(shape.priority * 30 / row.priority_interval_days + normal * 30 / row.normal_interval_days)

  return {
    settings,
    usage: {
      usedThisMonth: used,
      cap: row.monthly_call_cap,
      remaining: Math.max(0, row.monthly_call_cap - used),
      costSoFarThb: estimateCostThb(used),
      maxCostAtCapThb: estimateCostThb(row.monthly_call_cap),
    },
    projection: {
      eligible: shape.total,
      priority: shape.priority,
      monthlyCalls: projectedMonthlyCalls,
      // What the intervals alone would cost; the cap still limits what actually runs.
      monthlyCostThb: estimateCostThb(projectedMonthlyCalls),
    },
    dueNow: due,
    running: isJobRunning(),
    nextRunAt: nextRunAt(settings, now, ran),
    lastRun: lastRun ? {
      id: lastRun.id, status: lastRun.status, total: lastRun.total, done: lastRun.done, failed: lastRun.failed,
      autoHidden: lastRun.auto_hidden, createdAt: lastRun.created_at, finishedAt: lastRun.finished_at, runNow: lastRun.run_now,
    } : null,
    pricing: PRICING,
  }
}

// ---------------------------------------------------------------- scheduler
async function tick() {
  const row = await loadRow()
  if (!row.enabled) return
  const now = new Date()
  const dayKey = bangkokDayStart(now).toISOString()
  if (skippedDay === dayKey) return
  const settings = rowToSettings(row)
  if (!shouldRunNow(settings, now, await ranToday(now))) return

  const r = await runAutoSync()
  if (r.started) {
    console.log(`Auto place sync started: ${r.total} places (job ${r.jobId})`)
  } else if (r.reason !== 'busy') {
    // Nothing to do (or cap hit) today: don't re-query every tick until tomorrow / a settings change.
    skippedDay = dayKey
    console.log(`Auto place sync skipped: ${SKIP_MESSAGE[r.reason]}`)
  }
}

export function startAutoSyncScheduler() {
  let warned = false
  const safeTick = () => tick().catch((err) => {
    // Before the migration is applied the table doesn't exist; say so once, not every 10 minutes.
    if (err?.status === 503) { if (!warned) { warned = true; console.warn('Auto place sync disabled:', err.message) } return }
    console.error('Auto place sync tick failed:', err)
  })
  // First check shortly after boot (after failOrphanedJobs has settled), then on an interval.
  setTimeout(safeTick, FIRST_TICK_MS).unref()
  setInterval(safeTick, TICK_MS).unref()
}
