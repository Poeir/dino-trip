import ImageSlot from './ImageSlot.jsx'

// The place-card look used across the admin (PlacesTab) and now the QR
// place picker (QrTab) -- pulled out here so both render the exact same
// card instead of two near-identical copies drifting apart over time.
// `children` is where each caller puts its own footer (admin action
// buttons, or nothing at all for a plain pick-a-place list).
export default function PlaceCard({ place, onClick, selected, dim, badge, children }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        border: selected ? '2px solid #2E7D32' : '1px solid #E7E3D2',
        borderRadius: 14,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        opacity: dim ? 0.55 : 1,
      }}
    >
      <div style={{ position: 'relative' }}>
        <ImageSlot src={place.img} shape="rect" style={{ width: '100%', height: 110 }} placeholder="ภาพสถานที่" />
        {badge && (
          <span style={{ position: 'absolute', top: 8, left: 8, background: '#3c463f', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>{badge}</span>
        )}
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{place.name}</div>
        <div style={{ fontSize: 12.5, color: '#6d7a72', marginBottom: children ? 10 : 0 }}>{place.category}{place.rating ? ` · ★ ${place.rating}` : ''}</div>
        {children}
      </div>
    </div>
  )
}
