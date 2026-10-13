// Google Maps "Directions" deep links (no API key; opens the Maps app on phones).
// A link takes an origin, a destination and at most 9 waypoints, so a longer day
// is split into consecutive legs that share their joining stop.
//
// Stops are sent by name so Maps shows the place, not bare coordinates: a stop
// with a Google place id is matched exactly (the name is only the label);
// otherwise "name address" is searched as text.
const MAX_STOPS_PER_LINK = 11

const stopText = (place) => [place.name, place.address].filter(Boolean).join(' ')

// `items` are a day's itinerary items; returns [] when fewer than 2 real stops.
// `googleIds` maps our place id -> Google place id for places the plan data lacks it for.
export function dayDirectionsUrls(items, googleIds = {}) {
  const stops = items
    .filter((it) => it.status !== 'Free Time' && it.place && (it.place.googlePlaceId || it.place.name))
    .map((it) => ({ ...it.place, googlePlaceId: it.place.googlePlaceId || googleIds[it.place.id] || null }))
  if (stops.length < 2) return []

  const urls = []
  for (let start = 0; start < stops.length - 1; start += MAX_STOPS_PER_LINK - 1) {
    const leg = stops.slice(start, start + MAX_STOPS_PER_LINK)
    if (leg.length < 2) break
    const first = leg[0]
    const last = leg[leg.length - 1]
    const mids = leg.slice(1, -1)
    // Origin and destination take their own place id; waypoints only accept ids
    // for all of them or none.
    const wayIds = mids.length > 0 && mids.every((p) => p.googlePlaceId)
    const text = (p, withId) => (withId ? p.name || stopText(p) : stopText(p))

    const params = new URLSearchParams({
      api: '1',
      travelmode: 'driving',
      origin: text(first, first.googlePlaceId),
      destination: text(last, last.googlePlaceId),
    })
    if (first.googlePlaceId) params.set('origin_place_id', first.googlePlaceId)
    if (last.googlePlaceId) params.set('destination_place_id', last.googlePlaceId)
    if (mids.length) {
      params.set('waypoints', mids.map((p) => text(p, wayIds)).join('|'))
      if (wayIds) params.set('waypoint_place_ids', mids.map((p) => p.googlePlaceId).join('|'))
    }
    urls.push(`https://www.google.com/maps/dir/?${params.toString()}`)
  }
  return urls
}
