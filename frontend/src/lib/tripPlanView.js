// Turns a saved trip (GET /api/trips/:id, and the admin's GET /api/admin/trips/:id,
// both built by the backend's loadTripDetail) into what TripDayCard renders.
// Shared by the tourist's trip page (AppContext) and the admin trip detail, so
// both show a plan the same way.

import { haversineKm } from '../utils/geo.js'

// Statuses of chatbot-service's synthetic slots (no places row behind them).
export const HOTEL_RETURN_STATUS = 'End of Day (Return to Hotel)'
export const TRIP_END_STATUS = 'End of Trip'

// "HH:MM" -> minutes since midnight (times arrive as display strings).
export const hhmmToMinutes = (hhmm) => {
  if (!hhmm || typeof hhmm !== 'string' || !hhmm.includes(':')) return null
  const [h, m] = hhmm.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

export const formatDurationMinutes = (mins) => {
  if (mins == null || mins <= 0) return null
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} นาที`
  if (m === 0) return `${h} ชม.`
  return `${h} ชม. ${m} นาที`
}

// A fetched place row trimmed to what a plan item shows.
export const toTripPlace = (p) => ({
  id: p.id, name: p.name, category: p.category, rating: p.rating, address: p.address, img: p.img,
  location: (p.location?.lat != null && p.location?.lng != null) ? p.location : null,
})

// Hotel / trip-end / free-time slots have no places row, so they get the same
// synthetic ids chatbot-service gave them; a place deleted since planning
// falls back to the name saved with the trip.
export function tripDetailToPlan(detail) {
  const days = detail.days.map((d) => ({
    dayNum: d.dayNo,
    date: d.date,
    dayCostEstimate: d.dayCostEstimate,
    dayTravelTimeTotal: d.dayTravelTimeTotal,
    items: d.items.map((it) => {
      const placeId = it.kind === 'place' ? (it.placeId || `removed_${d.dayNo}_${it.position}`)
        : it.kind === 'hotel' ? 'hotel_dummy' : it.kind === 'trip_end' ? 'trip_end' : `free_time_dummy_${d.dayNo}_${it.position}`
      const location = it.lat != null && it.lng != null ? { lat: it.lat, lng: it.lng } : null
      return {
        itemId: it.id, placeId, kind: it.kind, time: it.arrivalTime, departureTime: it.departureTime, status: it.status, liked: it.liked,
        distanceFromPrev: it.distanceKm || null, travelTimeMin: it.travelTimeMin, waitTimeMin: it.waitTimeMin, isAnchor: it.isAnchor, mealRole: it.mealRole,
        place: it.place
          ? { ...toTripPlace(it.place), hasQR: it.place.hasQR, qrPoints: it.place.qrPoints }
          : { id: placeId, name: it.placeName, category: it.kind === 'hotel' ? 'ที่พัก' : it.kind === 'trip_end' ? 'จุดจบทริป' : null, rating: '-', address: '', img: null, location },
      }
    }),
  }))
  const totalPoints = days.flatMap((d) => d.items).reduce((sum, it) => sum + (it.place.hasQR ? it.place.qrPoints : 0), 0)
  return { days, totalBudget: detail.totalCostEstimate, totalDistance: detail.totalDistanceKm, totalPoints }
}

// Where to stay, for a trip planned without a start point (the planner then
// used the city centre). Each night links the last stop of one day to the
// first stop of the next, so the best area is near those stops: their centre,
// named after the trip place closest to it. Stops spread far apart (one day
// out in another district) make that centre meaningless, so the city centre
// is suggested instead. Null when there is no night to plan for.
const CITY_CENTRE = { lat: 16.4322, lng: 102.8236 }
const MAX_SPREAD_KM = 20
const MAX_LANDMARK_KM = 3
const LANDMARK_SKIP_CATEGORIES = new Set(['ร้านอาหาร', 'คาเฟ่'])

const hotelSearchUrl = ({ lat, lng }) =>
  `https://www.google.com/maps/search/${encodeURIComponent('โรงแรม')}/@${lat.toFixed(5)},${lng.toFixed(5)},15z`

export function suggestStayArea(days) {
  const placeStops = (d) => d.items.filter((it) => it.kind === 'place' && it.place?.location)
  const nightStops = []
  for (let i = 0; i < days.length - 1; i += 1) {
    const tonight = placeStops(days[i])
    const tomorrow = placeStops(days[i + 1])
    if (tonight.length) nightStops.push(tonight[tonight.length - 1].place.location)
    if (tomorrow.length) nightStops.push(tomorrow[0].place.location)
  }
  if (!nightStops.length) return null

  const centre = {
    lat: nightStops.reduce((sum, p) => sum + p.lat, 0) / nightStops.length,
    lng: nightStops.reduce((sum, p) => sum + p.lng, 0) / nightStops.length,
  }
  const farthestKm = Math.max(...nightStops.map((p) => haversineKm(centre, p)))
  if (farthestKm > MAX_SPREAD_KM) {
    return {
      area: 'ตัวเมืองขอนแก่น',
      reason: 'ที่เที่ยวในทริปนี้อยู่คนละทิศ พักในเมืองจะไปต่อได้ทุกทาง และมีที่พักให้เลือกเยอะ',
      searchUrl: hotelSearchUrl(CITY_CENTRE),
    }
  }

  // A sight names an area better than a restaurant or cafe does.
  const byDistance = (stops) => stops
    .map((it) => ({ name: it.place.name, km: haversineKm(centre, it.place.location) }))
    .filter((c) => c.km <= MAX_LANDMARK_KM)
    .sort((a, b) => a.km - b.km)[0]
  const allStops = days.flatMap(placeStops)
  const landmark = byDistance(allStops.filter((it) => !LANDMARK_SKIP_CATEGORIES.has(it.place.category))) || byDistance(allStops)
  return {
    area: landmark ? `แถว${landmark.name}` : 'ย่านกลางเส้นทางทริป',
    reason: `ห่างจุดเริ่มและจุดจบของแต่ละวันไม่เกินประมาณ ${Math.max(1, Math.ceil(farthestKm))} กม. (วัดเป็นเส้นตรง)`,
    searchUrl: hotelSearchUrl(centre),
  }
}

// Every day starts at the accommodation, but the planner's schedule only has
// the closing "back to the hotel" slot, not the departure. These build that
// missing first stop for display only (it is never saved).
export const DAY_START_STATUS = 'Start of Day'

// Where the trip starts according to its conditions (trip form or saved
// input): the start point the user picked, else the city centre the planner
// uses (chatbot-service orchestrator.DEFAULT_HOTEL_LOCATION). A name without
// coordinates was matched to a place server-side, so its location is unknown
// here (the day's hotel slot normally supplies it).
export function tripStartFallback({ name, lat, lng } = {}) {
  if (lat != null && lng != null) return { name: name || 'จุดเริ่มต้น', location: { lat, lng } }
  if (name) return { name, location: null }
  return { name: 'ใจกลางเมืองขอนแก่น', location: CITY_CENTRE }
}

const minutesToHhmm = (mins) => {
  const m = ((mins % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function dayStartItem(day, hotelSlot, fallback) {
  const first = day.items[0]
  if (!first) return null
  const start = hotelSlot
    ? { name: hotelSlot.place.name, location: hotelSlot.place.location || fallback?.location || null }
    : fallback
  if (!start) return null
  // The first stop's travel leg is measured from the start point.
  const arrival = hhmmToMinutes(first.time)
  const time = arrival == null ? first.time : minutesToHhmm(arrival - (first.travelTimeMin || 0))
  return {
    placeId: `day_start_${day.dayNum}`, kind: 'start', status: DAY_START_STATUS,
    time, departureTime: time, distanceFromPrev: null,
    place: { id: `day_start_${day.dayNum}`, name: start.name, category: 'ที่พัก', rating: '-', address: '', img: null, location: start.location },
  }
}

// Adds the display labels each item card shows: its time range and how long
// it lasts (or where the day ends, for the closing slot), plus each day's
// departure from the start point. `startFallback` (see tripStartFallback) is
// used when the plan has no hotel slot to copy it from (a one-day trip that
// ends at an airport/bus terminal/district).
export function decorateTripDays(days, startFallback = null) {
  const anyHotelSlot = days.flatMap((d) => d.items).find((it) => it.status === HOTEL_RETURN_STATUS)
  return days.map((d) => {
    const hotelSlot = d.items.find((it) => it.status === HOTEL_RETURN_STATUS) || anyHotelSlot
    const startItem = dayStartItem(d, hotelSlot, startFallback)
    return {
      ...d,
      items: (startItem ? [startItem, ...d.items] : d.items).map((it) => {
        const place = it.place || { name: '-', rating: '-', address: '-' }
        const isHotelReturn = it.status === HOTEL_RETURN_STATUS
        const isTripEnd = it.status === TRIP_END_STATUS
        const isDayStart = it.status === DAY_START_STATUS
        const durationMin = (!isHotelReturn && !isTripEnd && !isDayStart && it.time && it.departureTime)
          ? (hhmmToMinutes(it.departureTime) ?? 0) - (hhmmToMinutes(it.time) ?? 0)
          : null
        return {
          ...it, place,
          timeRangeLabel: (it.departureTime && it.departureTime !== it.time) ? `${it.time} - ${it.departureTime}` : it.time,
          durationLabel: isDayStart ? 'ออกเดินทาง'
            : isHotelReturn ? 'กลับถึงจุดเริ่มต้น'
            : isTripEnd ? `ถึง${place.name} (จบทริป)`
            : (formatDurationMinutes(durationMin) ? `อยู่ประมาณ ${formatDurationMinutes(durationMin)}` : null),
        }
      }),
    }
  })
}
