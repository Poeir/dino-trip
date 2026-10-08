import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import Modal from '../../components/Modal.jsx'
import Field from '../../components/Field.jsx'
import PlacePicker from '../../components/PlacePicker.jsx'
import LoadingSpinner from '../../components/LoadingSpinner.jsx'
import RadiusMap from '../../components/RadiusMap.jsx'
import { fetchPlace } from '../../lib/apiClient.js'
import { useDirtyGuard } from '../hooks/useDirtyGuard.js'
import Button from '../ui/Button.jsx'
import FormSection, { FormActions } from '../ui/FormSection.jsx'
import PointsPicker from '../ui/PointsPicker.jsx'

// Kept in step with backend/src/lib/mappers.js's qrPayload limits.
const QR_POINTS_MAX = 10000
const QR_RADIUS_MIN_M = 20
const QR_RADIUS_MAX_M = 5000
const QR_POINT_PRESETS = [5, 10, 20, 50]
const isWholeInRange = (v, min, max) => /^\d+$/.test(String(v ?? '').trim()) && Number(v) >= min && Number(v) <= max

// <input type="datetime-local"> wants local 'YYYY-MM-DDTHH:mm'; the form keeps expiresAt as a full
// ISO string (what the API stores), so convert both ways.
const pad2 = (n) => String(n).padStart(2, '0')
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
const localInputToIso = (v) => (v ? new Date(v).toISOString() : '')

