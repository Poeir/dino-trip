import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '../lib/googleMapsLoader.js'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// Khon Kaen city center -- same point fetch-places.js's discovery grid is
// built around (backend/scripts/fetch-places.js), reused here just as the
// map's default view before anything is picked yet.
const DEFAULT_CENTER = { lat: 16.4419, lng: 102.8360 }

// Address/venue search + a draggable pin, backed by the Google Maps JS API
// (already loaded elsewhere for DayRouteMap.jsx -- see googleMapsLoader.js).
// Two ways in: type into the search box and pick an Autocomplete suggestion
// (fires both onChange and onSelectPlace, since a search hit also carries a
// name/address the caller may want), or drag the pin directly (onChange
// only). Manual lat/lng inputs are the fallback when the script fails to
// load, same reasoning as DayRouteMap's loadError state.
export default function LocationPicker({ value, onChange, onSelectPlace, height = 220 }) {
  const mapContainerRef = useRef(null)
  const inputRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const autocompleteRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const onSelectPlaceRef = useRef(onSelectPlace)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')

  onChangeRef.current = onChange
  onSelectPlaceRef.current = onSelectPlace

  useEffect(() => {
    if (!API_KEY) { setLoadError(true); return }
    let cancelled = false

    loadGoogleMaps(API_KEY)
      .then((maps) => {
        if (cancelled || !mapContainerRef.current) return

        const center = value || DEFAULT_CENTER
        const map = new maps.Map(mapContainerRef.current, {
          center, zoom: value ? 16 : 13,
          disableDefaultUI: true, zoomControl: true,
          gestureHandling: 'cooperative',
        })
        const marker = new maps.Marker({ position: center, map, draggable: true })
        marker.addListener('dragend', () => {
          const pos = marker.getPosition()
          onChangeRef.current?.({ lat: pos.lat(), lng: pos.lng() })
        })
        mapRef.current = map
        markerRef.current = marker

        if (inputRef.current) {
          // Biased to (not restricted to) Khon Kaen -- this app only covers
          // that province (see AddressComposer.jsx), but Google-imported
          // venues occasionally sit just across a district line, and an
          // event could plausibly be held anywhere nearby too.
          const bounds = new maps.LatLngBounds(
            { lat: DEFAULT_CENTER.lat - 0.5, lng: DEFAULT_CENTER.lng - 0.5 },
            { lat: DEFAULT_CENTER.lat + 0.5, lng: DEFAULT_CENTER.lng + 0.5 },
          )
          const autocomplete = new maps.places.Autocomplete(inputRef.current, {
            bounds, componentRestrictions: { country: 'th' },
            fields: ['geometry', 'name', 'formatted_address'],
          })
          autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace()
            if (!place.geometry?.location) return
            const loc = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() }
            map.setCenter(loc)
            map.setZoom(16)
            marker.setPosition(loc)
            onChangeRef.current?.(loc)
            onSelectPlaceRef.current?.({ ...loc, name: place.name, address: place.formatted_address })
          })
          autocompleteRef.current = autocomplete
        }
      })
      .catch(() => { if (!cancelled) setLoadError(true) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keeps the pin in sync if `value` changes from outside (e.g. switching
  // which place is being edited) without re-creating the whole map.
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !value) return
    markerRef.current.setPosition(value)
    mapRef.current.setCenter(value)
  }, [value?.lat, value?.lng])

  const setManual = (field, raw) => {
    const n = parseFloat(raw)
    const next = { lat: value?.lat ?? DEFAULT_CENTER.lat, lng: value?.lng ?? DEFAULT_CENTER.lng, [field]: raw === '' ? NaN : n }
    if (Number.isFinite(next.lat) && Number.isFinite(next.lng)) onChange?.(next)
  }

  return (
    <div>
      {!loadError && (
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาสถานที่หรือที่อยู่บน Google Maps..."
          style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 8 }}
        />
      )}
      {loadError ? (
        <div style={{ fontSize: 12, color: '#8a938c', marginBottom: 8 }}>โหลดแผนที่ไม่สำเร็จ -- กรอกพิกัดด้วยตัวเองด้านล่าง</div>
      ) : (
        <div ref={mapContainerRef} style={{ width: '100%', height, borderRadius: 12, marginBottom: 8, background: '#F0EDE0' }} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input
          type="number" step="any" placeholder="ละติจูด (lat)"
          value={value?.lat ?? ''} onChange={(e) => setManual('lat', e.target.value)}
          style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 8, fontSize: 13 }}
        />
        <input
          type="number" step="any" placeholder="ลองจิจูด (lng)"
          value={value?.lng ?? ''} onChange={(e) => setManual('lng', e.target.value)}
          style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 8, fontSize: 13 }}
        />
      </div>
    </div>
  )
}
