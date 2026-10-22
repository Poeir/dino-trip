import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '../lib/googleMapsLoader.js'

// Client-side key restricted by HTTP referrer in Google Cloud Console --
// safe to ship in the bundle (that's how Maps JS API keys are meant to
// work; the restriction, not secrecy, is what protects it). Separate from
// the backend's GOOGLE_PLACES_API_KEY, which must never be exposed here.
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
// Directions allows 25 waypoints + origin + destination per request.
const MAX_DIRECTIONS_POINTS = 27

// sessionStorage can be unavailable or full (private mode, quota), so both
// helpers swallow errors -- a cache miss just means another Directions call.
function readCachedPath(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCachedPath(key, path) {
  try {
    sessionStorage.setItem(key, JSON.stringify(path))
  } catch { /* ignore */ }
}

export default function DayRouteMap({ items, onSelectPlace }) {
  const containerRef = useRef(null)
  const [loadError, setLoadError] = useState(false)
  const [routeKind, setRouteKind] = useState(null) // 'road' | 'straight' once resolved

  // Free-time filler blocks aren't real stops -- skip them for the map,
  // same as the itinerary line-drawing logic doesn't need them either.
  const points = items.filter((it) => it.status !== 'Free Time' && it.place && it.place.location)
  const pointsKey = points.map((p) => `${p.placeId}:${p.time}`).join('|')
  // Geometry depends only on the stop order and coordinates, not on times.
  const routeCacheKey = 'dayRoute:' + points.map((p) => `${p.place.location.lat},${p.place.location.lng}`).join('|')

  useEffect(() => {
    if (!API_KEY || points.length < 2 || !containerRef.current) return
    let cancelled = false
    setRouteKind(null)

    loadGoogleMaps(API_KEY)
      .then((maps) => {
        if (cancelled || !containerRef.current) return

        const map = new maps.Map(containerRef.current, {
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative', // page still scrolls normally over the map
        })

        const bounds = new maps.LatLngBounds()
        points.forEach((p) => bounds.extend(p.place.location))
        map.fitBounds(bounds, 44)

        const lineStyle = { strokeColor: '#66BB6A', strokeOpacity: 0.9, strokeWeight: 4 }
        const drawStraightLine = () => {
          new maps.Polyline({ path: points.map((p) => p.place.location), map, ...lineStyle, strokeWeight: 3 })
          if (!cancelled) setRouteKind('straight')
        }

        // Road geometry is for drawing only -- the schedule's travel times come
        // from the planner's straight-line estimate, hence the caption below.
        // Any failure (API not enabled, quota, too many stops) falls back to
        // the straight line so the map never ends up empty.
        const drawRoad = (path) => {
          new maps.Polyline({ path, map, ...lineStyle })
          setRouteKind('road')
        }

        if (points.length > MAX_DIRECTIONS_POINTS) {
          drawStraightLine()
        } else {
          // Each Directions call is billed, so a path already fetched in this
          // session (same stops in the same order) is reused instead.
          const cached = readCachedPath(routeCacheKey)
          if (cached) {
            drawRoad(cached)
          } else {
            new maps.DirectionsService()
              .route({
                origin: points[0].place.location,
                destination: points[points.length - 1].place.location,
                waypoints: points.slice(1, -1).map((p) => ({ location: p.place.location, stopover: true })),
                travelMode: maps.TravelMode.DRIVING,
              })
              .then((result) => {
                const path = result.routes[0].overview_path.map((ll) => ({ lat: ll.lat(), lng: ll.lng() }))
                writeCachedPath(routeCacheKey, path)
                if (!cancelled) drawRoad(path)
              })
              .catch(drawStraightLine)
          }
        }

        // Only real stops are numbered, so the departure point doesn't shift them.
        let stopNo = 0
        points.forEach((p) => {
          // The day's departure point and its return share the hotel marker.
          const isHotel = p.status === 'End of Day (Return to Hotel)' || p.kind === 'start'
          // The last day's end point (airport, bus terminal, district...) instead of the hotel.
          const isTripEnd = p.status === 'End of Trip'
          if (!isHotel && !isTripEnd) stopNo += 1
          const marker = new maps.Marker({
            position: p.place.location,
            map,
            title: p.kind === 'start' ? `ออกเดินทางจาก ${p.place.name}` : p.place.name,
            label: { text: isHotel ? '🏠' : isTripEnd ? '🏁' : String(stopNo), color: '#fff', fontWeight: '800', fontSize: '12px' },
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 14,
              fillColor: isHotel ? '#FBC02D' : isTripEnd ? '#C62828' : '#2E7D32',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2.5,
            },
          })
          if (onSelectPlace && p.kind !== 'start') marker.addListener('click', () => onSelectPlace(p.placeId))
        })
      })
      .catch(() => { if (!cancelled) setLoadError(true) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey])

  if (points.length < 2) return null

  if (!API_KEY) {
    return (
      <div style={{ background: '#FFF8E1', border: '1px solid #FBC02D', borderRadius: 16, padding: '14px 16px', marginBottom: 18, fontSize: 12.5, color: '#8a6d00' }}>
        ยังไม่ได้ตั้งค่า Google Maps API key -- ใส่ VITE_GOOGLE_MAPS_API_KEY ในไฟล์ frontend/.env เพื่อแสดงแผนที่เส้นทาง
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div ref={containerRef} style={{ width: '100%', height: 260, borderRadius: 16, border: '1px solid #E7E3D2', background: '#eef2ee' }} />
      {loadError && (
        <div style={{ fontSize: 11.5, color: '#a33232', marginTop: 6 }}>โหลดแผนที่ไม่สำเร็จ ลองตรวจสอบ API key หรือลองรีเฟรชอีกครั้ง</div>
      )}
      <div style={{ fontSize: 10.5, color: '#626863', textAlign: 'center', marginTop: 6 }}>
        {routeKind === 'road'
          ? 'เส้นทางถนนตามลำดับการเดินทาง · เวลาเดินทางในตารางเป็นค่าประมาณ อาจต่างจากเส้นทางจริง'
          : 'เส้นทางเรียงตามลำดับการเดินทาง (เส้นตรง ไม่ใช่เส้นทางถนนจริง)'}
      </div>
    </div>
  )
}
