import { useEffect, useState } from 'react'
import Modal from '../components/Modal.jsx'
import Button from './ui/Button.jsx'
import Badge from './ui/Badge.jsx'
import { searchGooglePlaces, importGooglePlace } from '../lib/apiClient.js'

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
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="เพิ่มสถานที่จาก Google Maps"
      maxWidth={640}
      footer={<Button variant="secondary" onClick={onClose} disabled={busy}>ปิด</Button>}
    >
      <form onSubmit={search} className="ad-import-form">
        <input className="ad-input" aria-label="ชื่อสถานที่ที่จะค้นหา" value={query} onChange={(e) => setQuery(e.target.value)} disabled={busy} autoFocus placeholder="พิมพ์ชื่อสถานที่ เช่น คาเฟ่ xxx ขอนแก่น" />
        <Button type="submit" loading={searching} disabled={busy || query.trim().length < 2}>{searching ? 'กำลังค้นหา...' : 'ค้นหา'}</Button>
      </form>
      <p className="ad-hint ad-hint--block">ผลลัพธ์จาก Google Maps — เมื่อเลือกแล้วระบบจะดึงข้อมูลและรูป (สูงสุด 5 รูป) มาสร้างเป็นฉบับร่างที่ซ่อนอยู่ ให้ตรวจแก้ก่อนเผยแพร่</p>
      {error && <div className="ad-error-text ad-mb" role="alert">{error}</div>}
      {results && results.length === 0 && <div className="ad-state">ไม่พบสถานที่ใน Google Maps ลองเปลี่ยนคำค้น หรือปิดหน้านี้แล้วกรอกเองด้วย "+ เพิ่มสถานที่ใหม่"</div>}
      <div className="ad-pick-list">
        {(results || []).map((r) => (
          <div key={r.googlePlaceId} className="ad-import-result">
            <div className="ad-pick__body">
              <div className="ad-import-result__name">{r.name}</div>
              <div className="ad-card__meta">{r.address}</div>
              {['CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY'].includes(r.businessStatus) && <div className="ad-card__meta ad-text-danger">{r.businessStatus === 'CLOSED_PERMANENTLY' ? 'ปิดถาวร' : 'ปิดชั่วคราว'}</div>}
            </div>
            {r.existingPlaceId
              ? <Badge>มีในระบบแล้ว</Badge>
              : <Button variant="soft" size="sm" disabled={busy} loading={importingId === r.googlePlaceId} onClick={() => pick(r)}>{importingId === r.googlePlaceId ? 'กำลังนำเข้า...' : 'เลือก'}</Button>}
          </div>
        ))}
      </div>
    </Modal>
  )
}
