import { db } from './db.js'
import { rowToPlace } from './mappers.js'
import { PLACE_COLUMNS, attachUploadedPhotos } from '../routes/places.routes.js'

export const tripRowToSummary = (row) => ({
  id: row.id,
  title: row.title,
  note: row.note,
  planningRationale: row.planning_rationale,
  totalDistanceKm: Number(row.total_distance_km),
  totalCostEstimate: Number(row.total_cost_estimate),
  startDate: row.start_date,
  dayCount: row.days,
  isFavorite: row.is_favorite,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

// List-card extras for a page of trips, in two queries for the whole page:
// how many real places each trip visits and the first of them as a cover image.
export async function attachTripPreviews(rows) {
  if (!rows.length) return []
  const items = await db('trip_items as i')
    .join('trip_days as d', 'd.id', 'i.day_id')
    .whereIn('d.trip_id', rows.map((r) => r.id))
    .where('i.kind', 'place')
    .select('d.trip_id', 'i.place_id')
    .orderBy(['d.trip_id', 'd.day_no', 'i.position'])

  const stats = new Map()
  for (const it of items) {
    const s = stats.get(it.trip_id) || { count: 0, coverId: null }
    s.count += 1
    if (!s.coverId && it.place_id) s.coverId = it.place_id
    stats.set(it.trip_id, s)
  }

  const coverIds = [...new Set([...stats.values()].map((s) => s.coverId).filter(Boolean))]
  const coverRows = coverIds.length ? await db('places').select(db.raw(PLACE_COLUMNS)).whereIn('id', coverIds) : []
  const imgById = new Map((await attachUploadedPhotos(coverRows)).map((r) => [r.id, rowToPlace(r).img]))

  return rows.map((r) => {
    const s = stats.get(r.id)
    return { ...tripRowToSummary(r), placeCount: s?.count || 0, coverImg: (s?.coverId && imgById.get(s.coverId)) || null }
  })
}

// A trip with its days and items. Each item carries the current `place` row
// (photos, QR points, isActive, ...) so the client can render it as-is, plus
// the name saved at planning time (placeName) for when the place has since been
// removed (place === null).
export async function loadTripDetail(tripRow) {
  const days = await db('trip_days').where('trip_id', tripRow.id).orderBy('day_no')
  const items = days.length
    ? await db('trip_items').whereIn('day_id', days.map((d) => d.id)).orderBy('position')
    : []

  const placeIds = [...new Set(items.map((i) => i.place_id).filter(Boolean))]
  const placeRows = placeIds.length ? await db('places').select(db.raw(PLACE_COLUMNS)).whereIn('id', placeIds) : []
  const placesById = new Map((await attachUploadedPhotos(placeRows)).map((r) => [r.id, rowToPlace(r)]))

  const itemsByDay = new Map()
  for (const it of items) {
    if (!itemsByDay.has(it.day_id)) itemsByDay.set(it.day_id, [])
    itemsByDay.get(it.day_id).push({
      id: it.id,
      position: it.position,
      kind: it.kind,
      lat: it.snapshot_lat,
      lng: it.snapshot_lng,
      placeId: it.place_id,
      placeName: it.place_name,
      arrivalTime: it.arrival_time,
      departureTime: it.departure_time,
      travelTimeMin: it.travel_time_min,
      distanceKm: Number(it.distance_km),
      status: it.status,
      waitTimeMin: it.wait_time_min,
      isAnchor: it.is_anchor,
      mealRole: it.meal_role,
      liked: it.liked,
      place: placesById.get(it.place_id) || null,
    })
  }

  return {
    ...tripRowToSummary(tripRow),
    input: tripRow.input,
    days: days.map((d) => ({
      dayNo: d.day_no,
      date: d.date,
      dayCostEstimate: Number(d.day_cost_estimate),
      dayTravelTimeTotal: d.day_travel_time_total,
      items: itemsByDay.get(d.id) || [],
    })),
  }
}
