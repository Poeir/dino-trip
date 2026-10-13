import { httpError } from '../middleware/errorHandler.js'

// Validates a "save this trip" request body into plain rows. The client sends
// the plan it got from chatbot-service, but nothing in it is trusted: numbers
// and strings are range/length checked, place ids are verified against the
// places table by the route, and place names are taken from there, not from
// the request.
export const MAX_TRIP_DAYS = 14
export const MAX_ITEMS_PER_DAY = 20
const MAX_TITLE = 120
const MAX_NOTE = 2000
const MAX_RATIONALE = 4000
const MAX_INPUT_BYTES = 8 * 1024

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const MEAL_ROLES = new Set(['lunch', 'dinner'])
const SLOT_KINDS = new Set(['place', 'hotel', 'free_time'])
const MAX_SLOT_NAME = 200
const bad = (what) => httpError(400, `ข้อมูลแผนทริปไม่ถูกต้อง: ${what}`)

const isRealDate = (s) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s

function text(value, max, what, { required = false } = {}) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (required && !s) throw bad(what)
  if (s.length > max) throw bad(`${what} ยาวเกินไป`)
  return s
}

function num(value, what, { max = 1e7, integer = false } = {}) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n) || n < 0 || n > max || (integer && !Number.isInteger(n))) throw bad(what)
  return n
}

function coord(value, min, max, what) {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n) || n < min || n > max) throw bad(what)
  return n
}

export function parseTripPayload(body) {
  if (!body || typeof body !== 'object') throw bad('ไม่มีข้อมูล')

  if (!Array.isArray(body.days) || body.days.length < 1 || body.days.length > MAX_TRIP_DAYS) throw bad(`จำนวนวันต้องอยู่ระหว่าง 1-${MAX_TRIP_DAYS}`)

  const input = body.input == null ? {} : body.input
  if (typeof input !== 'object' || Array.isArray(input)) throw bad('เงื่อนไขที่เลือก')
  const inputJson = JSON.stringify(input)
  if (Buffer.byteLength(inputJson) > MAX_INPUT_BYTES) throw bad('เงื่อนไขที่เลือกใหญ่เกินไป')

  const days = body.days.map((d, i) => {
    if (!d || typeof d !== 'object') throw bad(`วันที่ ${i + 1}`)
    if (!isRealDate(d.date)) throw bad(`วันที่ของวัน ${i + 1}`)
    if (!Array.isArray(d.items) || d.items.length > MAX_ITEMS_PER_DAY) throw bad(`รายการสถานที่ของวัน ${i + 1}`)
    return {
      day_no: i + 1,
      date: d.date,
      day_cost_estimate: num(d.dayCostEstimate, 'ค่าใช้จ่ายรายวัน', { max: 1e7 }),
      day_travel_time_total: num(d.dayTravelTimeTotal, 'เวลาเดินทางรายวัน', { max: 1440, integer: true }),
      items: d.items.map((it, j) => {
        if (!it || typeof it !== 'object') throw bad(`สถานที่ที่ ${j + 1} ของวัน ${i + 1}`)
        const kind = it.kind ?? 'place'
        if (!SLOT_KINDS.has(kind)) throw bad(`ประเภทของช่วงเวลาในวัน ${i + 1}`)
        // Only real places are looked up (and named) from the places table;
        // the hotel and free-time slots carry their own name and coordinates.
        let placeId = null
        let placeName = null
        let lat = null
        let lng = null
        if (kind === 'place') {
          if (typeof it.placeId !== 'string' || !UUID_RE.test(it.placeId)) throw bad(`รหัสสถานที่ของวัน ${i + 1}`)
          placeId = it.placeId.toLowerCase()
        } else {
          placeName = text(it.placeName, MAX_SLOT_NAME, `ชื่อช่วงเวลาในวัน ${i + 1}`, { required: true })
          lat = coord(it.lat, -90, 90, `พิกัดของวัน ${i + 1}`)
          lng = coord(it.lng, -180, 180, `พิกัดของวัน ${i + 1}`)
        }
        if (!TIME_RE.test(it.arrivalTime) || !TIME_RE.test(it.departureTime)) throw bad(`เวลาของวัน ${i + 1}`)
        if (it.mealRole != null && !MEAL_ROLES.has(it.mealRole)) throw bad(`ประเภทมื้ออาหารของวัน ${i + 1}`)
        if (it.liked != null && typeof it.liked !== 'boolean') throw bad(`คะแนนความชอบของวัน ${i + 1}`)
        return {
          position: j,
          kind,
          place_id: placeId,
          place_name: placeName,
          snapshot_lat: lat,
          snapshot_lng: lng,
          arrival_time: it.arrivalTime,
          departure_time: it.departureTime,
          travel_time_min: num(it.travelTimeMin, 'เวลาเดินทาง', { max: 1440, integer: true }),
          distance_km: num(it.distanceKm, 'ระยะทาง', { max: 5000 }),
          status: text(it.status, 40, 'สถานะ') || 'Open',
          wait_time_min: num(it.waitTimeMin, 'เวลารอ', { max: 1440, integer: true }),
          is_anchor: it.isAnchor === true,
          meal_role: it.mealRole ?? null,
          liked: it.liked ?? null,
        }
      }),
    }
  })

  for (let i = 1; i < days.length; i++) {
    if (days[i].date <= days[i - 1].date) throw bad('วันที่ต้องเรียงจากเก่าไปใหม่')
  }

  const startDate = days[0].date
  const title = text(body.title, MAX_TITLE, 'ชื่อทริป') || `ทริปขอนแก่น ${days.length} วัน (${startDate})`

  return {
    trip: {
      title,
      input: inputJson,
      note: text(body.note, MAX_NOTE, 'หมายเหตุ'),
      planning_rationale: text(body.planningRationale, MAX_RATIONALE, 'เหตุผลการจัดแผน'),
      total_distance_km: num(body.totalDistanceKm, 'ระยะทางรวม', { max: 50000 }),
      total_cost_estimate: num(body.totalCostEstimate, 'ค่าใช้จ่ายรวม', { max: 1e8 }),
      start_date: startDate,
      days: days.length,
    },
    days,
  }
}
