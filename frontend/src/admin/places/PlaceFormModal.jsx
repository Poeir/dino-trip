import { Check, Info, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import Modal from '../../components/Modal.jsx'
import Field from '../../components/Field.jsx'
import ChipMultiSelect from '../../components/ChipMultiSelect.jsx'
import StarRatingInput from '../../components/StarRatingInput.jsx'
import AddressComposer from '../../components/AddressComposer.jsx'
import LocationPicker from '../../components/LocationPicker.jsx'
import HoursComposer from '../../components/HoursComposer.jsx'
import PlacePhotoGallery, { MAX_PHOTOS } from '../../components/PlacePhotoGallery.jsx'
import { AMENITY_OPTIONS, TAG_OPTIONS } from '../../data/placeVocabulary.js'
import { SUBCATEGORIES } from '../../data/seed.js'
import { createPlace, updatePlace, fetchPlace, fetchPlacePhotos, uploadPlacePhoto, deletePlacePhoto } from '../../lib/apiClient.js'
import { useDirtyGuard } from '../hooks/useDirtyGuard.js'
import { usePhotoQueue } from '../hooks/usePhotoQueue.js'
import FormSection, { FormActions, FormGrid, FormGroup } from '../ui/FormSection.jsx'
import PlaceSyncInfo from '../PlaceSyncInfo.jsx'
import PlaceAiDescription from './PlaceAiDescription.jsx'

// places.market_time -- keep in step with MARKET_TIMES in backend/src/lib/mappers.js.
const MARKET_TIME_OPTIONS = [
  { value: '', label: 'ไม่ระบุ (ให้ระบบเดาจากเวลาเปิดและชื่อ)' },
  { value: 'morning', label: 'ตลาดเช้า' },
  { value: 'evening', label: 'ตลาดเย็น / กลางคืน' },
  { value: 'all_day', label: 'ไม่มีช่วงเฉพาะ (ไปได้ตลอดเวลาที่เปิด)' },
]

function validate(f) {
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

// Add/edit form for a place. `onChanged` refetches the list behind the modal.
export default function PlaceFormModal({ onChanged }) {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const open = derived.isPlaceFormOpen
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const guard = useDirtyGuard({ open, value: f })
  const photos = usePhotoQueue({
    open,
    editingId: state.editingId,
    fetchPhotos: fetchPlacePhotos,
    uploadPhoto: uploadPlacePhoto,
    deletePhoto: deletePlacePhoto,
    onDeleted: onChanged,
    loadErrorLabel: 'โหลดรูปของสถานที่ไม่สำเร็จ: ',
    entityLabel: 'สถานที่',
  })

  // Sync/lock actions inside the edit form write straight to the DB, so the form has to pick up the
  // fresh values -- otherwise saving it would send the old ones back and re-lock what was just
  // synced/unlocked. The fresh values become the new "clean" baseline for the unsaved-changes guard.
  const reloadEditForm = async () => {
    const fresh = await fetchPlace(state.editingId)
    actions.openEditForm('place', fresh)
    guard.rebaseline()
    onChanged()
  }

  const handleClose = () => {
    if (saving) return
    guard.requestClose(() => { setErrors({}); actions.cancelForm() })
  }

  // Bypasses actions.saveForm() (which closes the modal the instant the JSON fields are saved) and
  // calls the API directly instead -- pending photos need the modal to stay open through the upload
  // too, or the gallery's loading state would never be visible.
  const handleSave = async () => {
    const e = validate(f)
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    try {
      let saved
      try {
        saved = state.editingId ? await updatePlace(state.editingId, f) : await createPlace(f)
      } catch (err) {
        actions.reportError('บันทึกสถานที่ไม่สำเร็จ: ', err)
        return
      }
      const hadPhotos = photos.pendingCount > 0
      const { failed } = await photos.uploadPending(saved)
      onChanged()
      if (!failed) actions.showToast(hadPhotos ? 'บันทึกสถานที่และรูปแล้ว' : 'บันทึกสถานที่แล้ว')
      actions.cancelForm()
    } finally {
      setSaving(false)
    }
  }

  // The "hasQR" checkbox below only controls a display badge -- the actual scannable QR (own row in
  // `qrs`, managed in the QR Code tab) is a separate thing entirely. Surfacing whether one really
  // exists here avoids an admin turning the badge on with no way for a visitor to claim it.
  const linkedQr = state.qrs.find((q) => q.placeId === state.editingId)
  const qrNote = !state.editingId
    ? { cls: '', icon: <Info size={14} aria-hidden="true" />, text: 'บันทึกสถานที่นี้ก่อน แล้วไปสร้าง QR Code จริงผูกกับที่นี่ได้ที่แท็บ "QR Code"' }
    : linkedQr
      ? { cls: ' is-ok', icon: <Check size={14} strokeWidth={3} aria-hidden="true" />, text: `มี QR Code จริงผูกกับสถานที่นี้แล้ว (${linkedQr.points} พอยท์)` }
      : { cls: ' is-error', icon: <TriangleAlert size={14} aria-hidden="true" />, text: 'ยังไม่มี QR Code จริงสำหรับสถานที่นี้ — ป้ายนี้จะโชว์แต่สแกนรับพอยท์ไม่ได้ จนกว่าจะสร้าง QR ที่แท็บ "QR Code"' }

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={state.editingId ? 'แก้ไขสถานที่' : 'เพิ่มสถานที่ใหม่'}
        size="lg"
        footer={<FormActions onSave={handleSave} onCancel={handleClose} saving={saving} saveLabel="บันทึกข้อมูล" />}
      >
        <FormSection title="ข้อมูลพื้นฐาน" first>
          <FormGrid>
            <Field label="ชื่อสถานที่" required error={errors.name}>
              <input className="ad-input" value={f.name || ''} onChange={actions.onField_name} placeholder="เช่น คาเฟ่ริมบึง" />
            </Field>
            <Field label="หมวดหมู่" required error={errors.category}>
              <select className="ad-select" value={f.category || ''} onChange={(e) => {
                actions.onField_category(e)
                // A subcategory only means something within its own category.
                if (!SUBCATEGORIES[e.target.value]?.includes(f.subcategory)) actions.updateFormField('subcategory', '')
              }}>
                <option value="">-- เลือกหมวดหมู่ --</option>
                {derived.placeCategoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </FormGrid>
          {SUBCATEGORIES[f.category] && (
            <Field label="ประเภทย่อย">
              <select className="ad-select" value={f.subcategory || ''} onChange={(e) => actions.updateFormField('subcategory', e.target.value)}>
                <option value="">-- ยังไม่ระบุ --</option>
                {SUBCATEGORIES[f.category].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          )}
          {f.category === 'ตลาด' && (
            <div>
              <Field label="ช่วงเวลาที่คนนิยมไปเดิน">
                <select className="ad-select" value={f.marketTime || ''} onChange={(e) => actions.updateFormField('marketTime', e.target.value)}>
                  {MARKET_TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <div className="ad-hint">ใช้จัดเวลาในทริป: ตลาดเช้าจะถูกจัดเป็นจุดแรกของวัน ตลาดเย็นตั้งแต่ราว 17:00 หลังมื้อเย็น ช่องนี้ไม่ใช่เวลาเปิด-ปิด ระบบยังจัดเฉพาะในเวลาทำการของสถานที่เสมอ</div>
            </div>
          )}
          <FormGroup legend="คะแนน">
            <StarRatingInput value={f.rating} onChange={(v) => actions.updateFormField('rating', v)} />
            {errors.rating
              ? <div className="ad-hint is-error">{errors.rating}</div>
              : <div className="ad-hint">กรอกด้วยทศนิยม 1 ตำแหน่ง (เช่น 4.5)</div>}
          </FormGroup>
          <Field label="ช่วงราคา">
            <input className="ad-input" value={f.price || ''} onChange={actions.onField_price} placeholder="เช่น 100-300 บาท" />
          </Field>
          <FormGroup legend="ที่อยู่และตำแหน่ง">
            <div className="ad-form-stack">
              <AddressComposer
                key={state.editingId ?? 'new'}
                address={f.address || ''}
                district={f.district || ''}
                subdistrict={f.subdistrict || ''}
                onCompose={(addr, area) => {
                  actions.updateFormField('address', addr)
                  for (const [k, v] of Object.entries(area)) actions.updateFormField(k, v)
                }}
              />
              <Field label="ที่อยู่เต็ม (ประกอบอัตโนมัติจากด้านบน)">
                <input className="ad-input" value={f.address || ''} readOnly aria-readonly="true" style={{ background: '#F5F4EE', color: '#5f6a63', cursor: 'not-allowed' }} />
              </Field>
              <Field label="ปักหมุดบนแผนที่ (สำหรับแสดงแผนที่ในหน้ารายละเอียด)">
                <LocationPicker
                  value={f.lat && f.lng ? { lat: parseFloat(f.lat), lng: parseFloat(f.lng) } : null}
                  onChange={(loc) => { actions.updateFormField('lat', loc.lat); actions.updateFormField('lng', loc.lng) }}
                />
              </Field>
            </div>
          </FormGroup>
        </FormSection>

        {state.editingId && f.googlePlaceId && (
          <FormSection title="การซิงก์กับ Google">
            <PlaceSyncInfo placeId={state.editingId} dirty={guard.isDirty()} onChanged={reloadEditForm} />
          </FormSection>
        )}

        <FormSection title="รูปภาพ">
          <div className="ad-hint">อัปโหลดได้สูงสุด <strong>{MAX_PHOTOS} รูปต่อสถานที่</strong> รูปแรกจะใช้เป็นรูปหลัก</div>
          <div>
            <PlacePhotoGallery {...photos.galleryProps} />
            {photos.photoError && <div className="ad-hint is-error">{photos.photoError}</div>}
          </div>
        </FormSection>

        <FormSection title="เวลาทำการและการติดต่อ">
          <FormGroup legend="เวลาทำการ">
            <HoursComposer value={f.hours} onCompose={(hours) => actions.updateFormField('hours', hours)} />
          </FormGroup>
          <Field label="ข้อความเวลาทำการ (ประกอบอัตโนมัติจากด้านบน แก้ไขเองได้)">
            <textarea className="ad-textarea" value={f.hours || ''} onChange={actions.onField_hours} />
          </Field>
          <Field label="เบอร์โทร">
            <input className="ad-input" value={f.phone || ''} onChange={actions.onField_phone} placeholder="เบอร์ติดต่อ" />
          </Field>
        </FormSection>

        <FormSection title="การมองเห็นบนหน้าเว็บ">
          <label className="ad-check"><input type="checkbox" checked={f.isActive !== false} onChange={actions.onField_isActive} /> เผยแพร่บนหน้าเว็บ</label>
          <div className="ad-hint">ปิดไว้เพื่อกันไม่ให้สถานที่นี้ไปโผล่ในหน้ารายการสาธารณะ (เช่น สถานที่ที่เพิ่มมาแค่เป็นหมุดของกิจกรรม) โดยไม่ต้องลบทิ้ง</div>
          <label className="ad-check"><input type="checkbox" checked={!!f.isFeatured} onChange={actions.onField_isFeatured} /> ปักหมุดเป็นสถานที่เด่น</label>
          <div className="ad-hint">สถานที่เด่นจะขึ้นก่อนในหน้ารายการสถานที่ (เรียงแบบ "แนะนำ") และมีป้าย "แนะนำ" — ใช้กับแลนด์มาร์กที่นักท่องเที่ยวควรเห็น</div>
          <Field label={'ป้าย "ยอดนิยม"'}>
            <select className="ad-select" value={f.popularBadge || 'auto'} onChange={(e) => actions.updateFormField('popularBadge', e.target.value)}>
              <option value="auto">อัตโนมัติ (แสดงเมื่อมีรีวิว 1,500 ขึ้นไป)</option>
              <option value="show">แสดงเสมอ</option>
              <option value="hide">ไม่แสดง</option>
            </select>
          </Field>
        </FormSection>

        <FormSection title="คำอธิบายและแท็ก">
          <Field label="คำอธิบาย">
            <textarea className="ad-textarea" value={f.desc || ''} onChange={actions.onField_desc} placeholder="รายละเอียดสถานที่" />
          </Field>
          <PlaceAiDescription
            canGenerate={!!f.name?.trim() && !!f.category}
            getInput={() => ({
              placeId: state.editingId || null,
              name: f.name,
              category: f.category,
              district: f.district || null,
              tags: f.tags || [],
              amenities: f.amenities || [],
            })}
            onApply={(text) => actions.updateFormField('desc', text)}
          />
          <FormGroup legend="สิ่งอำนวยความสะดวก">
            <ChipMultiSelect
              value={f.amenities}
              onChange={(v) => actions.updateFormField('amenities', v)}
              options={AMENITY_OPTIONS}
              addPlaceholder="เพิ่มสิ่งอำนวยความสะดวกอื่น..."
            />
          </FormGroup>
          <FormGroup legend="แท็กความสนใจ">
            <ChipMultiSelect
              value={f.tags}
              onChange={(v) => actions.updateFormField('tags', v)}
              options={TAG_OPTIONS}
              addPlaceholder="เพิ่มแท็กอื่น..."
            />
          </FormGroup>
        </FormSection>

        <FormSection title="QR และพอยท์">
          <div className="ad-points-box">
            <label className="ad-points-box__toggle">
              <input type="checkbox" checked={!!f.hasQR} onChange={actions.onField_hasQR} />
              แสดงป้าย "รับพอยท์" บนหน้าเว็บสำหรับสถานที่นี้
            </label>
            {f.hasQR && (
              <>
                <Field label="จำนวนพอยท์ที่แสดงบนป้าย">
                  <input className="ad-input ad-input--sm" type="number" min={0} step={1} value={f.qrPoints || ''} onChange={actions.onField_qrPoints} placeholder="เช่น 10" />
                </Field>
                <div className={`ad-hint ad-hint--icon${qrNote.cls}`}>
                  <span className="ad-hint__icon">{qrNote.icon}</span>
                  <span>{qrNote.text}</span>
                </div>
              </>
            )}
          </div>
        </FormSection>
      </Modal>
      {guard.dirtyDialog}
    </>
  )
}
