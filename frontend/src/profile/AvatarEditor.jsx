import { useEffect, useRef, useState } from 'react'
import Modal from '../components/Modal.jsx'
import Avatar from '../components/Avatar.jsx'
import { useApp } from '../context/AppContext.jsx'
import { updateProfileAvatar, removeProfileAvatar } from '../lib/apiClient.js'
import { Notice, primaryBtn, ghostBtn } from './ui.jsx'

const MAX_BYTES = 2 * 1024 * 1024
const CROP = 280

// Change the profile picture: a built-in persona, or an uploaded photo the
// user drags/zooms inside the circle. Nothing is sent until "บันทึก".
export default function AvatarEditor({ open, onClose, profile, onSaved }) {
  const { derived } = useApp()
  const [preset, setPreset] = useState(null)
  const [file, setFile] = useState(null)
  const [objectUrl, setObjectUrl] = useState('')
  const [pos, setPos] = useState({ x: 50, y: 50 })
  const [scale, setScale] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dragRef = useRef(null)

  // Fresh state each time the dialog opens; free the blob URL on close.
  useEffect(() => {
    if (!open) return
    setPreset(null); setFile(null); setPos({ x: 50, y: 50 }); setScale(1); setError(''); setBusy(false)
  }, [open])
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }, [objectUrl])

  const onFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) { setError('ไฟล์ต้องเป็นรูปภาพเท่านั้น'); return }
    if (f.size > MAX_BYTES) { setError('ไฟล์ต้องมีขนาดไม่เกิน 2MB'); return }
    setError(''); setPreset(null); setFile(f); setPos({ x: 50, y: 50 }); setScale(1)
    setObjectUrl(URL.createObjectURL(f))
  }

  const onPointerDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y, w: rect.width, h: rect.height }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const clamp = (n) => Math.max(0, Math.min(100, n))
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    setPos({ x: clamp(d.px - ((e.clientX - d.sx) / d.w) * 100), y: clamp(d.py - ((e.clientY - d.sy) / d.h) * 100) })
  }
  const onPointerUp = () => { dragRef.current = null }

  const canSave = !!(file || preset)
  const run = async (fn) => {
    setBusy(true); setError('')
    try { onSaved(await fn()); onClose() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const save = () => run(() => updateProfileAvatar(file
    ? { file, position: `${Math.round(pos.x)}% ${Math.round(pos.y)}%`, scale }
    : { preset }))
  const remove = () => run(() => removeProfileAvatar())

  const hasCurrent = !!profile.avatarUrl

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="เปลี่ยนรูปโปรไฟล์" maxWidth={400}>
      {file ? (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6d7a72', textAlign: 'center' }}>ลากรูปเพื่อเลือกส่วนที่จะแสดงในวงกลมโปรไฟล์</p>
          <div
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            style={{ position: 'relative', width: CROP, height: CROP, maxWidth: '100%', margin: '0 auto', borderRadius: 12, overflow: 'hidden', background: '#111', cursor: 'grab', touchAction: 'none' }}
          >
            <img src={objectUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${pos.x}% ${pos.y}%`, transform: `scale(${scale})`, transformOrigin: 'center', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', inset: '10.7%', borderRadius: '50%', boxShadow: '0 0 0 9999px rgba(15,25,18,0.6)', border: '2px solid #fff', pointerEvents: 'none' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 12, color: '#6d7a72' }}>
            ซูม
            <input type="range" min="1" max="3" step="0.05" value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ flex: 1 }} />
          </label>
        </>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <Avatar user={preset ? { ...profile, avatarUrl: `preset:${preset}` } : profile} size={120} />
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', margin: '18px 0 6px' }}>
        {derived.personaAvatarOptions.map((a) => (
          <button key={a.key} type="button" className="dc-avatar-swatch" onClick={() => { setPreset(a.key); setFile(null) }} title={a.key} aria-pressed={preset === a.key}
            style={{ width: 44, height: 44, borderRadius: '50%', background: a.bg, fontSize: 24, cursor: 'pointer', border: preset === a.key ? '2px solid #2E7D32' : '1px solid #E7E3D2', padding: 0 }}>
            {a.emoji}
          </button>
        ))}
        <label title="อัปโหลดรูปของคุณ" className="dc-avatar-swatch" style={{ width: 44, height: 44, borderRadius: '50%', border: file ? '2px solid #2E7D32' : '1px dashed #8a938c', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 20, color: '#6d7a72' }}>
          +
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onFile} style={{ display: 'none' }} />
        </label>
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#8a938c', textAlign: 'center' }}>อัปโหลดรูปได้ไม่เกิน 2MB (jpg, png, webp, gif)</p>

      <Notice>{error}</Notice>
      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        {hasCurrent && (
          <button type="button" onClick={remove} disabled={busy} style={{ ...ghostBtn, color: '#a33232', borderColor: '#e6b8b8' }}>ลบรูป</button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClose} disabled={busy} style={ghostBtn}>ยกเลิก</button>
        <button type="button" onClick={save} disabled={!canSave || busy} style={primaryBtn(!canSave || busy)}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </div>
    </Modal>
  )
}
