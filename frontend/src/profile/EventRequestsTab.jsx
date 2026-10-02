import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePagedList } from '../lib/usePagedList.js'
import {
  fetchMyEventRequests, submitEventRequest, updateEventRequest, cancelEventRequest,
  fetchEventRequestPhotos, uploadEventRequestPhoto, deleteEventRequestPhoto, fetchPlaceNames,
} from '../lib/apiClient.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import PageControls from '../components/PageControls.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import SectionHeading from '../components/SectionHeading.jsx'
import ChipMultiSelect from '../components/ChipMultiSelect.jsx'
import PlacePhotoGallery, { MAX_PHOTOS } from '../components/PlacePhotoGallery.jsx'
import PlacePicker from '../components/PlacePicker.jsx'
import EventDateComposer from '../components/EventDateComposer.jsx'
import { MASCOT, EVENT_ICON } from '../data/categoryImages.js'
import { EVENT_REQUEST_STATUS } from '../data/eventRequests.js'
import { EVENT_CATEGORY_OPTIONS, SUITABLE_FOR_OPTIONS, formatDateRange, inferDateMode } from '../data/eventForm.js'
import { Card, Notice, primaryBtn } from './ui.jsx'

// Same fields (and look) as the admin form in admin/EventsTab.jsx -- minus the
// Facebook paste/extract box and the cancelled status, which are admin-only.
const inputStyle = { width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }
const EMPTY = { name: '', category: '', dateRange: '', eventStartDate: '', eventEndDate: '', placeId: '', venueName: '', admission: '', organizer: '', suitableFor: '', desc: '' }
const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const FILTERS = [{ value: undefined, label: 'ทั้งหมด' }, { value: 'pending', label: 'รออนุมัติ' }, { value: 'approved', label: 'อนุมัติแล้ว' }, { value: 'rejected', label: 'ไม่อนุมัติ' }]
const fmt = (d) => new Date(d).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const toForm = (r) => ({ ...EMPTY, ...r, suitableFor: (r.suitableFor || []).join(', '), placeId: r.placeId || '' })

