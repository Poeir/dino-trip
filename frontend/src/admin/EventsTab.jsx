import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { extractEventFromText, createEvent, updateEvent, fetchEventPhotos, uploadEventPhoto, deleteEventPhoto, createPlace } from '../lib/apiClient.js'
import ImageSlot from '../components/ImageSlot.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import SectionHeading from '../components/SectionHeading.jsx'
import ChipMultiSelect from '../components/ChipMultiSelect.jsx'
import PlacePhotoGallery, { MAX_PHOTOS } from '../components/PlacePhotoGallery.jsx'
import PlacePicker from '../components/PlacePicker.jsx'
import EventDateComposer from '../components/EventDateComposer.jsx'

const inputStyle = { width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }
const EXTRACT_FIELDS = ['name', 'category', 'dateRange', 'venueName', 'admission', 'organizer', 'suitableFor', 'desc']
const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// Not tied to any backend taxonomy (events.category has no CHECK constraint,
// unlike places) -- just a starting-point suggestion list so admins aren't
// always typing from scratch. Lifted from the examples already baked into
// the AI-extraction prompt (chatbot-service/src/api/routes_events.py) so the
// two don't suggest different vocabularies.
const EVENT_CATEGORY_OPTIONS = ['เทศกาล', 'งานวัด/งานบุญ', 'คอนเสิร์ต/ดนตรี', 'งานประเพณี', 'นิทรรศการ', 'งานกีฬา', 'ตลาดนัด']
const SUITABLE_FOR_OPTIONS = ['ครอบครัว', 'เด็ก', 'วัยรุ่น', 'ผู้ใหญ่', 'ผู้สูงอายุ', 'คู่รัก', 'กลุ่มเพื่อน', 'นักท่องเที่ยวต่างชาติ']

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// input[type=date] gives 'YYYY-MM-DD' (Gregorian) -- format it the way this
// admin team already writes dates by hand (see EXTRACT_FIELDS' dateRange
// example: "1-3 ธ.ค. 2569"), Buddhist Era year included.
function thaiDateParts(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return { day: d, month: THAI_MONTHS[m - 1], year: y + 543 }
}

const todayIso = new Date().toISOString().slice(0, 10)

// Mirrors chatbot-service/src/services/rag/embedder.py's expiry rule: an
// event whose end date (or start date, if no end was given) is in the past
// gets its embedding cleared on the next reindex, so it drops out of
// chatbot search even before that run has actually happened.
function eventIndexStatus(e) {
  const end = e.eventEndDate || e.eventStartDate
  if (end && end < todayIso) return { label: 'หมดงานแล้ว · ไม่อยู่ในดัชนีค้นหา', color: '#8a938c' }
  if (e.isEmbedded) return { label: 'อยู่ในดัชนีค้นหาแชทบอทแล้ว', color: '#2E7D32' }
  return { label: 'ยังไม่ได้ทำดัชนีค้นหา', color: '#b07a1e' }
}

function formatDateRange(startIso, endIso) {
  if (!startIso && !endIso) return ''
  if (!endIso || startIso === endIso) {
    const s = thaiDateParts(startIso || endIso)
    return `${s.day} ${s.month} ${s.year}`
  }
  if (!startIso) {
    const e = thaiDateParts(endIso)
    return `${e.day} ${e.month} ${e.year}`
  }
  const s = thaiDateParts(startIso)
  const e = thaiDateParts(endIso)
  if (s.month === e.month && s.year === e.year) return `${s.day}-${e.day} ${s.month} ${s.year}`
  if (s.year === e.year) return `${s.day} ${s.month} - ${e.day} ${e.month} ${s.year}`
  return `${s.day} ${s.month} ${s.year} - ${e.day} ${e.month} ${e.year}`
}

// Which of the 3 pickers to show when the form opens. Not itself stored --
// derived fresh each time from whatever dates/text are already on the event,
// so there's nothing to keep in sync if an admin edits the row from outside
// this form.
function inferDateMode(f) {
  const start = f.eventStartDate || ''
  const end = f.eventEndDate || ''
  if (!start && !end) return f.dateRange ? 'custom' : 'range'
  if (start && end && start !== end) return 'range'
  return 'single'
}

