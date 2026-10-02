import { useEffect, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import PlacePicker from '../components/PlacePicker.jsx'
import PageControls from '../components/PageControls.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { QR_ICON, REWARD_ICON } from '../data/categoryImages.js'
import LoadError from '../components/LoadError.jsx'
import RadiusMap from '../components/RadiusMap.jsx'
import { fetchPlace, fetchRewards, fetchPlaceNames, uploadRewardImage, deleteRewardImage, updateQr, fetchQrStats } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'

// qrs has no DB column to search/sort "by place name" against (that's a
// join, done client-side in derived.qrsView below) -- so unlike rewards,
// its list stays a client-side slice of the already bulk-loaded state.qrs
// rather than its own paginated fetch. See usePagedList.js for the
// server-paginated pattern used everywhere else.
const QR_PAGE_SIZE = 20

// QrTab's rewards sort dropdown -> crudRouter.js's ?sort=/?dir=.
const REWARD_SORT_PARAMS = {
  'name-asc': { sort: 'name', dir: 'asc' },
  'name-desc': { sort: 'name', dir: 'desc' },
  'cost-desc': { sort: 'cost', dir: 'desc' },
  'cost-asc': { sort: 'cost', dir: 'asc' },
}

// Just the opaque qrId -- points/place name are looked up server-side when
// this URL is scanned (see qrs.routes.js's POST /:id/scan), never trusted
// from the QR's own content. A full URL (rather than a bare id string)
// means the code also works when scanned by a phone's regular camera app,
// not just the in-app scanner -- see ScanLandingPage.jsx.
const qrValue = (q) => `${window.location.origin}/scan/${q.id}`
// <input type="datetime-local"> wants local 'YYYY-MM-DDTHH:mm'; the form keeps
// expiresAt as a full ISO string (what the API stores), so convert both ways.
const pad2 = (n) => String(n).padStart(2, '0')
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
const localInputToIso = (v) => (v ? new Date(v).toISOString() : '')
const formatDateTime = (iso) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

function qrStatus(q) {
  if (!q.isActive) return { label: 'ปิดใช้งาน', bg: '#eee', color: '#5f6a63' }
  if (q.expiresAt && new Date(q.expiresAt) <= new Date()) return { label: 'หมดอายุ', bg: '#fdecec', color: '#a33232' }
  return { label: 'ใช้งานอยู่', bg: '#E8F5E9', color: '#2E7D32' }
}

const MAX_REWARD_IMAGE_BYTES = 2 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const PREVIEW_CANVAS_ID = 'qr-canvas-preview'
const PRINT_CANVAS_ID = 'qr-canvas-print'

function downloadQrPng(canvasId, filename) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
}

// Small hand-drawn glyphs (border/pseudo-element shapes, no icon library) --
// matches how every other icon in the admin (sidebar, dashboard stat cards)
// is built. Pulled out here once instead of redrawn per usage site.
function QrGlyph({ color = '#7A5205', size = 16 }) {
  return (
    <span style={{ width: size, height: size * 0.76, border: `2px solid ${color}`, borderRadius: 3, position: 'relative', display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: size * 0.1, left: size * 0.18, width: size * 0.35, height: size * 0.35, borderRadius: '50%', border: `2px solid ${color}` }} />
    </span>
  )
}
function GiftGlyph({ color = '#7A5205', size = 17 }) {
  return (
    <span style={{ width: size, height: size * 0.78, border: `2px solid ${color}`, borderRadius: 2, position: 'relative', display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: -size * 0.35, left: size * 0.36, width: 2, height: size * 1.15, background: color }} />
      <span style={{ position: 'absolute', top: size * 0.1, left: -1, width: size * 1.15, height: 2, background: color }} />
    </span>
  )
}

function IconBadge({ children, bg = '#FFF8E1', size = 36, radius = 10 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {children}
    </div>
  )
}

function StatCard({ icon, value, label }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
      <IconBadge size={40}>{icon}</IconBadge>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', lineHeight: 1.2 }}>{value}</div>
        <div style={{ fontSize: 12.5, color: '#5f6a63' }}>{label}</div>
      </div>
    </div>
  )
}

function SectionHeader({ icon, title, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <IconBadge>{icon}</IconBadge>
      <div style={{ fontWeight: 800, fontSize: 15, color: '#1B5E20' }}>{title}</div>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#7A5205', background: '#FFF8E1', padding: '2px 10px', borderRadius: 20 }}>{count}</span>
    </div>
  )
}

