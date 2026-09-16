import { useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

// Almost every `src` (Cloudinary, a pasted URL) is already absolute. A few
// backend-served images (e.g. GET /api/users/:id/avatar) come back as a
// relative `/api/...` path though, pointing at the backend's own origin, not
// wherever this frontend happens to be served from -- resolve those here
// rather than using them as-is.
const resolveSrc = (src) => (src?.startsWith('/api/') ? `${API_BASE_URL}${src}` : src)

export default function ImageSlot({ src: rawSrc, shape = 'rounded', radius = 12, style = {}, placeholder = '', loading = false }) {
  const src = resolveSrc(rawSrc)
  // Tracks *which* src failed, not just a bare boolean -- otherwise once one
  // image 404s, a later src change on the same mounted instance (e.g. the
  // preview right after an upload replaces an empty/broken one) would stay
  // stuck showing the placeholder forever, since plain useState(!src) only
  // evaluates its initial value once, on mount.
  const [failedSrc, setFailedSrc] = useState(null)
  const failed = !src || failedSrc === src
  const borderRadius = shape === 'rect' ? 0 : shape === 'circle' ? '50%' : shape === 'pill' ? 999 : radius

  const boxStyle = {
    position: 'relative',
    borderRadius,
    overflow: 'hidden',
    background: failed ? 'linear-gradient(135deg,#C8E6C9,#A5D6A7)' : '#eee',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...style,
  }

  // Same spinner look used elsewhere (PointsPage.jsx, TripLoadingPage.jsx)
  // via the shared dc-spin keyframe in index.css, just sized down to fit here.
  const spinnerOverlay = loading && (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 22, height: 22, borderRadius: '50%', border: '3px solid #C8E6C9', borderTopColor: '#2E7D32', animation: 'dc-spin 0.8s linear infinite' }}></div>
    </div>
  )

  if (failed || !src) {
    return (
      <div style={boxStyle}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#2E7D32', textAlign: 'center', padding: 8 }}>
          {placeholder}
        </span>
        {spinnerOverlay}
      </div>
    )
  }

  return (
    <div style={boxStyle}>
      <img
        src={src}
        alt={placeholder}
        onError={() => setFailedSrc(src)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      {spinnerOverlay}
    </div>
  )
}
