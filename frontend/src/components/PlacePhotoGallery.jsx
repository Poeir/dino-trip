import { useRef } from 'react'
import ImageSlot from './ImageSlot.jsx'

export const MAX_PHOTOS = 5

const thumbBoxStyle = { width: 90, height: 90 }
const removeBtnStyle = {
  position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%',
  background: '#a33232', color: '#fff', border: '2px solid #fff', fontSize: 13, lineHeight: '18px',
  cursor: 'pointer', padding: 0,
}
const addSlotStyle = {
  ...thumbBoxStyle, border: '2px dashed #DCD8C6', borderRadius: 12, background: 'none',
  color: '#6d7a72', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}

// Existing (already uploaded, has an id + url) and pending (picked locally,
// not uploaded yet -- only relevant while creating a brand-new place, which
// has no id to upload against until the rest of the form is saved first)
// photos share one row of up to MAX_PHOTOS slots.
export default function PlacePhotoGallery({ existingPhotos, pendingFiles, onAddFiles, onRemoveExisting, onRemovePending, removingId, busy, busyText }) {
  const fileInputRef = useRef(null)
  const total = existingPhotos.length + pendingFiles.length
  const remainingSlots = MAX_PHOTOS - total

  const handleFilesSelected = (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // lets picking the same file again re-trigger onChange
    if (files.length) onAddFiles(files.slice(0, remainingSlots))
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6, opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
        {existingPhotos.map((p) => (
          <div key={p.id} style={{ position: 'relative' }}>
            <ImageSlot src={p.url} loading={removingId === p.id} shape="rect" style={thumbBoxStyle} placeholder="รูป" />
            <button type="button" onClick={() => onRemoveExisting(p.id)} disabled={removingId === p.id} aria-label="ลบรูปนี้" style={removeBtnStyle}>×</button>
          </div>
        ))}
        {pendingFiles.map((pf, i) => (
          <div key={pf.previewUrl} style={{ position: 'relative' }}>
            <ImageSlot src={pf.previewUrl} shape="rect" style={thumbBoxStyle} placeholder="รูป" />
            <button type="button" onClick={() => onRemovePending(i)} aria-label="เอาออก" style={removeBtnStyle}>×</button>
          </div>
        ))}
        {remainingSlots > 0 && (
          <button type="button" onClick={() => fileInputRef.current?.click()} style={addSlotStyle}>+ เพิ่มรูป</button>
        )}
      </div>
      <input
        ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
        onChange={handleFilesSelected} style={{ display: 'none' }}
      />
      <div style={{ fontSize: 11.5, color: busy ? '#2E7D32' : '#8a938c' }}>
        {busy ? busyText : `${total}/${MAX_PHOTOS} รูป — JPG, PNG, WEBP, GIF ไม่เกิน 2MB ต่อไฟล์`}
      </div>
    </div>
  )
}
