import { randomUUID } from 'node:crypto'
import { db } from '../lib/db.js'
import { httpError } from '../middleware/errorHandler.js'
import { apiKey, googleError, importGooglePlace } from './placeImport.js'
import { describeImportedPlace, MAX_DESCRIBE_PER_IMPORT } from './placeBulkDescribe.js'

// Admin "import many places around an area": resolve an area name to a point,
// list nearby places per category (cheap, no details), then import the ones the
// admin ticks as hidden drafts via the same importGooglePlace the single-place
// flow uses. Only the import step pays for the expensive Details call.

// searchNearby returns at most 20 per request and has no paging, so one request
// is made per ticked category.
export const AREA_CATEGORIES = {
  cafe: { label: 'คาเฟ่', types: ['cafe', 'coffee_shop'] },
  restaurant: { label: 'ร้านอาหาร', types: ['restaurant'] },
  attraction: { label: 'สถานที่ท่องเที่ยว', types: ['tourist_attraction', 'park', 'museum', 'art_gallery'] },
  shopping: { label: 'ช้อปปิ้ง', types: ['shopping_mall'] },
}
export const MIN_RADIUS_M = 500
export const MAX_RADIUS_M = 10_000
export const MAX_BATCH = 50
const IMPORT_CONCURRENCY = 2
const JOB_HISTORY = 20

const NEARBY_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.primaryType', 'places.businessStatus', 'places.rating', 'places.userRatingCount',
].join(',')

const KHON_KAEN_BIAS = { circle: { center: { latitude: 16.4322, longitude: 102.8236 }, radius: 50000 } }

async function resolveCenter(area) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location' },
    body: JSON.stringify({ textQuery: area, languageCode: 'th', regionCode: 'TH', pageSize: 1, locationBias: KHON_KAEN_BIAS }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw await googleError(res, 'searchText(area)')
  const hit = (await res.json()).places?.[0]
  if (!hit?.location) throw httpError(404, 'ไม่พบพื้นที่นี้ใน Google Maps ลองพิมพ์ชื่อให้เฉพาะเจาะจงขึ้น')
  return { lat: hit.location.latitude, lng: hit.location.longitude, label: hit.displayName?.text || area, address: hit.formattedAddress || '' }
}

async function searchNearby(center, radius, types) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': NEARBY_FIELD_MASK },
    body: JSON.stringify({
      includedTypes: types, maxResultCount: 20, rankPreference: 'POPULARITY', languageCode: 'th', regionCode: 'TH',
      locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius } },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw await googleError(res, 'searchNearby')
  return (await res.json()).places || []
}

// Returns { center, radius, results, found, hiddenClosed, hiddenFewReviews }.
// Closed-for-good places and ones under `minReviews` are dropped server side so
// they never reach the picker; places already in the DB are kept but flagged.
export async function searchArea({ area, radius, categories, minReviews }) {
  const name = String(area ?? '').trim()
  if (name.length < 2 || name.length > 200) throw httpError(400, 'กรุณาพิมพ์ชื่อพื้นที่ (2–200 ตัวอักษร)')
  const r = Number(radius)
  if (!Number.isInteger(r) || r < MIN_RADIUS_M || r > MAX_RADIUS_M) throw httpError(400, `รัศมีต้องอยู่ระหว่าง ${MIN_RADIUS_M}–${MAX_RADIUS_M} เมตร`)
  const cats = [...new Set(Array.isArray(categories) ? categories : [])]
  if (!cats.length || !cats.every((c) => AREA_CATEGORIES[c])) throw httpError(400, 'กรุณาเลือกหมวดหมู่อย่างน้อย 1 หมวด')
  const minRev = minReviews == null || minReviews === '' ? 0 : Number(minReviews)
  if (!Number.isInteger(minRev) || minRev < 0 || minRev > 10_000) throw httpError(400, 'จำนวนรีวิวขั้นต่ำไม่ถูกต้อง')

  const center = await resolveCenter(name)
  const batches = await Promise.all(cats.map((c) => searchNearby(center, r, AREA_CATEGORIES[c].types)))

  const byId = new Map()
  batches.forEach((places, i) => {
    for (const p of places) if (!byId.has(p.id)) byId.set(p.id, { p, category: cats[i] })
  })

  let hiddenClosed = 0
  let hiddenFewReviews = 0
  const kept = []
  for (const { p, category } of byId.values()) {
    if (p.businessStatus === 'CLOSED_PERMANENTLY') { hiddenClosed++; continue }
    if ((p.userRatingCount || 0) < minRev) { hiddenFewReviews++; continue }
    kept.push({ p, category })
  }

  const existing = kept.length
    ? await db('places').select('id', 'google_place_id').whereIn('google_place_id', kept.map((k) => k.p.id))
    : []
  const existingByGid = new Map(existing.map((e) => [e.google_place_id, e.id]))

  const results = kept
    .map(({ p, category }) => ({
      googlePlaceId: p.id,
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      primaryType: p.primaryType || null,
      businessStatus: p.businessStatus || null,
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? 0,
      category,
      existingPlaceId: existingByGid.get(p.id) || null,
    }))
    .sort((a, b) => b.reviewCount - a.reviewCount)

  return { center, radius: r, results, found: byId.size, hiddenClosed, hiddenFewReviews }
}

