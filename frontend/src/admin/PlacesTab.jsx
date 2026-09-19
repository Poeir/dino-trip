import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import PlaceCard from '../components/PlaceCard.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import SectionHeading from '../components/SectionHeading.jsx'
import ChipMultiSelect from '../components/ChipMultiSelect.jsx'
import StarRatingInput from '../components/StarRatingInput.jsx'
import AddressComposer from '../components/AddressComposer.jsx'
import LocationPicker from '../components/LocationPicker.jsx'
import HoursComposer from '../components/HoursComposer.jsx'
import PlacePhotoGallery, { MAX_PHOTOS } from '../components/PlacePhotoGallery.jsx'
import { AMENITY_OPTIONS, TAG_OPTIONS } from '../data/placeVocabulary.js'
import { createPlace, updatePlace, fetchPlacePhotos, uploadPlacePhoto, deletePlacePhoto } from '../lib/apiClient.js'

const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const inputStyle = { width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }

export default function PlacesTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('name-asc')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  // Existing = already-uploaded photos (has an id, fetched when opening an
  // existing place for edit). Pending = picked locally but not uploaded yet
  // -- unavoidable for a brand-new place, which has no id to upload against
  // until the rest of the form is saved first (see handleSave).
  const [existingPhotos, setExistingPhotos] = useState([])
  const [pendingFiles, setPendingFiles] = useState([])
  const [photoError, setPhotoError] = useState('')
  const [removingPhotoId, setRemovingPhotoId] = useState(null)
  const [galleryBusy, setGalleryBusy] = useState(false)
  const [galleryBusyText, setGalleryBusyText] = useState('')
  const initialFormRef = useRef(null)

  // Snapshots formData the moment the modal opens, so closing it (backdrop
  // click, Esc, or the ยกเลิก button) can warn instead of silently dropping
  // whatever the admin already typed. Also loads the current gallery when
  // editing (rowToPlace's `images` is already the resolved gallery, but this
  // needs each photo's *id* too, to delete one -- not just its URL).
  useEffect(() => {
    if (!derived.isPlaceFormOpen) return
    initialFormRef.current = JSON.stringify(f)
    pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.previewUrl))
    setPendingFiles([])
    setPhotoError('')
    setExistingPhotos([])
    if (state.editingId) {
      fetchPlacePhotos(state.editingId).then(setExistingPhotos).catch(() => setExistingPhotos([]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.isPlaceFormOpen])

  const isDirty = () => initialFormRef.current !== null && JSON.stringify(f) !== initialFormRef.current

  const handleClose = () => {
    if (isDirty() && !window.confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการปิดฟอร์มนี้หรือไม่?')) return
    setErrors({})
    actions.cancelForm()
  }

  const validate = () => {
    const e = {}
    if (!f.name?.trim()) e.name = 'กรุณากรอกชื่อสถานที่'
    if (!f.category) e.category = 'กรุณาเลือกหมวดหมู่'
    if (f.rating !== '' && f.rating != null) {
      const r = parseFloat(f.rating)
      if (isNaN(r) || r < 0 || r > 5) e.rating = 'คะแนนต้องเป็นตัวเลข 0-5'
      else if (Math.round(r * 10) !== r * 10) e.rating = 'คะแนนเก็บได้ทศนิยม 1 ตำแหน่งเท่านั้น เช่น 4.5'
    }
    return e
  }

  const validatePhotoFile = (file) => {
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) return 'รองรับเฉพาะไฟล์ JPG, PNG, WEBP, GIF'
    if (file.size > MAX_PHOTO_BYTES) return `ไฟล์ใหญ่เกินไป (จำกัด ${MAX_PHOTO_BYTES / 1024 / 1024}MB)`
    return null
  }

  const handleAddFiles = (files) => {
    const accepted = []
    let firstError = null
    for (const file of files) {
      const err = validatePhotoFile(file)
      if (err && !firstError) firstError = err
      else if (!err) accepted.push({ file, previewUrl: URL.createObjectURL(file) })
    }
    setPhotoError(firstError || '')
    if (accepted.length) setPendingFiles((prev) => [...prev, ...accepted])
  }

  const handleRemovePending = (index) => {
    setPendingFiles((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleRemoveExisting = async (photoId) => {
    setRemovingPhotoId(photoId)
    try {
      const updated = await deletePlacePhoto(state.editingId, photoId)
      actions.applyPlaceUpdate(updated)
      setExistingPhotos((prev) => prev.filter((p) => p.id !== photoId))
      actions.showToast('ลบรูปแล้ว')
    } catch (err) {
      actions.showToast('ลบรูปไม่สำเร็จ: ' + err.message)
    } finally {
      setRemovingPhotoId(null)
    }
  }

  // Bypasses actions.saveForm() (which closes the modal the instant the JSON
  // fields are saved) and calls the API directly instead -- pending photos
  // need the modal to stay open through the upload too, or the gallery's
  // loading state would never be visible: it'd start after the modal
  // showing it had already closed.
  const handleSave = async () => {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    try {
      let saved
      try {
        saved = state.editingId ? await updatePlace(state.editingId, f) : await createPlace(f)
      } catch (err) {
        actions.showToast('บันทึกสถานที่ไม่สำเร็จ: ' + err.message)
        return
      }
      if (pendingFiles.length) {
        setGalleryBusy(true)
        let uploadedCount = 0
        try {
          // Sequential, not Promise.all: the backend assigns each photo's
          // `position` from the current count in the DB, so parallel
          // uploads could race and land on the same position.
          for (const pf of pendingFiles) {
            setGalleryBusyText(`กำลังอัปโหลดรูป ${uploadedCount + 1}/${pendingFiles.length}...`)
            saved = await uploadPlacePhoto(saved.id, pf.file)
            uploadedCount++
          }
        } catch (err) {
          actions.showToast(`บันทึกสถานที่แล้ว แต่อัปโหลดรูปสำเร็จแค่ ${uploadedCount}/${pendingFiles.length}: ${err.message}`)
        } finally {
          setGalleryBusy(false)
          setGalleryBusyText('')
        }
      }
      actions.applyPlaceUpdate(saved)
      actions.showToast(pendingFiles.length ? 'บันทึกสถานที่และรูปแล้ว' : 'บันทึกสถานที่แล้ว')
      actions.cancelForm()
    } finally {
      setSaving(false)
    }
  }

  // The "hasQR" checkbox below only controls a display badge -- the actual
  // scannable QR (own row in `qrs`, generated/printed from QrTab.jsx) is a
  // separate thing entirely. Surfacing whether one really exists here avoids
  // an admin turning the badge on with no way for a visitor to claim it.
  const linkedQr = state.qrs.find((q) => q.placeId === state.editingId)

  const sorters = {
    'name-asc': (a, b) => a.name.localeCompare(b.name, 'th'),
    'name-desc': (a, b) => b.name.localeCompare(a.name, 'th'),
    'rating-desc': (a, b) => (b.rating || 0) - (a.rating || 0),
    'rating-asc': (a, b) => (a.rating || 0) - (b.rating || 0),
  }
  const filteredPlacesView = derived.placesView
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(sorters[sortBy])
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>จัดการสถานที่</h1>
        <button onClick={actions.onNewPlace} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ เพิ่มสถานที่ใหม่</button>
      </div>

      <Modal open={derived.isPlaceFormOpen} onClose={handleClose} title={state.editingId ? 'แก้ไขสถานที่' : 'เพิ่มสถานที่ใหม่'} maxWidth={760}>
          <SectionHeading first>ข้อมูลพื้นฐาน</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 14 }}>
            <Field label="ชื่อสถานที่" required error={errors.name}>
              <input value={f.name || ''} onChange={actions.onField_name} placeholder="เช่น คาเฟ่ริมบึง" style={inputStyle} />
            </Field>
            <Field label="หมวดหมู่" required error={errors.category}>
              <select value={f.category || ''} onChange={actions.onField_category} style={inputStyle}>
                <option value="">-- เลือกหมวดหมู่ --</option>
                {derived.placeCategoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: '#3c463f', marginBottom: 4, padding: 0 }}>คะแนน</legend>
            <StarRatingInput value={f.rating} onChange={(v) => actions.updateFormField('rating', v)} />
            {errors.rating
              ? <div style={{ color: '#a33232', fontSize: 11.5, marginTop: 4 }}>{errors.rating}</div>
              : <div style={{ color: '#8a938c', fontSize: 11.5, marginTop: 4 }}>กรอกด้วยทศนิยม 1 ตำแหน่ง (เช่น 4.5)</div>}
          </fieldset>
          <Field label="ช่วงราคา">
            <input value={f.price || ''} onChange={actions.onField_price} placeholder="เช่น 100-300 บาท" style={{ ...inputStyle, marginBottom: 14 }} />
          </Field>
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: '#3c463f', marginBottom: 4, padding: 0 }}>ที่อยู่และตำแหน่ง</legend>
            <AddressComposer onCompose={(addr) => actions.updateFormField('address', addr)} />
            <Field label="ที่อยู่เต็ม (ประกอบอัตโนมัติจากด้านบน แก้ไขเองได้)">
              <input value={f.address || ''} onChange={actions.onField_address} style={{ ...inputStyle, marginBottom: 10 }} />
            </Field>
            <Field label="ปักหมุดบนแผนที่ (สำหรับแสดงแผนที่ในหน้ารายละเอียด)">
              <LocationPicker
                value={f.lat && f.lng ? { lat: parseFloat(f.lat), lng: parseFloat(f.lng) } : null}
                onChange={(loc) => { actions.updateFormField('lat', loc.lat); actions.updateFormField('lng', loc.lng) }}
                onSelectPlace={(p) => { if (!f.address) actions.updateFormField('address', p.address) }}
              />
            </Field>
          </fieldset>

          <SectionHeading>รูปภาพ</SectionHeading>
          <div style={{ fontSize: 11.5, color: '#6d7a72', marginBottom: 8 }}>อัปโหลดได้สูงสุด <strong>{MAX_PHOTOS} รูปต่อสถานที่</strong> รูปแรกจะใช้เป็นรูปหลัก</div>
          <div style={{ marginBottom: 14 }}>
            <PlacePhotoGallery
              existingPhotos={existingPhotos}
              pendingFiles={pendingFiles}
              onAddFiles={handleAddFiles}
              onRemoveExisting={handleRemoveExisting}
              onRemovePending={handleRemovePending}
              removingId={removingPhotoId}
              busy={galleryBusy}
              busyText={galleryBusyText}
            />
            {photoError && <div style={{ color: '#a33232', fontSize: 11.5, marginTop: 4 }}>{photoError}</div>}
          </div>

          <SectionHeading>เวลาทำการและการติดต่อ</SectionHeading>
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: '#3c463f', marginBottom: 6, padding: 0 }}>เวลาทำการ</legend>
            <HoursComposer onCompose={(hours) => actions.updateFormField('hours', hours)} />
          </fieldset>
          <Field label="ข้อความเวลาทำการ (ประกอบอัตโนมัติจากด้านบน แก้ไขเองได้)">
            <textarea value={f.hours || ''} onChange={actions.onField_hours} style={{ ...inputStyle, minHeight: 44, fontFamily: 'inherit', marginBottom: 14 }} />
          </Field>
          <Field label="เบอร์โทร">
            <input value={f.phone || ''} onChange={actions.onField_phone} placeholder="เบอร์ติดต่อ" style={{ ...inputStyle, marginBottom: 14 }} />
          </Field>

          <SectionHeading>การมองเห็นบนหน้าเว็บ</SectionHeading>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, marginBottom: 4 }}>
            <input type="checkbox" checked={f.isActive !== false} onChange={actions.onField_isActive} /> เผยแพร่บนหน้าเว็บ
          </label>
          <div style={{ fontSize: 11.5, color: '#8a938c', marginBottom: 14 }}>ปิดไว้เพื่อกันไม่ให้สถานที่นี้ไปโผล่ในหน้ารายการสาธารณะ (เช่น สถานที่ที่เพิ่มมาแค่เป็นหมุดของ Event) โดยไม่ต้องลบทิ้ง</div>

          <SectionHeading>คำอธิบายและแท็ก</SectionHeading>
          <Field label="คำอธิบาย">
            <textarea value={f.desc || ''} onChange={actions.onField_desc} placeholder="รายละเอียดสถานที่" style={{ ...inputStyle, minHeight: 60, marginBottom: 14 }}></textarea>
          </Field>
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: '#3c463f', marginBottom: 4, padding: 0 }}>สิ่งอำนวยความสะดวก</legend>
            <ChipMultiSelect
              value={f.amenities}
              onChange={(v) => actions.updateFormField('amenities', v)}
              options={AMENITY_OPTIONS}
              addPlaceholder="เพิ่มสิ่งอำนวยความสะดวกอื่น..."
            />
          </fieldset>
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: '#3c463f', marginBottom: 4, padding: 0 }}>แท็กความสนใจ</legend>
            <ChipMultiSelect
              value={f.tags}
              onChange={(v) => actions.updateFormField('tags', v)}
              options={TAG_OPTIONS}
              addPlaceholder="เพิ่มแท็กอื่น..."
            />
          </fieldset>

          <SectionHeading>QR & พอยท์</SectionHeading>
          <div style={{ border: '1px solid #F0E4B8', background: '#FFFDF5', borderRadius: 12, padding: 14, marginBottom: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 700, color: '#7A5205', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!f.hasQR} onChange={actions.onField_hasQR} />
              แสดงป้าย "รับพอยท์" บนหน้าเว็บสำหรับสถานที่นี้
            </label>
            {f.hasQR && (
              <>
                <div style={{ marginTop: 12, marginBottom: 10 }}>
                  <Field label="จำนวนพอยท์ที่แสดงบนป้าย">
                    <input type="number" min={0} step={1} value={f.qrPoints || ''} onChange={actions.onField_qrPoints} placeholder="เช่น 10" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 7, fontSize: 13.5, width: 130 }} />
                  </Field>
                </div>
                <div style={{ fontSize: 11.5, color: !state.editingId ? '#8a938c' : linkedQr ? '#2E7D32' : '#a33232', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <span>{!state.editingId ? 'ℹ' : linkedQr ? '✓' : '⚠'}</span>
                  <span>
                    {!state.editingId
                      ? 'บันทึกสถานที่นี้ก่อน แล้วไปสร้าง QR Code จริงผูกกับที่นี่ได้ที่แท็บ "QR & พอยท์"'
                      : linkedQr
                        ? `มี QR Code จริงผูกกับสถานที่นี้แล้ว (${linkedQr.points} พอยท์)`
                        : 'ยังไม่มี QR Code จริงสำหรับสถานที่นี้ — ป้ายนี้จะโชว์แต่สแกนรับพอยท์ไม่ได้ จนกว่าจะสร้าง QR ที่แท็บ "QR & พอยท์"'}
                  </span>
                </div>
              </>
            )}
          </div>

          <div style={{ position: 'sticky', bottom: -24, marginLeft: -24, marginRight: -24, marginTop: 20, background: '#fff', borderTop: '1px solid #E7E3D2', padding: '14px 24px', display: 'flex', gap: 10 }}>
            <button onClick={handleSave} disabled={saving} style={{ background: saving ? '#A5D6A7' : 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}</button>
            <button onClick={handleClose} disabled={saving} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: saving ? 'default' : 'pointer' }}>ยกเลิก</button>
          </div>
      </Modal>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาสถานที่..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
          <option value="name-asc">ชื่อ (ก-ฮ)</option>
          <option value="name-desc">ชื่อ (ฮ-ก)</option>
          <option value="rating-desc">คะแนนสูง-ต่ำ</option>
          <option value="rating-asc">คะแนนต่ำ-สูง</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
        {filteredPlacesView.map((p) => (
          <PlaceCard key={p.id} place={p} dim={!p.isActive} badge={!p.isActive ? 'ซ่อนอยู่' : null}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={p.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
              <button onClick={p.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
            </div>
            <button onClick={p.onToggleActive} style={{ width: '100%', background: p.isActive ? '#fff' : '#FFF8E1', color: p.isActive ? '#6d7a72' : '#7A5205', border: '1px solid #DCD8C6', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              {p.isActive ? 'ซ่อนจากหน้าเว็บ' : 'เผยแพร่อีกครั้ง'}
            </button>
          </PlaceCard>
        ))}
      </div>
    </>
  )
}
