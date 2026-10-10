import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import Modal from '../../components/Modal.jsx'
import Field from '../../components/Field.jsx'
import ChipMultiSelect from '../../components/ChipMultiSelect.jsx'
import PlacePhotoGallery, { MAX_PHOTOS } from '../../components/PlacePhotoGallery.jsx'
import PlacePicker from '../../components/PlacePicker.jsx'
import EventDateComposer from '../../components/EventDateComposer.jsx'
import { createEvent, updateEvent, fetchEventPhotos, uploadEventPhoto, deleteEventPhoto, createPlace, fetchPlaceNames } from '../../lib/apiClient.js'
import { EVENT_CATEGORY_OPTIONS, SUITABLE_FOR_OPTIONS, formatDateRange, inferDateMode } from '../../data/eventForm.js'
import { useDirtyGuard } from '../hooks/useDirtyGuard.js'
import { usePhotoQueue } from '../hooks/usePhotoQueue.js'
import FormSection, { FormActions, FormGrid, FormGroup } from '../ui/FormSection.jsx'
import EventAiExtract from './EventAiExtract.jsx'

const EXTRACT_FIELDS = ['name', 'category', 'dateRange', 'venueName', 'admission', 'organizer', 'suitableFor', 'desc']

// Add/edit form for an event (กิจกรรม). `onChanged` refetches the list behind the modal.
export default function EventFormModal({ onChanged }) {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const open = derived.isEventFormOpen
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dateMode, setDateMode] = useState('range')
  const guard = useDirtyGuard({ open, value: f })
  const photos = usePhotoQueue({
    open,
    editingId: state.editingId,
    fetchPhotos: fetchEventPhotos,
    uploadPhoto: uploadEventPhoto,
    deletePhoto: deleteEventPhoto,
    onDeleted: (updated) => { actions.applyEventUpdate(updated); onChanged() },
    loadErrorLabel: 'โหลดรูปของกิจกรรมไม่สำเร็จ: ',
    entityLabel: 'กิจกรรม',
  })

  // Venue-name <datalist> suggestions -- no bulk state.places to map names off of anymore, so fetch
  // the lean id+name list once instead.
  const [placeNames, setPlaceNames] = useState([])
  useEffect(() => {
    let cancelled = false
    fetchPlaceNames().then((rows) => { if (!cancelled) setPlaceNames(rows) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!open) return
    setErrors({})
    // eventStartDate/eventEndDate are only populated for events created/edited since these were
    // added -- older rows have neither, so their pickers open blank and inferDateMode() falls back
    // to 'custom' (if there's at least a hand-written dateRange) or 'range'.
    setStartDate(f.eventStartDate || '')
    setEndDate(f.eventEndDate || '')
    setDateMode(inferDateMode(f))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // `mode` defaults to the current dateMode, but takes an explicit override for handleDateModeChange
  // -- setDateMode() doesn't take effect until the next render, so reading the `dateMode` state var
  // right after calling it would still see the old value.
  const applyDateRange = (start, end, mode = dateMode) => {
    setStartDate(start)
    setEndDate(end)
    actions.updateFormField('eventStartDate', start)
    actions.updateFormField('eventEndDate', end)
    // 'custom' events (irregular schedules like "ทุกวันเสาร์-อาทิตย์เดือน ธ.ค.") can't be reduced to
    // a start-end formula -- the pickers there only set the outer bounds used for embedding expiry,
    // the dateRange text is whatever the admin typed by hand.
    if (mode === 'custom') return
    const formatted = formatDateRange(start, end)
    if (formatted) actions.updateFormField('dateRange', formatted)
  }

  const handleDateModeChange = (mode) => {
    setDateMode(mode)
    if (mode === 'single') applyDateRange(startDate, startDate, mode)
    else if (mode === 'range') applyDateRange(startDate, endDate, mode)
  }

  const handleExtracted = (extracted) => {
    EXTRACT_FIELDS.forEach((field) => actions.updateFormField(field, extracted[field] || ''))
    // The start/end dates drive the computed event status, so fill the date pickers too. Keep the
    // LLM's own dateRange text ('custom') when it isn't a plain start-end range (e.g.
    // "ทุกวันเสาร์-อาทิตย์เดือน ธ.ค.").
    const start = extracted.eventStartDate || ''
    const end = extracted.eventEndDate || ''
    if (start) {
      const plain = !extracted.dateRange || extracted.dateRange === formatDateRange(start, end)
      const mode = plain ? inferDateMode({ eventStartDate: start, eventEndDate: end }) : 'custom'
      setDateMode(mode)
      applyDateRange(start, end, mode)
    } else {
      setStartDate('')
      setEndDate('')
      actions.updateFormField('eventStartDate', '')
      actions.updateFormField('eventEndDate', '')
      setDateMode(extracted.dateRange ? 'custom' : 'range')
    }
  }

  const handleClose = () => {
    if (saving) return
    guard.requestClose(() => { setErrors({}); actions.cancelForm() })
  }

  // Bypasses actions.saveForm() (which closes the modal the instant the JSON fields are saved) and
  // calls the API directly instead -- pending photos need the modal to stay open through the upload
  // too, same reasoning as PlaceFormModal's handleSave.
  const handleSave = async () => {
    const e = {}
    if (!f.name?.trim()) e.name = 'กรุณากรอกชื่องาน'
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    try {
      let saved
      try {
        saved = state.editingId ? await updateEvent(state.editingId, f) : await createEvent(f)
      } catch (err) {
        actions.reportError('บันทึกกิจกรรมไม่สำเร็จ: ', err)
        return
      }
      const hadPhotos = photos.pendingCount > 0
      const result = await photos.uploadPending(saved)
      actions.applyEventUpdate(result.saved)
      onChanged()
      if (!result.failed) actions.showToast(hadPhotos ? 'บันทึกกิจกรรมและรูปแล้ว' : 'บันทึกกิจกรรมแล้ว')
      actions.cancelForm()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={state.editingId ? 'แก้ไขกิจกรรม' : 'สร้างกิจกรรมใหม่'}
        size="lg"
        footer={<FormActions onSave={handleSave} onCancel={handleClose} saving={saving} />}
      >
        <EventAiExtract onExtracted={handleExtracted} />

        <FormSection title="ข้อมูลพื้นฐาน">
          <FormGrid>
            <Field label="ชื่องาน" required error={errors.name}>
              <input className="ad-input" value={f.name || ''} onChange={actions.onField_name} placeholder="เช่น เทศกาลไดโนเสาร์" />
            </Field>
            <Field label="ประเภทงาน">
              <input className="ad-input" list="event-category-options" value={f.category || ''} onChange={actions.onField_category} placeholder="เช่น เทศกาล, งานวัด" />
            </Field>
          </FormGrid>
          <datalist id="event-category-options">
            {EVENT_CATEGORY_OPTIONS.map((c) => <option key={c} value={c} />)}
          </datalist>
          <Field label="ช่วงวันจัดงาน">
            <EventDateComposer
              mode={dateMode}
              onModeChange={handleDateModeChange}
              start={startDate}
              end={endDate}
              onChange={(s, e) => applyDateRange(s, e)}
              displayText={f.dateRange}
            />
          </Field>
          <Field label={dateMode === 'custom' ? 'ข้อความช่วงวันที่ (พิมพ์เอง เช่น "ทุกวันเสาร์-อาทิตย์เดือน ธ.ค.")' : 'ข้อความช่วงวันที่ (เติมให้อัตโนมัติจากด้านบน แก้ไขเพิ่มเองได้)'}>
            <input className="ad-input" value={f.dateRange || ''} onChange={actions.onField_dateRange} placeholder="เช่น 1-3 ธ.ค. 2569 หรือ ทุกวันเสาร์-อาทิตย์เดือน ธ.ค." />
          </Field>
          <Field label="เชื่อมกับสถานที่ในระบบ (ไม่บังคับ)">
            <PlacePicker
              value={f.placeId}
              onChange={(placeId) => {
                actions.updateFormField('placeId', placeId)
                const place = placeNames.find((p) => p.id === placeId)
                if (place) actions.updateFormField('venueName', place.name)
              }}
              allowClear
              onAddFromGoogle={async ({ name, address, lat, lng }) => {
                // Quick-added mid-search -- not a reviewed touristic destination, so it starts hidden
                // from the public places list (isActive: false) until an admin promotes it from the
                // places tab. See placePayload() in backend/src/lib/mappers.js.
                const created = await createPlace({
                  name, category: '', rating: '', reviews: '0', price: '', address, lat, lng,
                  hours: '', phone: '', desc: '', amenities: '', tags: '', hasQR: false, qrPoints: '0',
                  isActive: false,
                })
                setPlaceNames((names) => [...names, { id: created.id, name: created.name }])
                actions.updateFormField('placeId', created.id)
                actions.updateFormField('venueName', created.name)
              }}
            />
            <div className="ad-hint">เลือกถ้างานนี้จัดที่สถานที่ที่มีอยู่แล้วในระบบ -- เติมชื่อสถานที่ด้านล่างให้อัตโนมัติ (แก้ไขเพิ่มเองได้)</div>
          </Field>
          <Field label="สถานที่จัดงาน">
            <input className="ad-input" list="event-venue-options" value={f.venueName || ''} onChange={actions.onField_venueName} placeholder="ชื่อสถานที่/สนาม" />
          </Field>
          <datalist id="event-venue-options">
            {placeNames.map((p) => <option key={p.id} value={p.name} />)}
          </datalist>
        </FormSection>

        <FormSection title="รูปภาพ">
          <div className="ad-hint">อัปโหลดได้สูงสุด <strong>{MAX_PHOTOS} รูปต่อกิจกรรม</strong> รูปแรกจะใช้เป็นภาพปก</div>
          <div>
            <PlacePhotoGallery {...photos.galleryProps} />
            {photos.photoError && <div className="ad-hint is-error">{photos.photoError}</div>}
          </div>
        </FormSection>

        <FormSection title="รายละเอียดงาน">
          <FormGrid>
            <Field label="ค่าเข้างาน">
              <input className="ad-input" value={f.admission || ''} onChange={actions.onField_admission} placeholder="เช่น ฟรี, 50 บาท" />
            </Field>
            <Field label="ผู้จัดงาน">
              <input className="ad-input" value={f.organizer || ''} onChange={actions.onField_organizer} placeholder="หน่วยงาน/ผู้จัด" />
            </Field>
          </FormGrid>
          <FormGroup legend="กลุ่มที่เหมาะสม">
            <ChipMultiSelect
              value={f.suitableFor}
              onChange={(v) => actions.updateFormField('suitableFor', v)}
              options={SUITABLE_FOR_OPTIONS}
              addPlaceholder="เพิ่มกลุ่มอื่น..."
            />
          </FormGroup>
          <Field label="รายละเอียดงาน">
            <textarea className="ad-textarea" value={f.desc || ''} onChange={actions.onField_desc} placeholder="รายละเอียดงาน" />
          </Field>
        </FormSection>

        <FormSection title="สถานะ">
          <Field label="สถานะ">
            <select className="ad-select" value={f.status === 'cancelled' ? 'cancelled' : 'upcoming'} onChange={actions.onField_status}>
              <option value="upcoming">ปกติ (เร็วๆ นี้ / กำลังจัดอยู่ / จบแล้ว คำนวณจากวันที่จัดงาน)</option>
              <option value="cancelled">ยกเลิกกิจกรรม</option>
            </select>
          </Field>
        </FormSection>
      </Modal>
      {guard.dirtyDialog}
    </>
  )
}