function QrEmptyState({ icon, title, desc, actionLabel, onAction, buttonStyle }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      desc={desc}
      action={<button onClick={onAction} style={{ border: 'none', padding: '9px 22px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', ...buttonStyle }}>{actionLabel}</button>}
    />
  )
}

// Kept in step with backend/src/lib/mappers.js's qrPayload/rewardPayload limits.
const QR_POINTS_MAX = 10000
const QR_RADIUS_MIN_M = 20
const QR_RADIUS_MAX_M = 5000
const REWARD_COST_MAX = 1000000
const isWholeInRange = (v, min, max) => /^\d+$/.test(String(v ?? '').trim()) && Number(v) >= min && Number(v) <= max

const QR_POINT_PRESETS = [5, 10, 20, 50]
const REWARD_COST_PRESETS = [50, 100, 200, 500]

// Preset chips + a "custom" chip that reveals a number input -- so admins pick
// a level instead of inventing a number, while any value stays possible.
function PointsPicker({ value, onChange, presets, hint }) {
  const [customMode, setCustomMode] = useState(false)
  const num = Number(value)
  const isCustom = customMode || (value !== '' && value != null && !presets.includes(num))
  const chip = (active) => ({
    padding: '8px 16px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${active ? '#2E7D32' : '#DCD8C6'}`,
    background: active ? '#E8F5E9' : '#fff',
    color: active ? '#1B5E20' : '#3c463f',
  })
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => { setCustomMode(false); onChange(String(p)) }} style={chip(!isCustom && num === p)}>{p}</button>
        ))}
        <button type="button" onClick={() => setCustomMode(true)} style={chip(isCustom)}>กำหนดเอง</button>
      </div>
      {isCustom && (
        <input
          value={value ?? ''} inputMode="numeric" placeholder="พิมพ์จำนวนพอยท์"
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginTop: 8 }}
        />
      )}
      {hint && <div style={{ fontSize: 12, color: '#626863', marginTop: 8 }}>{hint}</div>}
    </div>
  )
}

