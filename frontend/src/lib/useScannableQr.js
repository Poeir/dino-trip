import { useEffect, useState } from 'react'
import { fetchScannablePlaces } from './apiClient.js'

// places.qr_points is display-only; what a scan really awards is the QR's own
// `points` (claim_qr_scan), served by /api/qrs/meta/places. Place cards and the
// detail page read the badge from here so it can't disagree with the payout.
// One shared request per minute, not one per card.
const TTL_MS = 60 * 1000
let cache = null // { at, promise }

function loadScannable() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise
  const promise = fetchScannablePlaces()
    .then((rows) => new Map(rows.map((p) => [p.id, p.qrPoints])))
    .catch((err) => { cache = null; throw err })
  cache = { at: Date.now(), promise }
  return promise
}

// Returns `qrBadgePoints(place)`: the points a scan awards, or null when the
// place has no live QR. While loading it returns null (no badge rather than a
// possibly wrong number); if the request fails it falls back to the place's own
// hasQR/qrPoints.
export function useScannableQr() {
  const [state, setState] = useState({ status: 'loading', points: null })
  useEffect(() => {
    let alive = true
    loadScannable()
      .then((points) => { if (alive) setState({ status: 'ready', points }) })
      .catch(() => { if (alive) setState({ status: 'error', points: null }) })
    return () => { alive = false }
  }, [])
  return (place) => {
    if (!place) return null
    if (state.status === 'ready') return state.points.get(place.id) ?? null
    if (state.status === 'error') return place.hasQR ? place.qrPoints : null
    return null
  }
}
