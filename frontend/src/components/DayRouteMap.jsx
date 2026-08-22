import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '../lib/googleMapsLoader.js'

// Client-side key restricted by HTTP referrer in Google Cloud Console --
// safe to ship in the bundle (that's how Maps JS API keys are meant to
// work; the restriction, not secrecy, is what protects it). Separate from
// the backend's GOOGLE_PLACES_API_KEY, which must never be exposed here.
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

export default function DayRouteMap({ items }) {
  const containerRef = useRef(null)
  const [loadError, setLoadError] = useState(false)

  // Free-time filler blocks aren't real stops -- skip them for the map,
  // same as the itinerary line-drawing logic doesn't need them either.
  const points = items.filter((it) => it.status !== 'Free Time' && it.place && it.place.location)
  const pointsKey = points.map((p) => `${p.placeId}:${p.time}`).join('|')

  useEffect(() => {
    if (!API_KEY || points.length < 2 || !containerRef.current) return
    let cancelled = false

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

        new maps.Polyline({
          path: points.map((p) => p.place.location),
          map,
          strokeColor: '#66BB6A',
          strokeOpacity: 0.9,
          strokeWeight: 3,
        })

        points.forEach((p, i) => {
          const isHotel = p.status === 'End of Day (Return to Hotel)'
          new maps.Marker({
            position: p.place.location,
            map,
            title: p.place.name,
            label: { text: isHotel ? '🏠' : String(i + 1), color: '#fff', fontWeight: '800', fontSize: '12px' },
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 14,
              fillColor: isHotel ? '#FBC02D' : '#2E7D32',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2.5,
            },
          })
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
      <div style={{ fontSize: 10.5, color: '#8a938c', textAlign: 'center', marginTop: 6 }}>
        เส้นทางเรียงตามลำดับการเดินทาง (เส้นตรง ไม่ใช่เส้นทางถนนจริง)
      </div>
    </div>
  )
}
