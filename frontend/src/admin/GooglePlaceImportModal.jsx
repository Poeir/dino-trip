import { useEffect, useState } from 'react'
import Modal from '../components/Modal.jsx'
import { searchGooglePlaces, importGooglePlace } from '../lib/apiClient.js'

const inputStyle = { border: '1px solid #DCD8C6', borderRadius: 8, padding: '9px 12px', fontSize: 14 }
const btn = (bg, color, border = 'none') => ({ background: bg, color, border, padding: '8px 16px', borderRadius: 14, fontSize: 13, fontWeight: 700, cursor: 'pointer' })

// Admin picks a place found on Google Maps; the server creates it (with photos)
// as a hidden draft and `onImported(place)` opens it in the edit form for review.
// Search only runs on submit -- every request is billable.
export default function GooglePlaceImportModal({ open, onClose, onImported }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [importingId, setImportingId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setQuery(''); setResults(null); setError(''); setImportingId(null) }
  }, [open])

  const search = async (e) => {
    e.preventDefault()
    if (query.trim().length < 2) return
    setSearching(true); setError('')
    try {
      setResults(await searchGooglePlaces(query.trim()))
    } catch (err) {
      setResults(null); setError(err.message || 'ค้นหาไม่สำเร็จ')
    } finally {
      setSearching(false)
    }
  }

  const pick = async (r) => {
    setImportingId(r.googlePlaceId); setError('')
    try {
      const { place, created } = await importGooglePlace(r.googlePlaceId)
      onImported(place, created)
    } catch (err) {
      setError(err.message || 'นำเข้าไม่สำเร็จ')
      setImportingId(null)
    }
  }

  const busy = importingId != null
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="เพิ่มสถานที่จาก Google Maps" maxWidth={640}>
      <form onSubmit={search} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} disabled={busy} autoFocus placeholder="พิมพ์ชื่อสถานที่ เช่น คาเฟ่ xxx ขอนแก่น" style={{ ...inputStyle, flex: 1 }} />
        <button type="submit" disabled={searching || busy || query.trim().length < 2} style={btn('linear-gradient(135deg,#66BB6A,#388E3C)', '#fff')}>{searching ? 'กำลังค้นหา...' : 'ค้นหา'}</button>
      </form>
      <div style={{ fontSize: 11.5, color: '#8a938c', marginBottom: 14 }}>ผลลัพธ์จาก Google Maps — เมื่อเลือกแล้วระบบจะดึงข้อมูลและรูป (สูงสุด 5 รูป) มาสร้างเป็นฉบับร่างที่ซ่อนอยู่ ให้ตรวจแก้ก่อนเผยแพร่</div>
      {error && <div style={{ color: '#a33232', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {results && results.length === 0 && <div style={{ color: '#8a938c', fontSize: 13.5, padding: '12px 0' }}>ไม่พบสถานที่ใน Google Maps ลองเปลี่ยนคำค้น หรือปิดหน้านี้แล้วกรอกเองด้วย "+ เพิ่มสถานที่ใหม่"</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(results || []).map((r) => (
          <div key={r.googlePlaceId} style={{ border: '1px solid #E7E3D2', borderRadius: 12, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: '#6d7a72' }}>{r.address}</div>
              {['CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY'].includes(r.businessStatus) && <div style={{ fontSize: 11.5, color: '#a33232' }}>{r.businessStatus === 'CLOSED_PERMANENTLY' ? 'ปิดถาวร' : 'ปิดชั่วคราว'}</div>}
            </div>
            {r.existingPlaceId
              ? <span style={{ fontSize: 12, fontWeight: 700, color: '#6d7a72', background: '#f3f3f0', padding: '4px 10px', borderRadius: 10 }}>มีในระบบแล้ว</span>
              : <button type="button" disabled={busy} onClick={() => pick(r)} style={btn(importingId === r.googlePlaceId ? '#A5D6A7' : '#E8F5E9', '#2E7D32')}>{importingId === r.googlePlaceId ? 'กำลังนำเข้า...' : 'เลือก'}</button>}
          </div>
        ))}
      </div>
    </Modal>
  )
}
