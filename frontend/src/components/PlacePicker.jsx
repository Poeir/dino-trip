import { useState } from 'react'
import ImageSlot from './ImageSlot.jsx'
import PlaceCard from './PlaceCard.jsx'

// Search + a scrollable list of place cards (thumbnail, name, category) --
// for picking one place out of a list that can run into the hundreds. A
// plain <select> with that many options is unusable, and a text-only combobox
// still doesn't match how places are browsed everywhere else in this app
// (PlacesTab, PlacesListPage) -- a picture-backed card list. Once a place is
// picked, collapses to a single summary card with a "เปลี่ยน" (change) button
// instead of leaving the whole scrollable list open.
//
// `allowClear` adds a second button to unset the selection entirely (calls
// onChange('')) -- for a caller where the link is optional (EventsTab.jsx),
// as opposed to QrTab.jsx's usage where a QR always needs some place.
export default function PlacePicker({ places, value, onChange, allowClear }) {
  const [query, setQuery] = useState('')
  const [browsing, setBrowsing] = useState(!value)
  const selected = places.find((p) => p.id === value)

  if (!browsing && selected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, border: '1px solid #E7E3D2', background: '#fff' }}>
        <ImageSlot src={selected.img} shape="rounded" radius={10} style={{ width: 44, height: 44 }} placeholder={selected.name.slice(0, 2)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.name}</div>
          <div style={{ fontSize: 12, color: '#8a938c' }}>{selected.category}{selected.rating ? ` · ★ ${selected.rating}` : ''}</div>
        </div>
        <button type="button" onClick={() => { setQuery(''); setBrowsing(true) }} style={{ background: '#F1F8E9', color: '#2E7D32', border: 'none', padding: '7px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>เปลี่ยน</button>
        {allowClear && (
          <button type="button" onClick={() => onChange('')} aria-label="เลิกเชื่อมกับสถานที่นี้" style={{ background: '#fdecec', color: '#a33232', border: 'none', padding: '7px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>ล้าง</button>
        )}
      </div>
    )
  }

  const filtered = (query.trim()
    ? places.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : places
  ).slice(0, 30)

  return (
    <div>
      <input
        autoFocus={!!selected}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="พิมพ์ค้นหาชื่อสถานที่..."
        style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 8 }}
      />
      <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid #F0EDE0', borderRadius: 12, padding: 10, background: '#FBF8EE' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '16px 8px', textAlign: 'center', fontSize: 13, color: '#8a938c' }}>ไม่พบสถานที่ที่ตรงกับ "{query}"</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
            {filtered.map((p) => (
              <PlaceCard key={p.id} place={p} selected={p.id === value} onClick={() => { onChange(p.id); setBrowsing(false) }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