// `request` null = new request, otherwise editing that (still pending) request.
function RequestModal({ open, request, onClose, onSaved }) {
  const [f, setF] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [dateMode, setDateMode] = useState('range')
  const [placeNames, setPlaceNames] = useState([])
  const [existingPhotos, setExistingPhotos] = useState([])
  const [pendingFiles, setPendingFiles] = useState([])
  const [photoError, setPhotoError] = useState('')
  const [removingPhotoId, setRemovingPhotoId] = useState(null)
  const [galleryBusy, setGalleryBusy] = useState(false)
  const [galleryBusyText, setGalleryBusyText] = useState('')
  const initialRef = useRef('')
  const set = (key) => (e) => setF((prev) => ({ ...prev, [key]: e.target.value }))
  const setField = (key, value) => setF((prev) => ({ ...prev, [key]: value }))

  useEffect(() => {
    let cancelled = false
    fetchPlaceNames().then((rows) => { if (!cancelled) setPlaceNames(rows) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!open) return
    const initial = request ? toForm(request) : EMPTY
    setF(initial)
    initialRef.current = JSON.stringify(initial)
    setDateMode(inferDateMode(initial))
    setErrors({})
    setSaveError('')
    setPhotoError('')
    setPendingFiles([])
    setExistingPhotos([])
    if (request) {
      let cancelled = false
      fetchEventRequestPhotos(request.id).then((rows) => { if (!cancelled) setExistingPhotos(rows) }).catch(() => {})
      return () => { cancelled = true }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request?.id])

  const applyDateRange = (start, end, mode = dateMode) => {
    setF((prev) => {
      const next = { ...prev, eventStartDate: start, eventEndDate: end }
      // 'custom' = irregular schedule: the dates are only outer bounds and the
      // text is whatever was typed by hand.
      if (mode !== 'custom') { const formatted = formatDateRange(start, end); if (formatted) next.dateRange = formatted }
      return next
    })
  }
  const handleDateModeChange = (mode) => {
    setDateMode(mode)
    if (mode === 'single') applyDateRange(f.eventStartDate, f.eventStartDate, mode)
    else if (mode === 'range') applyDateRange(f.eventStartDate, f.eventEndDate, mode)
  }

  const isDirty = () => JSON.stringify(f) !== initialRef.current || pendingFiles.length > 0
  const handleClose = () => {
    if (saving) return
    if (isDirty() && !window.confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการปิดฟอร์มนี้หรือไม่?')) return
    pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.previewUrl))
    onClose()
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
  const handleRemovePending = (index) => setPendingFiles((prev) => { URL.revokeObjectURL(prev[index].previewUrl); return prev.filter((_, i) => i !== index) })
  const handleRemoveExisting = async (photoId) => {
    setRemovingPhotoId(photoId)
    try {
      await deleteEventRequestPhoto(request.id, photoId)
      setExistingPhotos((prev) => prev.filter((p) => p.id !== photoId))
    } catch (err) {
      setPhotoError(`ลบรูปไม่สำเร็จ: ${err.message}`)
    } finally {
      setRemovingPhotoId(null)
    }
  }

  const handleSave = async () => {
    const e = {}
    if (!f.name?.trim()) e.name = 'กรุณากรอกชื่องาน'
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    setSaveError('')
    let saved
    try {
      saved = request ? await updateEventRequest(request.id, f) : await submitEventRequest(f)
    } catch (err) {
      setSaveError(err.message)
      setSaving(false)
      return
    }
    // Sequential, not Promise.all: the backend derives each photo's position
    // from the current count, so parallel uploads could collide.
    let uploaded = 0
    let photoFailure = ''
    if (pendingFiles.length) {
      setGalleryBusy(true)
      try {
        for (const pf of pendingFiles) {
          setGalleryBusyText(`กำลังอัปโหลดรูป ${uploaded + 1}/${pendingFiles.length}...`)
          await uploadEventRequestPhoto(saved.id, pf.file)
          uploaded++
        }
      } catch (err) {
        photoFailure = `บันทึกคำขอแล้ว แต่อัปโหลดรูปสำเร็จแค่ ${uploaded}/${pendingFiles.length} (กด “แก้ไข” เพื่ออัปโหลดที่เหลือ): ${err.message}`
      } finally {
        setGalleryBusy(false)
        setGalleryBusyText('')
      }
    }
    pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.previewUrl))
    setSaving(false)
    onSaved({ edited: !!request, photoFailure })
  }

  return (
    <Modal open={open} onClose={handleClose} title={request ? 'แก้ไขคำขอกิจกรรม' : 'ส่งกิจกรรมของคุณ'} maxWidth={700}>
      <div style={{ background: '#F1F8F2', border: '1px solid #CFE8D2', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12.5, color: '#2E7D32' }}>
        ทีมงานจะตรวจสอบก่อนเผยแพร่ กิจกรรมจะแสดงบนเว็บไซต์เมื่อได้รับการอนุมัติ และคุณจะเห็นสถานะที่หน้านี้
      </div>

      <SectionHeading first>ข้อมูลพื้นฐาน</SectionHeading>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 14 }}>
        <Field label="ชื่องาน" required error={errors.name}>
          <input value={f.name} onChange={set('name')} placeholder="เช่น เทศกาลไดโนเสาร์" style={inputStyle} maxLength={200} />
        </Field>
        <Field label="ประเภทงาน">
          <input list="event-request-category-options" value={f.category || ''} onChange={set('category')} placeholder="เช่น เทศกาล, งานวัด" style={inputStyle} />
        </Field>
      </div>
      <datalist id="event-request-category-options">
        {EVENT_CATEGORY_OPTIONS.map((c) => <option key={c} value={c} />)}
      </datalist>
      <Field label="ช่วงวันจัดงาน">
        <div style={{ marginBottom: 14 }}>
          <EventDateComposer mode={dateMode} onModeChange={handleDateModeChange} start={f.eventStartDate || ''} end={f.eventEndDate || ''} onChange={(s, e) => applyDateRange(s, e)} displayText={f.dateRange} />
        </div>
      </Field>
      <Field label={dateMode === 'custom' ? 'ข้อความช่วงวันที่ (พิมพ์เอง เช่น "ทุกวันเสาร์-อาทิตย์เดือน ธ.ค.")' : 'ข้อความช่วงวันที่ (เติมให้อัตโนมัติจากด้านบน แก้ไขเพิ่มเองได้)'}>
        <input value={f.dateRange || ''} onChange={set('dateRange')} placeholder="เช่น 1-3 ธ.ค. 2569 หรือ ทุกวันเสาร์-อาทิตย์เดือน ธ.ค." style={{ ...inputStyle, marginBottom: 14 }} maxLength={200} />
      </Field>
      <Field label="เชื่อมกับสถานที่ในระบบ (ไม่บังคับ)">
        <div style={{ marginBottom: 4 }}>
          <PlacePicker
            value={f.placeId}
            allowClear
            onChange={(placeId) => {
              setField('placeId', placeId)
              const place = placeNames.find((p) => p.id === placeId)
              if (place) setField('venueName', place.name)
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: '#8a938c', marginBottom: 14 }}>เลือกถ้างานนี้จัดที่สถานที่ที่มีอยู่แล้วในระบบ -- เติมชื่อสถานที่ด้านล่างให้อัตโนมัติ (แก้ไขเพิ่มเองได้)</div>
      </Field>
      <Field label="สถานที่จัดงาน">
        <input list="event-request-venue-options" value={f.venueName || ''} onChange={set('venueName')} placeholder="ชื่อสถานที่/สนาม" style={{ ...inputStyle, marginBottom: 14 }} maxLength={200} />
      </Field>
      <datalist id="event-request-venue-options">
        {placeNames.map((p) => <option key={p.id} value={p.name} />)}
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
          <input value={f.admission || ''} onChange={set('admission')} placeholder="เช่น ฟรี, 50 บาท" style={inputStyle} maxLength={200} />
        </Field>
        <Field label="ผู้จัดงาน">
          <input value={f.organizer || ''} onChange={set('organizer')} placeholder="หน่วยงาน/ผู้จัด" style={inputStyle} maxLength={200} />
        </Field>
      </div>
      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
        <legend style={{ fontSize: 12, fontWeight: 700, color: '#3c463f', marginBottom: 4, padding: 0 }}>กลุ่มที่เหมาะสม</legend>
        <ChipMultiSelect value={f.suitableFor} onChange={(v) => setField('suitableFor', v)} options={SUITABLE_FOR_OPTIONS} addPlaceholder="เพิ่มกลุ่มอื่น..." />
      </fieldset>
      <Field label="รายละเอียดงาน">
        <textarea value={f.desc || ''} onChange={set('desc')} placeholder="รายละเอียดงาน" style={{ ...inputStyle, minHeight: 60, marginBottom: 14 }} maxLength={3000}></textarea>
      </Field>

      <Notice>{saveError}</Notice>
      <div style={{ position: 'sticky', bottom: -24, marginLeft: -24, marginRight: -24, marginTop: 20, background: '#fff', borderTop: '1px solid #E7E3D2', padding: '14px 24px', display: 'flex', gap: 10 }}>
        <button onClick={handleSave} disabled={saving} style={{ background: saving ? '#A5D6A7' : 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'กำลังส่ง...' : request ? 'บันทึกการแก้ไข' : 'ส่งคำขอ'}</button>
        <button onClick={handleClose} disabled={saving} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: saving ? 'default' : 'pointer' }}>ยกเลิก</button>
      </div>
    </Modal>
  )
}

