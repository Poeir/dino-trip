import { db } from '../lib/db.js'
import { httpError } from '../middleware/errorHandler.js'
import { invalidateCache } from '../lib/crudRouter.js'
import { SYNC_FIELDS, FIELD_COLUMNS, REPORT_TO_SYNC_FIELD, sameValue } from '../lib/placeFields.js'

// Deliberately small mask (vs. fetch-places.js's full Enterprise+Atmosphere
// one): only what the syncable fields need, so each call stays cheap.
const DETAILS_FIELD_MASK = [
  'id', 'displayName', 'formattedAddress', 'location', 'regularOpeningHours',
  'internationalPhoneNumber', 'websiteUri', 'businessStatus',
].join(',')

// Same shaping the seeder applied (scripts/import-places.js) so a synced value
// looks exactly like a seeded one.
function cleanAddress(address) {
  return (address || '').replace(/^[A-Z0-9]{4,8}\+[A-Z0-9]{2,3}\s+/, '')
}

function summarizeHours(hours) {
  const lines = hours?.weekdayDescriptions
  if (!lines || !lines.length) return 'สอบถามเวลาทำการ'
  const timePart = (line) => line.split(': ')[1] || line
  const times = lines.map(timePart)
  const allSame = times.every((t) => t === times[0])
  return allSame ? `ทุกวัน ${times[0]}` : lines.join('\n')
}

// Google's answer, as column patches keyed by sync field.
export function mapGoogleToFields(g) {
  const fields = {
    name: { name: g.displayName?.text || null },
    address: { address: cleanAddress(g.formattedAddress) || null },
    hours: {
      hours: summarizeHours(g.regularOpeningHours),
      // jsonb is stringified explicitly -- node-postgres would otherwise send a
      // JS array as a Postgres array literal.
      hours_periods: g.regularOpeningHours?.periods ? JSON.stringify(g.regularOpeningHours.periods) : null,
    },
    phone: { phone: g.internationalPhoneNumber || null },
    website: { website: g.websiteUri || null },
    business_status: { business_status: g.businessStatus || null },
  }
  if (g.location?.latitude != null && g.location?.longitude != null) {
    fields.location = { lat: g.location.latitude, lng: g.location.longitude }
  }
  // A place must keep a name; never blank it because Google omitted one.
  if (!fields.name.name) delete fields.name
  return fields
}

export class GooglePlaceNotFound extends Error {}

