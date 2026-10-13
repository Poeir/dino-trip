import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from './Modal.jsx'

// "แจ้งข้อมูลไม่ถูกต้อง": the tourist only says WHICH fields look wrong (one or
// several, plus an optional note) -- an admin decides what to do, so nothing
// here can change the record itself. Shared by places and events; each passes
// its own field vocabulary and API calls.
//   fieldLabels - { fieldKey: label } in display order
//   fetchMine   - () => Promise<{ pendingFields }>: fields already reported
//   submit      - (fields, note) => Promise
export default function ReportModal({ open, onClose, name, fieldLabels, fetchMine, submit }) {
  const { actions } = useApp()
  const [fields, setFields] = useState([])
  const [note, setNote] = useState('')
  const [pending, setPending] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setFields([]); setNote(''); setError('')
    fetchMine().then((r) => setPending(r.pendingFields)).catch(() => setPending([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = (f) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))
  const noteRequired = fields.includes('other')

  const send = async () => {
    if (!fields.length) { setError('กรุณาเลือกข้อมูลที่ไม่ถูกต้องอย่างน้อย 1 ข้อ'); return }
    if (noteRequired && !note.trim()) { setError('กรุณาอธิบายปัญหาที่พบในช่อง “รายละเอียดเพิ่มเติม”'); return }
    setBusy(true)
    setError('')
    try {
      await submit(fields, note.trim())
      actions.showToast('ส่งรายงานแล้ว ขอบคุณที่ช่วยกันปรับปรุงข้อมูล')
      onClose()
    } catch (err) {
      if (actions.handleSessionExpired(err)) return
      setError(err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="แจ้งข้อมูลไม่ถูกต้อง" maxWidth={480}>
      <div style={{ fontSize: 13.5, color: '#3c463f', lineHeight: 1.6, marginBottom: 14 }}>
        ข้อมูลของ “{name}” ส่วนไหนที่ไม่ตรงกับความจริง? เลือกได้มากกว่า 1 ข้อ ทีมงานจะตรวจสอบและอัปเดตให้
      </div>
      <div role="group" aria-label="ข้อมูลที่ไม่ถูกต้อง" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {Object.entries(fieldLabels).map(([f, label]) => {
          const already = pending.includes(f)
          return (
            <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: already ? '#a3ab9e' : '#1f2a24', cursor: already ? 'default' : 'pointer' }}>
              <input type="checkbox" value={f} checked={fields.includes(f)} disabled={already} onChange={() => toggle(f)} />
              {label}{already ? ' (คุณแจ้งไปแล้ว รอตรวจสอบ)' : ''}
            </label>
          )
        })}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>รายละเอียดเพิ่มเติม{noteRequired ? '' : ' (ไม่บังคับ)'}</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="เช่น เปลี่ยนเป็นวันที่ 12–14 ธันวาคม"
        style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, resize: 'vertical', marginBottom: 12 }} />
      {error && <div style={{ fontSize: 13, color: '#a33232', marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={send} disabled={busy} style={{ background: busy ? '#A5D6A7' : 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: busy ? 'default' : 'pointer' }}>{busy ? 'กำลังส่ง...' : `ส่งรายงาน${fields.length > 1 ? ` (${fields.length} ข้อ)` : ''}`}</button>
        <button onClick={onClose} disabled={busy} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
      </div>
    </Modal>
  )
}
