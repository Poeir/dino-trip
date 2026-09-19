import { useState } from 'react'
import ImageSlot from './ImageSlot.jsx'
import PlaceCard from './PlaceCard.jsx'
import LocationPicker from './LocationPicker.jsx'

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
//
// `onAddFromGoogle`, if given, adds a second tab for venues that aren't in
// `places` yet but exist on Google Maps (e.g. a one-off event ground) --
// search+pin via LocationPicker, then hand {name,address,lat,lng} to the
// caller, which is expected to create a real places row and update its own
// `value`/`places` before this resolves. QrTab doesn't pass this prop: a QR
// needs a reviewed, curated place, not a venue quick-added mid-search.
export default function PlacePicker({ places, value, onChange, allowClear, onAddFromGoogle }) {
  const [query, setQuery] = useState('')
  const [browsing, setBrowsing] = useState(!value)
  const [mode, setMode] = useState('system')
  const [googleLoc, setGoogleLoc] = useState(null)
  const [googleName, setGoogleName] = useState('')
  const [googleAddress, setGoogleAddress] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const selected = places.find((p) => p.id === value)

  const resetGoogleMode = () => {
    setMode('system')
    setGoogleLoc(null)
    setGoogleName('')
    setGoogleAddress('')
    setAddError('')
  }

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

  const handleAddFromGoogle = async () => {
    if (!googleLoc || !googleName.trim()) return
    setAdding(true)
    setAddError('')
    try {
      await onAddFromGoogle({ name: googleName.trim(), address: googleAddress, lat: googleLoc.lat, lng: googleLoc.lng })
      resetGoogleMode()
      setBrowsing(false)
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div>
      {onAddFromGoogle && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button type="button" onClick={() => setMode('system')} style={{ flex: 1, background: mode === 'system' ? '#E8F5E9' : '#fff', color: mode === 'system' ? '#2E7D32' : '#6d7a72', border: '1px solid ' + (mode === 'system' ? '#C8E6C9' : '#DCD8C6'), padding: '7px 10px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ค้นหาในระบบ</button>
          <button type="button" onClick={() => setMode('google')} style={{ flex: 1, background: mode === 'google' ? '#E8F5E9' : '#fff', color: mode === 'google' ? '#2E7D32' : '#6d7a72', border: '1px solid ' + (mode === 'google' ? '#C8E6C9' : '#DCD8C6'), padding: '7px 10px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ค้นหาใน Google Maps</button>
        </div>
      )}

      {mode === 'google' ? (
        <div>
          <div style={{ fontSize: 11, color: '#8a938c', marginBottom: 8 }}>ใช้เมื่อสถานที่จัดงานยังไม่มีในระบบ -- ค้นหาบน Google Maps แล้วเพิ่มเป็นสถานที่ใหม่ (จะยังไม่แสดงในหน้ารายการสถานที่สาธารณะจนกว่าแอดมินจะเปิดเผยแพร่จาก "จัดการสถานที่")</div>
          <LocationPicker
            value={googleLoc}
            onChange={setGoogleLoc}
            onSelectPlace={(p) => { setGoogleLoc({ lat: p.lat, lng: p.lng }); setGoogleName(p.name || ''); setGoogleAddress(p.address || '') }}
            height={180}
          />
          {googleLoc && (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid #F0EDE0', background: '#FBF8EE' }}>
              <input
                value={googleName}
                onChange={(e) => setGoogleName(e.target.value)}
                placeholder="ชื่อสถานที่"
                style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 8, fontSize: 13.5, marginBottom: 6 }}
              />
              <input
                value={googleAddress}
                onChange={(e) => setGoogleAddress(e.target.value)}
                placeholder="ที่อยู่"
                style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 8, fontSize: 13.5, marginBottom: 8 }}
              />
              {addError && <div style={{ color: '#a33232', fontSize: 12, marginBottom: 6 }}>เพิ่มสถานที่ไม่สำเร็จ: {addError}</div>}
              <button
                type="button"
                onClick={handleAddFromGoogle}
                disabled={adding || !googleName.trim()}
                style={{ width: '100%', background: adding || !googleName.trim() ? '#A5D6A7' : 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '9px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: adding || !googleName.trim() ? 'default' : 'pointer' }}
              >{adding ? 'กำลังเพิ่ม...' : 'เพิ่มเป็นสถานที่ใหม่และเลือก'}</button>
            </div>
          )}
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}
