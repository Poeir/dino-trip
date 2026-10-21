// Turns a saved trip (GET /api/trips/:id, and the admin's GET /api/admin/trips/:id,
// both built by the backend's loadTripDetail) into what TripDayCard renders.
// Shared by the tourist's trip page (AppContext) and the admin trip detail, so
// both show a plan the same way.

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

// Adds the display labels each item card shows: its time range and how long
// it lasts (or where the day ends, for the closing slot).
export function decorateTripDays(days) {
  return days.map((d) => ({
    ...d,
    items: d.items.map((it) => {
      const place = it.place || { name: '-', rating: '-', address: '-' }
      const isHotelReturn = it.status === HOTEL_RETURN_STATUS
      const isTripEnd = it.status === TRIP_END_STATUS
      const durationMin = (!isHotelReturn && !isTripEnd && it.time && it.departureTime)
        ? (hhmmToMinutes(it.departureTime) ?? 0) - (hhmmToMinutes(it.time) ?? 0)
        : null
      return {
        ...it, place,
        timeRangeLabel: (it.departureTime && it.departureTime !== it.time) ? `${it.time} - ${it.departureTime}` : it.time,
        durationLabel: isHotelReturn ? 'กลับถึงจุดเริ่มต้น'
          : isTripEnd ? `ถึง${place.name} (จบทริป)`
          : (formatDurationMinutes(durationMin) ? `อยู่ประมาณ ${formatDurationMinutes(durationMin)}` : null),
      }
    }),
  }))
}