const smallBtn = { background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: '6px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }

function RequestRow({ item, onEdit, onCancel, busy }) {
  const st = EVENT_REQUEST_STATUS[item.status]
  return (
    <li style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #F0EDE0' }}>
      <ImageSlot src={item.img} shape="rounded" radius={10} style={{ width: 64, height: 64, flexShrink: 0 }} placeholder="ภาพงาน" icon={EVENT_ICON} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1f2a24', wordBreak: 'break-word' }}>{item.name}</div>
          <span style={{ fontSize: 11.5, fontWeight: 700, background: st.bg, color: st.color, padding: '3px 10px', borderRadius: 20 }}>{st.label}</span>
        </div>
        <div style={{ fontSize: 12, color: '#8a938c' }}>{item.dateRange}{item.venueName ? ` · ${item.venueName}` : ''} · ส่งเมื่อ {fmt(item.createdAt)}</div>
        {item.status === 'rejected' && <div style={{ fontSize: 13, color: '#a33232', marginTop: 4 }}>เหตุผลที่ไม่อนุมัติ: {item.rejectReason}</div>}
        {item.status === 'approved' && item.eventId && <div style={{ fontSize: 13, marginTop: 4 }}><Link to={`/events/${item.eventId}`} style={{ color: '#2E7D32', fontWeight: 700 }}>ดูกิจกรรมบนเว็บไซต์ →</Link></div>}
        {item.status === 'pending' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" disabled={busy} onClick={() => onEdit(item)} style={smallBtn}>แก้ไข</button>
            <button type="button" disabled={busy} onClick={() => onCancel(item.id)} style={{ ...smallBtn, background: '#fdecec', color: '#a33232' }}>{busy ? 'กำลังยกเลิก...' : 'ยกเลิกคำขอ'}</button>
          </div>
        )}
      </div>
    </li>
  )
}

