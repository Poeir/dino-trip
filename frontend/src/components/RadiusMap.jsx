import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '../lib/googleMapsLoader.js'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// Read-only map: a pin at `center` and a circle of `radiusM` metres around it,
// re-fitted whenever the radius changes so the whole circle stays in view.
export default function RadiusMap({ center, radiusM, height = 220 }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const circleRef = useRef(null)
  const [loadError, setLoadError] = useState(!API_KEY)

  const radius = Number(radiusM) > 0 ? Number(radiusM) : 0

  useEffect(() => {
    if (!API_KEY) return
    let cancelled = false
    loadGoogleMaps(API_KEY)
      .then((maps) => {
        if (cancelled || !containerRef.current) return
        const map = new maps.Map(containerRef.current, {
          center, zoom: 16, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative',
        })
        markerRef.current = new maps.Marker({ position: center, map })
        circleRef.current = new maps.Circle({
          map, center, radius,
          strokeColor: '#2E7D32', strokeOpacity: 0.9, strokeWeight: 2,
          fillColor: '#66BB6A', fillOpacity: 0.22,
        })
        mapRef.current = map
        if (radius > 0) map.fitBounds(circleRef.current.getBounds())
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const circle = circleRef.current
    if (!map || !circle) return
    markerRef.current.setPosition(center)
    circle.setCenter(center)
    circle.setRadius(radius)
    circle.setVisible(radius > 0)
    if (radius > 0) map.fitBounds(circle.getBounds())
    else map.setCenter(center)
  }, [center.lat, center.lng, radius])

  if (loadError) {
    return <div style={{ fontSize: 12, color: '#626863' }}>โหลดแผนที่ไม่สำเร็จ หรือยังไม่ได้ตั้งค่า VITE_GOOGLE_MAPS_API_KEY</div>
  }
  return <div ref={containerRef} style={{ width: '100%', height, borderRadius: 12, background: '#F0EDE0' }} />
}