export default function QrFormModal() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const open = derived.isQrFormOpen
  const [saving, setSaving] = useState(false)
  // undefined = not loaded yet, null = place has no coordinates.
  const [placeLocation, setPlaceLocation] = useState(undefined)
  const guard = useDirtyGuard({ open, value: f })

  useEffect(() => {
    if (!open || !f.placeId) { setPlaceLocation(undefined); return undefined }
    let cancelled = false
    setPlaceLocation(undefined)
    fetchPlace(f.placeId)
      .then((p) => { if (!cancelled) setPlaceLocation(p?.location || null) })
      .catch(() => { if (!cancelled) setPlaceLocation('error') })
    return () => { cancelled = true }
  }, [open, f.placeId])

  const handleSave = async () => {
    setSaving(true)
    try { await actions.saveForm() } finally { setSaving(false) }
  }
  const handleClose = () => { if (!saving) guard.requestClose(actions.cancelForm) }

  const rewardCosts = state.rewards.map((r) => Number(r.cost)).filter((c) => c > 0)
  const cheapestRewardCost = rewardCosts.length ? Math.min(...rewardCosts) : 0
  const duplicatePlaceQr = !!f.placeId && state.qrs.some((q) => q.placeId === f.placeId && q.id !== state.editingId)

  // An expiry already in the past is only accepted if it's the QR's existing value left untouched
  // (so an expired QR can still be edited or re-enabled).
  const originalExpiresAt = state.editingId ? (state.qrs.find((q) => q.id === state.editingId)?.expiresAt || '') : ''
  const expiryInPast = !!f.expiresAt && f.expiresAt !== originalExpiresAt && new Date(f.expiresAt) <= new Date()
  const formError =
    !f.placeId ? 'กรุณาเลือกสถานที่'
    : duplicatePlaceQr ? 'สถานที่นี้มี QR อยู่แล้ว (ได้ 1 QR ต่อสถานที่) เลือกสถานที่อื่น หรือแก้ไข QR เดิม'
    : !isWholeInRange(f.points, 1, QR_POINTS_MAX) ? `พอยท์ต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ${QR_POINTS_MAX}`
    : expiryInPast ? 'วันและเวลาหมดอายุต้องเป็นเวลาในอนาคต'
    : (f.radiusM !== '' && f.radiusM != null && !isWholeInRange(f.radiusM, QR_RADIUS_MIN_M, QR_RADIUS_MAX_M)) ? `รัศมีต้องอยู่ระหว่าง ${QR_RADIUS_MIN_M} ถึง ${QR_RADIUS_MAX_M} เมตร`
    : ''

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={state.editingId ? 'แก้ไข QR' : 'สร้าง QR ใหม่'}
        size="md"
        footer={<FormActions onSave={handleSave} onCancel={handleClose} saving={saving} disabled={!!formError} error={formError} />}
      >
        <div className="ad-form-stack">
          <div className="ad-info-box">
            <b>เงื่อนไขที่ระบบบังคับใช้กับผู้ใช้</b>
            <ul>
              <li>1 สถานที่มี QR ได้ 1 ใบ และผู้ใช้แต่ละบัญชีรับพอยท์จาก QR ใบนั้นได้ครั้งเดียว</li>
              <li>ต้องเข้าสู่ระบบ และอนุญาตตำแหน่ง จึงสแกนได้ (ถ้าสถานที่มีพิกัด)</li>
              <li>ต้องอยู่ในรัศมีที่ตั้งไว้ด้านล่าง เกินรัศมีจะไม่ได้พอยท์</li>
              <li>QR ที่ปิดใช้งานหรือหมดอายุจะสแกนไม่ได้ และจะไม่แสดงในหน้าพอยท์ของผู้ใช้</li>
              <li>พอยท์ที่ผู้ใช้ได้มาจากค่าใน QR นี้เท่านั้น ไม่ใช่ค่า "พอยท์ QR" ในแท็บสถานที่</li>
            </ul>
          </div>
          <Field label="สถานที่ที่ผูกกับ QR นี้">
            <PlacePicker value={f.placeId} onChange={(id) => actions.updateFormField('placeId', id)} />
          </Field>
          <FormSection title="พอยท์" first>
            <Field label="จำนวนพอยท์ที่ได้รับเมื่อสแกน">
              <PointsPicker
                label="พอยท์ต่อการสแกน"
                value={f.points}
                onChange={(v) => actions.updateFormField('points', v)}
                presets={QR_POINT_PRESETS}
                hint={cheapestRewardCost && Number(f.points) > 0 ? `ของรางวัลที่ถูกที่สุดใช้ ${cheapestRewardCost} พอยท์ ต้องสแกนประมาณ ${Math.ceil(cheapestRewardCost / Number(f.points))} จุดถึงจะแลกได้` : ''}
              />
            </Field>
          </FormSection>
          <Field label="วันและเวลาหมดอายุ (เว้นว่าง = ไม่หมดอายุ)">
            <div className="ad-row ad-row--fill">
              <input className="ad-input" type="datetime-local" value={isoToLocalInput(f.expiresAt)} onChange={(e) => actions.updateFormField('expiresAt', localInputToIso(e.target.value))} />
              {f.expiresAt && <Button variant="secondary" size="sm" onClick={() => actions.updateFormField('expiresAt', '')}>ล้าง</Button>}
            </div>
          </Field>
          <Field label="รัศมีที่สแกนได้ (เมตร)">
            <input className="ad-input" value={f.radiusM ?? ''} inputMode="numeric" onChange={(e) => actions.updateFormField('radiusM', e.target.value.replace(/\D/g, ''))} placeholder="200" />
          </Field>
          <div>
            <p className="ad-help">ผู้สแกนต้องอยู่ในรัศมีนี้จากพิกัดสถานที่ ({QR_RADIUS_MIN_M}–{QR_RADIUS_MAX_M} เมตร เว้นว่าง = 200) สถานที่ที่ไม่มีพิกัดจะไม่เช็คระยะ</p>
            <div className="ad-mt-sm">
              {!f.placeId ? (
                <div className="ad-hint">เลือกสถานที่เพื่อดูรัศมีบนแผนที่</div>
              ) : placeLocation === undefined ? (
                <LoadingSpinner size={24} label="กำลังโหลดพิกัด..." />
              ) : placeLocation === 'error' ? (
                <div className="ad-hint is-error">โหลดพิกัดสถานที่ไม่สำเร็จ ลองเลือกสถานที่อีกครั้ง</div>
              ) : placeLocation === null ? (
                <div className="ad-hint is-error">สถานที่นี้ยังไม่มีพิกัด จึงแสดงรัศมีบนแผนที่ไม่ได้ (เพิ่มพิกัดได้ที่แท็บสถานที่)</div>
              ) : (
                <RadiusMap center={placeLocation} radiusM={f.radiusM} />
              )}
            </div>
          </div>
          <label className="ad-check-lg">
            <input type="checkbox" checked={f.isActive !== false} onChange={(e) => actions.updateFormField('isActive', e.target.checked)} />
            เปิดใช้งาน QR นี้
          </label>
        </div>
      </Modal>
      {guard.dirtyDialog}
    </>
  )
}