export default function EventsTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('name-asc')
  const [pasteText, setPasteText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dateMode, setDateMode] = useState('range')
  // Existing = already-uploaded photos (has an id, fetched when opening an
  // existing event for edit). Pending = picked locally but not uploaded yet
  // -- unavoidable for a brand-new event, which has no id to upload against
  // until the rest of the form is saved first (see handleSave).
  const [existingPhotos, setExistingPhotos] = useState([])
  const [pendingFiles, setPendingFiles] = useState([])
  const [photoError, setPhotoError] = useState('')
  const [removingPhotoId, setRemovingPhotoId] = useState(null)
  const [galleryBusy, setGalleryBusy] = useState(false)
  const [galleryBusyText, setGalleryBusyText] = useState('')
  const initialFormRef = useRef(null)

  useEffect(() => {
    if (derived.isEventFormOpen) {
      setPasteText('')
      setExtractError('')
      // eventStartDate/eventEndDate are only populated for events
      // created/edited since these were added -- older rows have neither, so
      // their pickers open blank and inferDateMode() below falls back to
      // 'custom' (if there's at least a hand-written dateRange) or 'range'.
      setStartDate(f.eventStartDate || '')
      setEndDate(f.eventEndDate || '')
      setDateMode(inferDateMode(f))
      pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.previewUrl))
      setPendingFiles([])
      setPhotoError('')
      setExistingPhotos([])
      if (state.editingId) {
        fetchEventPhotos(state.editingId).then(setExistingPhotos).catch(() => setExistingPhotos([]))
      }
      initialFormRef.current = JSON.stringify(f)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.isEventFormOpen])

  // `mode` defaults to the current dateMode, but takes an explicit override
  // for handleDateModeChange -- setDateMode() doesn't take effect until the
  // next render, so reading the `dateMode` state var right after calling it
  // would still see the old value.
  const applyDateRange = (start, end, mode = dateMode) => {
    setStartDate(start)
    setEndDate(end)
    actions.updateFormField('eventStartDate', start)
    actions.updateFormField('eventEndDate', end)
    // 'custom' events (irregular schedules like "ทุกวันเสาร์-อาทิตย์เดือน
    // ธ.ค.") can't be reduced to a start-end formula -- the pickers there
    // only set the outer bounds used for embedding expiry, the dateRange
    // text is whatever the admin typed by hand.
    if (mode === 'custom') return
    const formatted = formatDateRange(start, end)
    if (formatted) actions.updateFormField('dateRange', formatted)
  }

  const handleDateModeChange = (mode) => {
    setDateMode(mode)
    if (mode === 'single') applyDateRange(startDate, startDate, mode)
    else if (mode === 'range') applyDateRange(startDate, endDate, mode)
  }

  const isDirty = () => initialFormRef.current !== null && JSON.stringify(f) !== initialFormRef.current

  const handleClose = () => {
    if (isDirty() && !window.confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการปิดฟอร์มนี้หรือไม่?')) return
    setErrors({})
    actions.cancelForm()
  }

  const validate = () => {
    const e = {}
    if (!f.name?.trim()) e.name = 'กรุณากรอกชื่องาน'
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
      const updated = await deleteEventPhoto(state.editingId, photoId)
      actions.applyEventUpdate(updated)
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
  // need the modal to stay open through the upload too, same reasoning as
  // PlacesTab.jsx's own handleSave.
  const handleSave = async () => {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    try {
      let saved
      try {
        saved = state.editingId ? await updateEvent(state.editingId, f) : await createEvent(f)
      } catch (err) {
        actions.showToast('บันทึกอีเวนท์ไม่สำเร็จ: ' + err.message)
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
            saved = await uploadEventPhoto(saved.id, pf.file)
            uploadedCount++
          }
        } catch (err) {
          actions.showToast(`บันทึกอีเวนท์แล้ว แต่อัปโหลดรูปสำเร็จแค่ ${uploadedCount}/${pendingFiles.length}: ${err.message}`)
        } finally {
          setGalleryBusy(false)
          setGalleryBusyText('')
        }
      }
      actions.applyEventUpdate(saved)
      actions.showToast(pendingFiles.length ? 'บันทึกอีเวนท์และรูปแล้ว' : 'บันทึกอีเวนท์แล้ว')
      actions.cancelForm()
    } finally {
      setSaving(false)
    }
  }

  const handleExtract = async () => {
    if (!pasteText.trim()) return
    setExtracting(true)
    setExtractError('')
    try {
      const extracted = await extractEventFromText(pasteText)
      EXTRACT_FIELDS.forEach((field) => actions.updateFormField(field, extracted[field] || ''))
    } catch (err) {
      setExtractError(err.message)
    } finally {
      setExtracting(false)
    }
  }
  const sorters = {
    'name-asc': (a, b) => a.name.localeCompare(b.name, 'th'),
    'name-desc': (a, b) => b.name.localeCompare(a.name, 'th'),
    'status': (a, b) => a.status.localeCompare(b.status),
  }
  const filteredEventsView = derived.eventsAdminView
    .filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(sorters[sortBy])
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>จัดการอีเวนท์</h1>
        <button onClick={actions.onNewEvent} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ สร้าง Event</button>
      </div>

      <Modal open={derived.isEventFormOpen} onClose={handleClose} title={state.editingId ? 'แก้ไขอีเวนท์' : 'สร้างอีเวนท์ใหม่'} maxWidth={700}>
          <div style={{ background: '#F1F8F2', border: '1px solid #CFE8D2', borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#2E7D32', marginBottom: 4 }}>วางข้อความจากโพสต์ Facebook (ไม่บังคับ)</label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="ก็อปข้อความจากโพสต์เพจ Facebook มาวางที่นี่ แล้วกด &quot;ดึงข้อมูลอัตโนมัติ&quot; เพื่อให้ AI ช่วยเติมฟอร์มด้านล่าง"
              style={{ width: '100%', minHeight: 70, border: '1px solid #CFE8D2', borderRadius: 8, padding: 9, fontSize: 13.5, marginBottom: 8, fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting || !pasteText.trim()}
                style={{ background: extracting || !pasteText.trim() ? '#A5D6A7' : 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 14, fontWeight: 700, fontSize: 13, cursor: extracting || !pasteText.trim() ? 'default' : 'pointer' }}
              >
                {extracting ? 'กำลังดึงข้อมูล...' : 'ดึงข้อมูลอัตโนมัติ'}
              </button>
              <span style={{ fontSize: 11.5, color: '#5c7a63' }}>ตรวจสอบและแก้ไขข้อมูลด้านล่างก่อนบันทึกเสมอ</span>
            </div>
            {extractError && <div style={{ color: '#a33232', fontSize: 12.5, marginTop: 8 }}>ดึงข้อมูลไม่สำเร็จ: {extractError}</div>}
          </div>

          <SectionHeading first>ข้อมูลพื้นฐาน</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 14 }}>
            <Field label="ชื่องาน" required error={errors.name}>
              <input value={f.name || ''} onChange={actions.onField_name} placeholder="เช่น เทศกาลไดโนเสาร์" style={inputStyle} />
            </Field>
            <Field label="ประเภทงาน">
              <input list="event-category-options" value={f.category || ''} onChange={actions.onField_category} placeholder="เช่น เทศกาล, งานวัด" style={inputStyle} />
            </Field>
          </div>
          <datalist id="event-category-options">
            {EVENT_CATEGORY_OPTIONS.map((c) => <option key={c} value={c} />)}
          </datalist>
          <Field label="ช่วงวันจัดงาน">
            <div style={{ marginBottom: 14 }}>
              <EventDateComposer
                mode={dateMode}
                onModeChange={handleDateModeChange}
                start={startDate}
                end={endDate}
                onChange={(s, e) => applyDateRange(s, e)}
                displayText={f.dateRange}
              />
            </div>
          </Field>
          <Field label={dateMode === 'custom' ? 'ข้อความช่วงวันที่ (พิมพ์เอง เช่น "ทุกวันเสาร์-อาทิตย์เดือน ธ.ค.")' : 'ข้อความช่วงวันที่ (เติมให้อัตโนมัติจากด้านบน แก้ไขเพิ่มเองได้)'}>
            <input value={f.dateRange || ''} onChange={actions.onField_dateRange} placeholder="เช่น 1-3 ธ.ค. 2569 หรือ ทุกวันเสาร์-อาทิตย์เดือน ธ.ค." style={{ ...inputStyle, marginBottom: 14 }} />
          </Field>
          <Field label="เชื่อมกับสถานที่ในระบบ (ไม่บังคับ)">
            <div style={{ marginBottom: 4 }}>
              <PlacePicker
                places={state.places}
                value={f.placeId}
                onChange={(placeId) => {
                  actions.updateFormField('placeId', placeId)
                  const place = state.places.find((p) => p.id === placeId)
                  if (place) actions.updateFormField('venueName', place.name)
                }}
                allowClear
                onAddFromGoogle={async ({ name, address, lat, lng }) => {
                  // Quick-added mid-search -- not a reviewed touristic
                  // destination, so it starts hidden from the public places
                  // list (isActive: false) until an admin promotes it from
                  // PlacesTab. See placePayload() in backend/src/lib/mappers.js.
                  const created = await createPlace({
                    name, category: '', rating: '', reviews: '0', price: '', address, lat, lng,
                    hours: '', phone: '', desc: '', amenities: '', tags: '', hasQR: false, qrPoints: '0',
                    isActive: false,
                  })
                  actions.applyPlaceUpdate(created)
                  actions.updateFormField('placeId', created.id)
                  actions.updateFormField('venueName', created.name)
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: '#8a938c', marginBottom: 14 }}>เลือกถ้างานนี้จัดที่สถานที่ที่มีอยู่แล้วในระบบ -- เติมชื่อสถานที่ด้านล่างให้อัตโนมัติ (แก้ไขเพิ่มเองได้)</div>
          </Field>
          <Field label="สถานที่จัดงาน">
            <input list="event-venue-options" value={f.venueName || ''} onChange={actions.onField_venueName} placeholder="ชื่อสถานที่/สนาม" style={{ ...inputStyle, marginBottom: 14 }} />
          </Field>
          <datalist id="event-venue-options">
            {state.places.map((p) => <option key={p.id} value={p.name} />)}
          </datalist>

          <SectionHeading>รูปภาพ</SectionHeading>
          <div style={{ fontSize: 11.5, color: '#6d7a72', marginBottom: 8 }}>อัปโหลดได้สูงสุด <strong>{MAX_PHOTOS} รูปต่ออีเวนท์</strong> รูปแรกจะใช้เป็นภาพปก</div>
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

          <SectionHeading>รายละเอียดงาน</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 14 }}>
            <Field label="ค่าเข้างาน">
              <input value={f.admission || ''} onChange={actions.onField_admission} placeholder="เช่น ฟรี, 50 บาท" style={inputStyle} />
            </Field>
            <Field label="ผู้จัดงาน">
              <input value={f.organizer || ''} onChange={actions.onField_organizer} placeholder="หน่วยงาน/ผู้จัด" style={inputStyle} />
            </Field>
          </div>
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: '#3c463f', marginBottom: 4, padding: 0 }}>กลุ่มที่เหมาะสม</legend>
            <ChipMultiSelect
              value={f.suitableFor}
              onChange={(v) => actions.updateFormField('suitableFor', v)}
              options={SUITABLE_FOR_OPTIONS}
              addPlaceholder="เพิ่มกลุ่มอื่น..."
            />
          </fieldset>
          <Field label="รายละเอียดงาน">
            <textarea value={f.desc || ''} onChange={actions.onField_desc} placeholder="รายละเอียดงาน" style={{ ...inputStyle, minHeight: 60, marginBottom: 14 }}></textarea>
          </Field>

          <SectionHeading>สถานะ</SectionHeading>
          <Field label="สถานะ">
            <select value={f.status || 'upcoming'} onChange={actions.onField_status} style={inputStyle}>
              <option value="upcoming">upcoming</option>
              <option value="published">published</option>
              <option value="cancelled">cancelled</option>
            </select>
          </Field>

          <div style={{ position: 'sticky', bottom: -24, marginLeft: -24, marginRight: -24, marginTop: 20, background: '#fff', borderTop: '1px solid #E7E3D2', padding: '14px 24px', display: 'flex', gap: 10 }}>
            <button onClick={handleSave} disabled={saving} style={{ background: saving ? '#A5D6A7' : 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            <button onClick={handleClose} disabled={saving} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: saving ? 'default' : 'pointer' }}>ยกเลิก</button>
          </div>
      </Modal>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาอีเวนท์..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
          <option value="name-asc">ชื่อ (ก-ฮ)</option>
          <option value="name-desc">ชื่อ (ฮ-ก)</option>
          <option value="status">สถานะ</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
        {filteredEventsView.map((e) => (
          <div key={e.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, overflow: 'hidden' }}>
            <ImageSlot src={e.img} shape="rect" style={{ width: '100%', height: 110 }} placeholder="ภาพงาน" />
            <div style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{e.name}</div>
              <div style={{ fontSize: 12.5, color: '#6d7a72', marginBottom: 4 }}>{e.dateRange} · {e.status}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: eventIndexStatus(e).color, marginBottom: 10 }}>{eventIndexStatus(e).label}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={e.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
                <button onClick={e.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