// "กิจกรรมของฉัน": submit an event for the platform to show (an admin approves
// it) and follow the status of each request.
export default function EventRequestsTab() {
  const [status, setStatus] = useState(undefined)
  const list = usePagedList(fetchMyEventRequests, { pageSize: 10, extraParams: { status } })
  const [modal, setModal] = useState({ open: false, request: null })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const cancel = async (id) => {
    if (!window.confirm('ยกเลิกคำขอนี้หรือไม่? ข้อมูลและรูปที่แนบไว้จะถูกลบ')) return
    setBusyId(id)
    setError('')
    setNotice('')
    try {
      await cancelEventRequest(id)
      list.refetch()
    } catch (err) {
      setError(err.message)
      list.refetch()
    } finally {
      setBusyId('')
    }
  }

  const handleSaved = ({ edited, photoFailure }) => {
    setModal({ open: false, request: null })
    setStatus(undefined)
    list.refetch()
    setNotice(edited ? 'บันทึกการแก้ไขแล้ว' : 'ส่งคำขอแล้ว รอทีมงานตรวจสอบ')
    setError(photoFailure)
  }

  return (
    <Card
      title="กิจกรรมของฉัน"
      subtitle="ส่งกิจกรรมของคุณเพื่อขอแสดงบนแพลตฟอร์ม ทีมงานจะตรวจสอบก่อนเผยแพร่"
      action={<button type="button" onClick={() => { setNotice(''); setError(''); setModal({ open: true, request: null }) }} style={primaryBtn(false)}>+ ส่งกิจกรรมใหม่</button>}
    >
      <RequestModal open={modal.open} request={modal.request} onClose={() => setModal({ open: false, request: null })} onSaved={handleSaved} />
      <Notice kind="success">{notice}</Notice>
      <Notice>{error}</Notice>

      <div role="group" aria-label="กรองสถานะ" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {FILTERS.map((f) => (
          <button key={f.label} type="button" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}
            style={{ padding: '6px 14px', borderRadius: 16, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: status === f.value ? 'none' : '1px solid #DCD8C6', background: status === f.value ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff', color: status === f.value ? '#fff' : '#3c463f' }}>
            {f.label}
          </button>
        ))}
      </div>

      {list.error ? (
        <LoadError message="โหลดคำขอไม่สำเร็จ" onRetry={list.refetch} />
      ) : list.loading ? (
        <LoadingSpinner size={28} label="กำลังโหลดคำขอ..." />
      ) : list.rows.length === 0 ? (
        <EmptyState compact mascot={MASCOT.sleep} title="ยังไม่มีคำขอ" desc="กดปุ่ม “ส่งกิจกรรมใหม่” เพื่อเริ่มต้น" />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {list.rows.map((item) => <RequestRow key={item.id} item={item} onEdit={(r) => { setNotice(''); setError(''); setModal({ open: true, request: r }) }} onCancel={cancel} busy={busyId === item.id} />)}
        </ul>
      )}
      <PageControls page={list.page} totalPages={list.totalPages} total={list.total} onChange={list.setPage} />
    </Card>
  )
}