export async function fetchGooglePlace(googlePlaceId) {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw httpError(503, 'ยังไม่ได้ตั้งค่า GOOGLE_PLACES_API_KEY บนเซิร์ฟเวอร์')
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}?languageCode=th&regionCode=TH`
  const res = await fetch(url, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404) throw new GooglePlaceNotFound('Google ไม่พบสถานที่นี้แล้ว (place id อาจเปลี่ยนหรือถูกลบ)')
  if (!res.ok) {
    // Body can echo request details; log it, but keep the message user-safe.
    console.error(`Places API ${res.status} for ${googlePlaceId}:`, await res.text().catch(() => ''))
    throw new Error(`Google Places API ตอบกลับ ${res.status}`)
  }
  return res.json()
}

// Coalesces concurrent syncs of the same place (double click, an overlapping
// job) into one Google call + one write. Per-process, like the rest of the
// in-memory state here (see rateLimit.js / crudRouter.js).
const inFlight = new Map()

// Sync one place from Google.
//   fields  - which sync fields this run may touch (default: all)
//   dryRun  - compute the plan, write nothing
//   actorId - admin user id for the audit log (null for a future scheduler)
//   jobId   - recorded in the audit details when run from a job
// Never overwrites a locked field: when Google's value differs, it is parked
// in places.google_diff for an admin to accept or dismiss instead.
export function syncPlace(placeId, opts = {}) {
  const key = `${placeId}:${opts.dryRun ? 'dry' : 'live'}:${(opts.fields || SYNC_FIELDS).join(',')}`
  if (inFlight.has(key)) return inFlight.get(key)
  const p = runSync(placeId, opts).finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

async function runSync(placeId, { fields = SYNC_FIELDS, dryRun = false, actorId = null, jobId = null } = {}) {
  const wanted = SYNC_FIELDS.filter((f) => fields.includes(f))
  if (!wanted.length) throw httpError(400, 'กรุณาเลือกอย่างน้อย 1 ฟิลด์ที่จะซิงก์')

  const place = await db('places').select('id', 'google_place_id').where('id', placeId).first()
  if (!place) throw httpError(404, 'ไม่พบสถานที่')
  if (!place.google_place_id) throw httpError(400, 'สถานที่นี้ไม่ได้มาจาก Google จึงซิงก์ไม่ได้')

  const google = mapGoogleToFields(await fetchGooglePlace(place.google_place_id))

  // Re-read the row under a lock inside the write transaction: the plan is
  // computed against what is in the DB *now* (an admin may have edited and
  // locked a field while the Google call was in flight), and a second writer
  // waits instead of interleaving.
  return db.transaction(async (trx) => {
    const row = await trx('places').where('id', placeId).forUpdate().first()
    if (!row) throw httpError(404, 'ไม่พบสถานที่')

    const locked = new Set(row.locked_fields || [])
    const diff = { ...(row.google_diff || {}) }
    const patch = {}
    const changed = []
    const skippedLocked = []
    const resultDiff = {}

    for (const field of wanted) {
      const incoming = google[field]
      if (!incoming) continue // Google gave nothing usable for this field
      const cols = FIELD_COLUMNS[field]
      // hours_periods is a jsonb column: pg returns it parsed, incoming is a string.
      const differs = cols.some((c) => {
        if (!(c in incoming)) return false
        const cur = c === 'hours_periods' && row[c] != null ? JSON.stringify(row[c]) : row[c]
        return !sameValue(cur, incoming[c])
      })

      if (!differs) { delete diff[field]; continue }

      if (locked.has(field)) {
        skippedLocked.push(field)
        const current = Object.fromEntries(cols.filter((c) => c in incoming).map((c) => [c, row[c]]))
        diff[field] = { google: incoming, current, at: new Date().toISOString() }
        resultDiff[field] = { google: incoming, current }
      } else {
        Object.assign(patch, incoming)
        delete diff[field]
        changed.push(field)
        resultDiff[field] = { google: incoming, current: Object.fromEntries(cols.filter((c) => c in incoming).map((c) => [c, row[c]])) }
      }
    }

    const outcome = { placeId, status: changed.length ? 'updated' : (skippedLocked.length ? 'skipped' : 'unchanged'), changedFields: changed, skippedLocked, diff: resultDiff, dryRun }
    if (dryRun) return outcome

    const update = { ...patch, google_diff: JSON.stringify(diff), last_synced_at: trx.fn.now() }
    // name feeds the RAG embedding text, so a new name makes the vector stale
    // (same rule as crudRouter's invalidateColumns and the seeder's).
    if (changed.includes('name')) update.embedding = null
    await trx('places').where('id', placeId).update(update)

    if (changed.length) {
      // Fresh Google data for a field makes user reports about it moot.
      const reportFields = Object.entries(REPORT_TO_SYNC_FIELD).filter(([, s]) => changed.includes(s)).map(([r]) => r)
      if (reportFields.length) {
        await trx('place_reports').where({ place_id: placeId, status: 'pending' }).whereIn('field', reportFields).update({ status: 'superseded', resolved_at: trx.fn.now() })
      }
      await trx('admin_audit_log').insert({
        admin_id: actorId,
        action: 'place.sync',
        details: JSON.stringify({ placeId, name: row.name, changed, skippedLocked, jobId }),
      })
    }
    invalidateCache('places')
    return outcome
  })
}

// Admin resolves a parked Google value: accept = take Google's value and unlock
// the field; dismiss = keep the admin's value (field stays locked).
export async function resolveGoogleDiff(placeId, field, action, actorId) {
  if (!SYNC_FIELDS.includes(field)) throw httpError(400, 'ฟิลด์ไม่ถูกต้อง')
  if (!['accept', 'dismiss'].includes(action)) throw httpError(400, 'การกระทำไม่ถูกต้อง')
  return db.transaction(async (trx) => {
    const row = await trx('places').where('id', placeId).forUpdate().first()
    if (!row) throw httpError(404, 'ไม่พบสถานที่')
    const diff = { ...(row.google_diff || {}) }
    const entry = diff[field]
    if (!entry) throw httpError(404, 'ไม่มีค่าใหม่จาก Google ในฟิลด์นี้')
    delete diff[field]

    const update = { google_diff: JSON.stringify(diff) }
    if (action === 'accept') {
      Object.assign(update, entry.google)
      update.locked_fields = (row.locked_fields || []).filter((f) => f !== field)
      if (field === 'name') update.embedding = null
    }
    await trx('places').where('id', placeId).update(update)
    await trx('admin_audit_log').insert({
      admin_id: actorId,
      action: action === 'accept' ? 'place.google_diff_accept' : 'place.google_diff_dismiss',
      details: JSON.stringify({ placeId, name: row.name, field }),
    })
    invalidateCache('places')
    return { placeId, field, action }
  })
}