export default function QrTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [qrQuery, setQrQuery] = useState('')
  const [qrSortBy, setQrSortBy] = useState('placeName-asc')
  const [qrPage, setQrPage] = useState(1)
  const [rewardSortBy, setRewardSortBy] = useState('name-asc')
  const pagedRewards = usePagedList(fetchRewards, { pageSize: 20, extraParams: REWARD_SORT_PARAMS[rewardSortBy] })
  const [previewQr, setPreviewQr] = useState(null)
  const [printQr, setPrintQr] = useState(null)
  const [placeNameById, setPlaceNameById] = useState(new Map())
  const [qrStats, setQrStats] = useState(new Map())
  const [togglingQrId, setTogglingQrId] = useState(null)
  // undefined = not loaded yet, null = place has no coordinates.
  const [formPlaceLocation, setFormPlaceLocation] = useState(undefined)

  useEffect(() => {
    if (!derived.isQrFormOpen || !f.placeId) { setFormPlaceLocation(undefined); return }
    let cancelled = false
    setFormPlaceLocation(undefined)
    fetchPlace(f.placeId)
      .then((p) => { if (!cancelled) setFormPlaceLocation(p?.location || null) })
      .catch(() => { if (!cancelled) setFormPlaceLocation('error') })
    return () => { cancelled = true }
  }, [derived.isQrFormOpen, f.placeId])

  const [qrStatsError, setQrStatsError] = useState(false)

  const loadQrStats = () => {
    setQrStatsError(false)
    fetchQrStats()
      .then((rows) => setQrStats(new Map(rows.map((s) => [s.qrId, s]))))
      .catch((err) => { if (!actions.handleSessionExpired(err)) setQrStatsError(true) })
  }
  useEffect(() => { loadQrStats() }, [])

  const [savingQr, setSavingQr] = useState(false)
  const handleSaveQr = async () => {
    setSavingQr(true)
    try { await actions.saveForm() } finally { setSavingQr(false) }
  }

  const handleToggleQr = async (q) => {
    setTogglingQrId(q.id)
    try {
      const updated = await updateQr(q.id, { placeId: q.placeId, points: q.points, radiusM: q.radiusM, expiresAt: q.expiresAt || '', isActive: !q.isActive })
      actions.applyQrUpdate(updated)
    } catch (err) {
      if (!actions.handleSessionExpired(err)) actions.showToast('เปลี่ยนสถานะ QR ไม่สำเร็จ: ' + (err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message), 5000)
    } finally {
      setTogglingQrId(null)
    }
  }

  // Reward image is picked locally and only uploaded after the reward row is
  // saved -- a brand-new reward has no id to upload against until then.
  const [rewardFile, setRewardFile] = useState(null)
  const [rewardPreview, setRewardPreview] = useState('')
  const [removeRewardImage, setRemoveRewardImage] = useState(false)
  const [rewardImageError, setRewardImageError] = useState('')
  const [savingReward, setSavingReward] = useState(false)

  useEffect(() => {
    if (rewardPreview) URL.revokeObjectURL(rewardPreview)
    setRewardFile(null)
    setRewardPreview('')
    setRemoveRewardImage(false)
    setRewardImageError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.isRewardFormOpen, state.editingId])

  const handlePickRewardImage = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) { setRewardImageError('รองรับเฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)'); return }
    if (file.size > MAX_REWARD_IMAGE_BYTES) { setRewardImageError('ไฟล์ใหญ่เกินไป (จำกัด 2MB)'); return }
    setRewardImageError('')
    if (rewardPreview) URL.revokeObjectURL(rewardPreview)
    setRewardFile(file)
    setRewardPreview(URL.createObjectURL(file))
    setRemoveRewardImage(false)
  }

  const handleRemoveRewardImage = () => {
    if (rewardPreview) URL.revokeObjectURL(rewardPreview)
    setRewardFile(null)
    setRewardPreview('')
    setRemoveRewardImage(true)
  }

  // derived.qrsView no longer joins placeName (no bulk state.places to join
  // against) -- fetch a lean id->name map once instead.
  const [placeNamesError, setPlaceNamesError] = useState(false)
  const loadPlaceNames = () => {
    setPlaceNamesError(false)
    fetchPlaceNames()
      .then((rows) => setPlaceNameById(new Map(rows.map((p) => [p.id, p.name]))))
      .catch(() => setPlaceNamesError(true))
  }
  useEffect(() => { loadPlaceNames() }, [])

  // Search/sort narrow the qrs result set -- back to page 1 so it doesn't
  // land on a now out-of-range page of the shorter list.
  useEffect(() => { setQrPage(1) }, [qrQuery, qrSortBy])

  // Prints just #qr-print-label (see the @media print rule below it) --
  // window.print() opens the browser's normal print dialog, which already
  // offers "Save as PDF", so no PDF library/dependency is needed here.
  useEffect(() => {
    if (!printQr) return
    const handleAfterPrint = () => setPrintQr(null)
    window.addEventListener('afterprint', handleAfterPrint)
    const t = setTimeout(() => window.print(), 50)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', handleAfterPrint) }
  }, [printQr])

  const handleSaveReward = async () => {
    setSavingReward(true)
    try {
      const wasEditing = !!state.editingId
      const item = await actions.saveForm()
      if (item) {
        try {
          let updated = null
          if (rewardFile) updated = await uploadRewardImage(item.id, rewardFile)
          else if (removeRewardImage && wasEditing) updated = await deleteRewardImage(item.id)
          if (updated) actions.applyRewardUpdate(updated)
        } catch (err) {
          if (!actions.handleSessionExpired(err)) actions.showToast(`บันทึกของรางวัลแล้ว แต่จัดการรูปไม่สำเร็จ: ${err.message} (เปิดฟอร์มแก้ไขเพื่ออัปโหลดรูปอีกครั้ง)`, 6000)
        }
      }
      pagedRewards.refetch()
    } finally {
      setSavingReward(false)
    }
  }

  const rewardCosts = state.rewards.map((r) => Number(r.cost)).filter((c) => c > 0)
  const cheapestRewardCost = rewardCosts.length ? Math.min(...rewardCosts) : 0

  const duplicatePlaceQr = !!f.placeId && state.qrs.some((q) => q.placeId === f.placeId && q.id !== state.editingId)

  // An expiry already in the past is only accepted if it's the QR's existing
  // value left untouched (so an expired QR can still be edited or re-enabled).
  const originalExpiresAt = state.editingId ? (state.qrs.find((q) => q.id === state.editingId)?.expiresAt || '') : ''
  const expiryInPast = !!f.expiresAt && f.expiresAt !== originalExpiresAt && new Date(f.expiresAt) <= new Date()
  const qrFormError =
    !f.placeId ? 'กรุณาเลือกสถานที่'
    : duplicatePlaceQr ? 'สถานที่นี้มี QR อยู่แล้ว (ได้ 1 QR ต่อสถานที่) เลือกสถานที่อื่น หรือแก้ไข QR เดิม'
    : !isWholeInRange(f.points, 1, QR_POINTS_MAX) ? `พอยท์ต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ${QR_POINTS_MAX}`
    : expiryInPast ? 'วันและเวลาหมดอายุต้องเป็นเวลาในอนาคต'
    : (f.radiusM !== '' && f.radiusM != null && !isWholeInRange(f.radiusM, QR_RADIUS_MIN_M, QR_RADIUS_MAX_M)) ? `รัศมีต้องอยู่ระหว่าง ${QR_RADIUS_MIN_M} ถึง ${QR_RADIUS_MAX_M} เมตร`
    : ''

  const rewardFormError =
    !String(f.name ?? '').trim() ? 'กรุณากรอกชื่อของรางวัล'
    : !isWholeInRange(f.cost, 1, REWARD_COST_MAX) ? `พอยท์ที่ใช้แลกต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ${REWARD_COST_MAX}`
    : (f.stock !== '' && f.stock != null && !isWholeInRange(f.stock, 0, REWARD_COST_MAX)) ? `จำนวนคงเหลือต้องเป็นจำนวนเต็ม 0 ถึง ${REWARD_COST_MAX} (เว้นว่าง = ไม่จำกัด)`
    : ''

  const currentRewardImage =rewardPreview || (removeRewardImage ? '' : f.imageUrl || '')

  const qrSorters = {
    'placeName-asc': (a, b) => a.placeName.localeCompare(b.placeName, 'th'),
    'placeName-desc': (a, b) => b.placeName.localeCompare(a.placeName, 'th'),
    'points-desc': (a, b) => b.points - a.points,
    'points-asc': (a, b) => a.points - b.points,
  }

  const qrsView = derived.qrsView.map((q) => ({ ...q, placeName: placeNameById.get(q.placeId) || '-' }))
  const filteredQrsView = qrsView
    .filter((q) => q.placeName.toLowerCase().includes(qrQuery.trim().toLowerCase()))
    .sort(qrSorters[qrSortBy])
  const qrTotalPages = Math.max(1, Math.ceil(filteredQrsView.length / QR_PAGE_SIZE))
  const qrPageView = filteredQrsView.slice((qrPage - 1) * QR_PAGE_SIZE, qrPage * QR_PAGE_SIZE)

  const rewardsView = pagedRewards.rows.map((r) => ({
    ...r,
    onEdit: () => actions.openEditForm('reward', r),
    onDelete: async () => { await actions.deleteItem('reward', r.id); pagedRewards.refetch() },
  }))

  // `total`/`derived.qrsView` start at 0/[] before the first fetch settles --
  // without the loading check these would flash the "ยังไม่มี..." empty
  // state on every load instead of a spinner.
  const hasAnyQrs = qrsView.length > 0 || state.dataLoading
  const hasAnyRewards = pagedRewards.total > 0 || pagedRewards.loading

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>QR &amp; พอยท์สะสม</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={actions.onNewQr} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ สร้าง QR ใหม่</button>
          <button onClick={actions.onNewReward} style={{ background: '#FBC02D', color: '#1B5E20', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ เพิ่มของรางวัล</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, marginBottom: 28, maxWidth: 520 }}>
        <StatCard icon={<QrGlyph size={17} />} value={qrsView.length} label="QR ทั้งหมดในระบบ" />
        <StatCard icon={<GiftGlyph size={18} />} value={pagedRewards.total} label="ของรางวัลทั้งหมด" />
      </div>

      <Modal open={derived.isQrFormOpen} onClose={actions.cancelForm} title={state.editingId ? 'แก้ไข QR' : 'สร้าง QR ใหม่'} maxWidth={580}>
        <div style={{ background: '#FFF8E1', border: '1px solid #EFE3B8', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, lineHeight: 1.65, color: '#5f4a12' }}>
          <b>เงื่อนไขที่ระบบบังคับใช้กับผู้ใช้</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            <li>1 สถานที่มี QR ได้ 1 ใบ และผู้ใช้แต่ละบัญชีรับพอยท์จาก QR ใบนั้นได้ครั้งเดียว</li>
            <li>ต้องเข้าสู่ระบบ และอนุญาตตำแหน่ง จึงสแกนได้ (ถ้าสถานที่มีพิกัด)</li>
            <li>ต้องอยู่ในรัศมีที่ตั้งไว้ด้านล่าง เกินรัศมีจะไม่ได้พอยท์</li>
            <li>QR ที่ปิดใช้งานหรือหมดอายุจะสแกนไม่ได้ และจะไม่แสดงในหน้าพอยท์ของผู้ใช้</li>
            <li>พอยท์ที่ผู้ใช้ได้มาจากค่าใน QR นี้เท่านั้น ไม่ใช่ค่า "พอยท์ QR" ในแท็บสถานที่</li>
          </ul>
        </div>
        <Field label="สถานที่ที่ผูกกับ QR นี้">
          <div style={{ marginBottom: 14 }}>
            <PlacePicker value={f.placeId} onChange={(id) => actions.updateFormField('placeId', id)} />
          </div>
        </Field>
        <Field label="จำนวนพอยท์ที่ได้รับเมื่อสแกน">
          <PointsPicker
            value={f.points}
            onChange={(v) => actions.updateFormField('points', v)}
            presets={QR_POINT_PRESETS}
            hint={cheapestRewardCost && Number(f.points) > 0 ? `ของรางวัลที่ถูกที่สุดใช้ ${cheapestRewardCost} พอยท์ ต้องสแกนประมาณ ${Math.ceil(cheapestRewardCost / Number(f.points))} จุดถึงจะแลกได้` : ''}
          />
        </Field>
        <Field label="วันและเวลาหมดอายุ (เว้นว่าง = ไม่หมดอายุ)">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <input type="datetime-local" value={isoToLocalInput(f.expiresAt)} onChange={(e) => actions.updateFormField('expiresAt', localInputToIso(e.target.value))} style={{ flex: 1, border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            {f.expiresAt && <button type="button" onClick={() => actions.updateFormField('expiresAt', '')} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ล้าง</button>}
          </div>
        </Field>
        <Field label="รัศมีที่สแกนได้ (เมตร)">
          <input value={f.radiusM ?? ''} onChange={(e) => actions.updateFormField('radiusM', e.target.value.replace(/\D/g, ''))} placeholder="200" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
          <div style={{ fontSize: 12, color: '#626863', margin: '4px 0 10px' }}>ผู้สแกนต้องอยู่ในรัศมีนี้จากพิกัดสถานที่ ({QR_RADIUS_MIN_M}–{QR_RADIUS_MAX_M} เมตร เว้นว่าง = 200) สถานที่ที่ไม่มีพิกัดจะไม่เช็คระยะ</div>
          <div style={{ marginBottom: 14 }}>
            {!f.placeId ? (
              <div style={{ fontSize: 12.5, color: '#626863' }}>เลือกสถานที่เพื่อดูรัศมีบนแผนที่</div>
            ) : formPlaceLocation === undefined ? (
              <LoadingSpinner size={24} label="กำลังโหลดพิกัด..." />
            ) : formPlaceLocation === 'error' ? (
              <div style={{ fontSize: 12.5, color: '#a33232' }}>โหลดพิกัดสถานที่ไม่สำเร็จ ลองเลือกสถานที่อีกครั้ง</div>
            ) : formPlaceLocation === null ? (
              <div style={{ fontSize: 12.5, color: '#a33232' }}>สถานที่นี้ยังไม่มีพิกัด จึงแสดงรัศมีบนแผนที่ไม่ได้ (เพิ่มพิกัดได้ที่แท็บสถานที่)</div>
            ) : (
              <RadiusMap center={formPlaceLocation} radiusM={f.radiusM} />
            )}
          </div>
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, marginBottom: 18, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.isActive !== false} onChange={(e) => actions.updateFormField('isActive', e.target.checked)} />
          เปิดใช้งาน QR นี้
        </label>
        {qrFormError && <div style={{ fontSize: 12.5, color: '#a33232', marginBottom: 12 }}>{qrFormError}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleSaveQr} disabled={!!qrFormError || savingQr} style={{ background: qrFormError || savingQr ? '#A5D6A7' : 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: qrFormError || savingQr ? 'default' : 'pointer' }}>{savingQr ? 'กำลังบันทึก...' : 'บันทึก'}</button>
          <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
        </div>
      </Modal>

      <Modal open={derived.isRewardFormOpen} onClose={actions.cancelForm} title={state.editingId ? 'แก้ไขของรางวัล' : 'เพิ่มของรางวัลใหม่'} maxWidth={480}>
        <Field label="รูปของรางวัล">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
            <ImageSlot src={currentRewardImage} radius={12} placeholder="ยังไม่มีรูป" icon={REWARD_ICON} style={{ width: 96, height: 96 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <label style={{ background: '#E8F5E9', color: '#2E7D32', padding: '7px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  {currentRewardImage ? 'เปลี่ยนรูป' : 'เลือกรูป'}
                  <input type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} onChange={handlePickRewardImage} style={{ display: 'none' }} />
                </label>
                {currentRewardImage && (
                  <button type="button" onClick={handleRemoveRewardImage} style={{ background: '#fdecec', color: '#a33232', border: 'none', padding: '7px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบรูป</button>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#626863' }}>jpg, png, webp, gif ขนาดไม่เกิน 2MB</div>
              {rewardImageError && <div style={{ fontSize: 12.5, color: '#a33232', marginTop: 4 }}>{rewardImageError}</div>}
            </div>
          </div>
        </Field>
        <Field label="ชื่อของรางวัล">
          <input value={f.name || ''} onChange={actions.onField_name} placeholder="เช่น ส่วนลด 50 บาท" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
        </Field>
        <Field label="พอยท์ที่ใช้แลก">
          <PointsPicker value={f.cost} onChange={(v) => actions.updateFormField('cost', v)} presets={REWARD_COST_PRESETS} />
        </Field>
        <Field label="จำนวนของรางวัลที่เหลือ (เว้นว่าง = ไม่จำกัด)">
          <input value={f.stock ?? ''} onChange={(e) => actions.updateFormField('stock', e.target.value.replace(/D/g, ''))} inputMode="numeric" placeholder="เช่น 20" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
          <div style={{ fontSize: 12, color: '#626863', margin: '4px 0 14px' }}>ลดลงเองทุกครั้งที่แลกที่เคาน์เตอร์ และคืนให้เมื่อยกเลิกรายการแลก ใส่ 0 = ของหมด</div>
        </Field>
        {rewardFormError && <div style={{ fontSize: 12.5, color: '#a33232', marginBottom: 12 }}>{rewardFormError}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleSaveReward} disabled={savingReward || !!rewardFormError} style={{ background: savingReward || rewardFormError ? '#A5D6A7' : 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: savingReward || rewardFormError ? 'default' : 'pointer' }}>{savingReward ? 'กำลังบันทึก...' : 'บันทึก'}</button>
          <button onClick={actions.cancelForm} disabled={savingReward} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: savingReward ? 'default' : 'pointer' }}>ยกเลิก</button>
        </div>
      </Modal>

      <Modal open={!!previewQr} onClose={() => setPreviewQr(null)} title={previewQr ? `QR Code: ${previewQr.placeName}` : ''} maxWidth={380}>
        {previewQr && (
          <div style={{ textAlign: 'center' }}>
            <QRCodeCanvas id={PREVIEW_CANVAS_ID} value={qrValue(previewQr)} size={200} includeMargin />
            <div style={{ fontSize: 12.5, color: '#7A5205', fontWeight: 700, margin: '12px 0 16px' }}>สแกนรับ {previewQr.points} พอยท์</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => downloadQrPng(PREVIEW_CANVAS_ID, `qr-${previewQr.placeName}.png`)} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 9, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>ดาวน์โหลด PNG</button>
              <button onClick={() => setPrintQr(previewQr)} style={{ flex: 1, background: '#FFF8E1', color: '#7A5205', border: 'none', padding: 9, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>พิมพ์ป้าย</button>
            </div>
          </div>
        )}
      </Modal>

      {printQr && (
        <div id="qr-print-label" style={{ display: 'none' }}>
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #qr-print-label, #qr-print-label * { visibility: visible; }
              #qr-print-label {
                display: flex !important;
                position: fixed; inset: 0;
                flex-direction: column; align-items: center; justify-content: center;
                padding: 40px;
              }
            }
          `}</style>
          <QRCodeCanvas id={PRINT_CANVAS_ID} value={qrValue(printQr)} size={280} includeMargin />
          <div style={{ marginTop: 20, fontSize: 22, fontWeight: 800, color: '#1B5E20', textAlign: 'center' }}>{printQr.placeName}</div>
          <div style={{ marginTop: 8, fontSize: 16, color: '#7A5205', fontWeight: 700 }}>สแกนรับ {printQr.points} พอยท์</div>
        </div>
      )}

      <SectionHeader icon={<QrGlyph />} title="รายการ QR Code" count={qrsView.length} />
      {state.dataLoadError && qrsView.length === 0 ? (
        <div style={{ marginBottom: 28 }}><LoadError message="โหลดรายการ QR ไม่สำเร็จ" onRetry={actions.reloadData} /></div>
      ) : hasAnyQrs ? (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <input value={qrQuery} onChange={(e) => setQrQuery(e.target.value)} placeholder="ค้นหา QR ตามชื่อสถานที่..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
            <select value={qrSortBy} onChange={(e) => setQrSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
              <option value="placeName-asc">ชื่อสถานที่ (ก-ฮ)</option>
              <option value="placeName-desc">ชื่อสถานที่ (ฮ-ก)</option>
              <option value="points-desc">พอยท์มาก-น้อย</option>
              <option value="points-asc">พอยท์น้อย-มาก</option>
            </select>
            <span style={{ fontSize: 12.5, color: '#626863' }}>พบ {filteredQrsView.length} รายการ</span>
            {placeNamesError && (
              <span style={{ fontSize: 12.5, color: '#a33232' }}>
                โหลดชื่อสถานที่ไม่สำเร็จ{' '}
                <button type="button" onClick={loadPlaceNames} style={{ background: 'none', border: 'none', color: '#a33232', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>ลองใหม่</button>
              </span>
            )}
            {qrStatsError && (
              <span style={{ fontSize: 12.5, color: '#a33232' }}>
                โหลดสถิติการสแกนไม่สำเร็จ{' '}
                <button type="button" onClick={loadQrStats} style={{ background: 'none', border: 'none', color: '#a33232', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>ลองใหม่</button>
              </span>
            )}
          </div>
          {filteredQrsView.length === 0 ? (
            state.dataLoading
              ? <LoadingSpinner size={32} label="กำลังโหลด QR..." />
              : <div style={{ textAlign: 'center', padding: 28, color: '#626863', fontSize: 13.5, marginBottom: 28 }}>ไม่พบ QR ที่ตรงกับ "{qrQuery}"</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16, marginBottom: 28 }}>
                {qrPageView.map((q) => {
                  const status = qrStatus(q)
                  const stat = qrStats.get(q.id)
                  return (
                  <div key={q.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 16, opacity: q.isActive ? 1 : 0.75 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <IconBadge><QrGlyph /></IconBadge>
                      <span style={{ fontSize: 11.5, fontWeight: 700, background: status.bg, color: status.color, padding: '3px 10px', borderRadius: 20 }}>{status.label}</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, margin: '12px 0 3px' }}>{q.placeName}</div>
                    <div style={{ fontSize: 12.5, color: '#7A5205', fontWeight: 700, marginBottom: 6 }}>+{q.points} พอยท์</div>
                    <div style={{ fontSize: 12, color: '#5f6a63', lineHeight: 1.6, marginBottom: 12 }}>
                      <div>{qrStatsError ? 'สแกนแล้ว - ครั้ง · แจก - พอยท์' : `สแกนแล้ว ${stat?.scans ?? 0} ครั้ง · แจก ${stat?.pointsTotal ?? 0} พอยท์`}</div>
                      <div>{q.expiresAt ? `หมดอายุ ${formatDateTime(q.expiresAt)}` : 'ไม่มีวันหมดอายุ'}</div>
                      <div>รัศมี {q.radiusM ?? 200} เมตร</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <button onClick={q.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
                      <button onClick={q.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setPreviewQr(q)} style={{ flex: 1, background: '#fff', color: '#5f6a63', border: '1px solid #DCD8C6', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ดู QR Code</button>
                      <button onClick={() => handleToggleQr(q)} disabled={togglingQrId === q.id} style={{ flex: 1, background: '#fff', color: q.isActive ? '#a33232' : '#2E7D32', border: `1px solid ${q.isActive ? '#e6b8b8' : '#A5D6A7'}`, padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: togglingQrId === q.id ? 'default' : 'pointer' }}>{q.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
                    </div>
                  </div>
                  )
                })}
              </div>
              <PageControls page={qrPage} totalPages={qrTotalPages} total={filteredQrsView.length} onChange={setQrPage} />
            </>
          )}
        </>
      ) : (
        <div style={{ marginBottom: 28 }}>
          <QrEmptyState
            icon={QR_ICON}
            title="ยังไม่มี QR Code ในระบบ"
            desc="สร้าง QR แรกแล้วผูกกับสถานที่ท่องเที่ยว เพื่อพิมพ์ไปแปะให้นักท่องเที่ยวสแกนรับพอยท์"
            actionLabel="+ สร้าง QR ใหม่"
            onAction={actions.onNewQr}
            buttonStyle={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff' }}
          />
        </div>
      )}

      <SectionHeader icon={<GiftGlyph />} title="ของรางวัลที่แลกได้" count={pagedRewards.total} />
      {pagedRewards.error ? (
        <LoadError message="โหลดรายการของรางวัลไม่สำเร็จ" onRetry={pagedRewards.refetch} />
      ) : hasAnyRewards ? (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <input value={pagedRewards.query} onChange={(e) => pagedRewards.setQuery(e.target.value)} placeholder="ค้นหาของรางวัล..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
            <select value={rewardSortBy} onChange={(e) => setRewardSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
              <option value="name-asc">ชื่อ (ก-ฮ)</option>
              <option value="name-desc">ชื่อ (ฮ-ก)</option>
              <option value="cost-desc">พอยท์มาก-น้อย</option>
              <option value="cost-asc">พอยท์น้อย-มาก</option>
            </select>
            <span style={{ fontSize: 12.5, color: '#626863' }}>{pagedRewards.loading ? 'กำลังโหลด...' : `พบ ${pagedRewards.total} รายการ`}</span>
          </div>
          {rewardsView.length === 0 ? (
            pagedRewards.loading
              ? <LoadingSpinner size={32} label="กำลังโหลดของรางวัล..." />
              : <div style={{ textAlign: 'center', padding: 28, color: '#626863', fontSize: 13.5 }}>ไม่พบของรางวัลที่ตรงกับ "{pagedRewards.query}"</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16, opacity: pagedRewards.loading ? 0.5 : 1, transition: 'opacity 0.15s ease', pointerEvents: pagedRewards.loading ? 'none' : 'auto' }}>
                {rewardsView.map((r) => (
                  <div key={r.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 16 }}>
                    {r.imageUrl
                      ? <ImageSlot src={r.imageUrl} radius={10} placeholder={r.name} icon={REWARD_ICON} style={{ width: '100%', height: 120 }} />
                      : <IconBadge><GiftGlyph /></IconBadge>}
                    <div style={{ fontWeight: 700, fontSize: 14, margin: '12px 0 3px' }}>{r.name}</div>
                    <div style={{ fontSize: 12.5, color: '#5f6a63', marginBottom: 4 }}>{r.cost} พอยท์</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12, color: r.stock === 0 ? '#a33232' : '#5f6a63' }}>{r.stock == null ? 'ไม่จำกัดจำนวน' : r.stock === 0 ? 'ของหมด' : `เหลือ ${r.stock} ชิ้น`}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={r.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
                      <button onClick={r.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
                    </div>
                  </div>
                ))}
              </div>
              <PageControls page={pagedRewards.page} totalPages={pagedRewards.totalPages} total={pagedRewards.total} onChange={pagedRewards.setPage} />
            </>
          )}
        </>
      ) : (
        <QrEmptyState
          icon={REWARD_ICON}
          title="ยังไม่มีของรางวัลในระบบ"
          desc="เพิ่มของรางวัลอย่างน้อย 1 ชิ้น เพื่อให้นักท่องเที่ยวมีของให้แลกด้วยพอยท์ที่สะสมได้"
          actionLabel="+ เพิ่มของรางวัล"
          onAction={actions.onNewReward}
          buttonStyle={{ background: '#FBC02D', color: '#1B5E20' }}
        />
      )}
    </>
  )
}