// ---------------------------------------------------------------- batch import job
// In memory on purpose: every imported place is already a durable draft row, so
// a restart only loses the progress display, never data. One job at a time.
const jobs = new Map()
let runningJobId = null

function publicJob(job) {
  const { cancelRequested, ...rest } = job
  return rest
}

export function startImportJob(googlePlaceIds, actorId, { describe = false } = {}) {
  const ids = [...new Set(Array.isArray(googlePlaceIds) ? googlePlaceIds : [])]
  if (!ids.length) throw httpError(400, 'กรุณาเลือกสถานที่อย่างน้อย 1 แห่ง')
  if (ids.length > MAX_BATCH) throw httpError(400, `นำเข้าได้สูงสุด ${MAX_BATCH} แห่งต่อครั้ง`)
  if (describe && ids.length > MAX_DESCRIBE_PER_IMPORT) throw httpError(400, `การสร้างคำอธิบายด้วย AI ทำได้สูงสุด ${MAX_DESCRIBE_PER_IMPORT} แห่งต่อครั้ง ลดจำนวนที่เลือกหรือปิดตัวเลือกนี้`)
  if (!ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 300)) throw httpError(400, 'google place id ไม่ถูกต้อง')
  if (runningJobId) throw httpError(409, 'มีงานนำเข้ากำลังทำงานอยู่ กรุณารอให้เสร็จหรือยกเลิกก่อน')

  const job = {
    id: randomUUID(), status: 'running', total: ids.length, done: 0, created: 0, existed: 0, failed: 0,
    describe, described: 0,
    results: [], startedAt: new Date().toISOString(), finishedAt: null, cancelRequested: false,
  }
  jobs.set(job.id, job)
  for (const oldId of [...jobs.keys()].slice(0, Math.max(0, jobs.size - JOB_HISTORY))) jobs.delete(oldId)
  runningJobId = job.id

  runImportJob(job, ids, actorId, describe)
    .catch((err) => { console.error('Area import job crashed:', err); job.status = 'failed' })
    .finally(() => { job.finishedAt = new Date().toISOString(); runningJobId = null })
  return publicJob(job)
}

async function runImportJob(job, ids, actorId, describe) {
  let cursor = 0
  const worker = async () => {
    while (!job.cancelRequested) {
      const i = cursor++
      if (i >= ids.length) return
      const googlePlaceId = ids[i]
      try {
        const r = await importGooglePlace(googlePlaceId, actorId)
        if (r.created) job.created++; else job.existed++
        const item = { googlePlaceId, status: r.created ? 'created' : 'exists', placeId: r.id }
        // Only brand-new drafts: an already-imported place may have been reviewed and edited.
        if (describe && r.created) {
          const d = await describeImportedPlace(r.id)
          item.description = d.status
          if (d.reason) item.descriptionNote = d.reason
          if (d.status === 'updated') job.described++
        }
        job.results.push(item)
      } catch (err) {
        job.failed++
        // Raw driver/Google text stays in the server log, not in a row admins read.
        if (!err.status) console.error(`Area import failed for ${googlePlaceId}:`, err)
        job.results.push({ googlePlaceId, status: 'failed', error: (err.status ? err.message : 'นำเข้าไม่สำเร็จ').slice(0, 300) })
      }
      job.done++
    }
  }
  await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, ids.length) }, worker))
  job.status = job.cancelRequested ? 'cancelled' : 'completed'
  await db('admin_audit_log').insert({
    admin_id: actorId, action: 'place.import_area_batch',
    details: JSON.stringify({ jobId: job.id, total: job.total, created: job.created, existed: job.existed, failed: job.failed, described: job.described, status: job.status }),
  }).catch((err) => console.error('Area import audit log failed:', err))
}

export function getImportJob(jobId) {
  const job = jobs.get(jobId)
  if (!job) throw httpError(404, 'ไม่พบงานนำเข้านี้ (อาจหมดอายุหลังเซิร์ฟเวอร์รีสตาร์ท)')
  return publicJob(job)
}

export function cancelImportJob(jobId) {
  const job = jobs.get(jobId)
  if (!job || job.status !== 'running') throw httpError(404, 'ไม่พบงานที่กำลังทำงานอยู่')
  job.cancelRequested = true // takes effect before the next item; in-flight ones finish
  return publicJob(job)
}
