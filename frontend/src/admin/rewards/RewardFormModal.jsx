import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import Modal from '../../components/Modal.jsx'
import Field from '../../components/Field.jsx'
import ImageSlot from '../../components/ImageSlot.jsx'
import { REWARD_ICON } from '../../data/categoryImages.js'
import { uploadRewardImage, deleteRewardImage } from '../../lib/apiClient.js'
import { useDirtyGuard } from '../hooks/useDirtyGuard.js'
import Button from '../ui/Button.jsx'
import { FormActions } from '../ui/FormSection.jsx'
import PointsPicker from '../ui/PointsPicker.jsx'

// Kept in step with backend/src/lib/mappers.js's rewardPayload limits.
const REWARD_COST_MAX = 1000000
const REWARD_COST_PRESETS = [50, 100, 200, 500]
const MAX_REWARD_IMAGE_BYTES = 2 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const isWholeInRange = (v, min, max) => /^\d+$/.test(String(v ?? '').trim()) && Number(v) >= min && Number(v) <= max

// `onSaved` runs after the reward (and any image change) is saved -- the tab refetches its list.
export default function RewardFormModal({ onSaved }) {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const open = derived.isRewardFormOpen
  const guard = useDirtyGuard({ open, value: f })
  const [saving, setSaving] = useState(false)

  // The image is picked locally and only uploaded after the reward row is saved -- a brand-new
  // reward has no id to upload against until then.
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [removeImage, setRemoveImage] = useState(false)
  const [imageError, setImageError] = useState('')

  useEffect(() => {
    if (preview) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview('')
    setRemoveImage(false)
    setImageError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state.editingId])

  const handlePick = (e) => {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    if (!ACCEPTED_IMAGE_TYPES.includes(picked.type)) { setImageError('รองรับเฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)'); return }
    if (picked.size > MAX_REWARD_IMAGE_BYTES) { setImageError('ไฟล์ใหญ่เกินไป (จำกัด 2MB)'); return }
    setImageError('')
    if (preview) URL.revokeObjectURL(preview)
    setFile(picked)
    setPreview(URL.createObjectURL(picked))
    setRemoveImage(false)
  }

  const handleRemove = () => {
    if (preview) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview('')
    setRemoveImage(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const wasEditing = !!state.editingId
      const item = await actions.saveForm()
      if (item) {
        try {
          let updated = null
          if (file) updated = await uploadRewardImage(item.id, file)
          else if (removeImage && wasEditing) updated = await deleteRewardImage(item.id)
          if (updated) actions.applyRewardUpdate(updated)
        } catch (err) {
          if (!actions.handleSessionExpired(err)) actions.showToast(`บันทึกของรางวัลแล้ว แต่จัดการรูปไม่สำเร็จ: ${err.message} (เปิดฟอร์มแก้ไขเพื่ออัปโหลดรูปอีกครั้ง)`, 6000, 'error')
        }
      }
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }
  const handleClose = () => { if (!saving) guard.requestClose(actions.cancelForm) }

  const formError =
    !String(f.name ?? '').trim() ? 'กรุณากรอกชื่อของรางวัล'
    : !isWholeInRange(f.cost, 1, REWARD_COST_MAX) ? `พอยท์ที่ใช้แลกต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ${REWARD_COST_MAX}`
    : (f.stock !== '' && f.stock != null && !isWholeInRange(f.stock, 0, REWARD_COST_MAX)) ? `จำนวนคงเหลือต้องเป็นจำนวนเต็ม 0 ถึง ${REWARD_COST_MAX} (เว้นว่าง = ไม่จำกัด)`
    : ''
  const currentImage = preview || (removeImage ? '' : f.imageUrl || '')

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={state.editingId ? 'แก้ไขของรางวัล' : 'เพิ่มของรางวัลใหม่'}
        size="sm"
        footer={<FormActions onSave={handleSave} onCancel={handleClose} saving={saving} disabled={!!formError} error={formError} />}
      >
        <div className="ad-form-stack">
          <Field label="รูปของรางวัล">
            <div className="ad-img-pick">
              <div className="ad-img-pick__slot">
                <ImageSlot src={currentImage} radius={12} placeholder="ยังไม่มีรูป" icon={REWARD_ICON} />
              </div>
              <div className="ad-person__text">
                <div className="ad-actions ad-mb">
                  <label className="ad-btn ad-btn--soft ad-btn--sm ad-file-btn">
                    {currentImage ? 'เปลี่ยนรูป' : 'เลือกรูป'}
                    <input type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} onChange={handlePick} aria-label="เลือกไฟล์รูปของรางวัล" />
                  </label>
                  {currentImage && <Button variant="dangersoft" size="sm" onClick={handleRemove}>ลบรูป</Button>}
                </div>
                <div className="ad-card__meta">jpg, png, webp, gif ขนาดไม่เกิน 2MB</div>
                {imageError && <div className="ad-error-text" role="alert">{imageError}</div>}
              </div>
            </div>
          </Field>
          <Field label="ชื่อของรางวัล">
            <input className="ad-input" value={f.name || ''} onChange={actions.onField_name} placeholder="เช่น ส่วนลด 50 บาท" />
          </Field>
          <Field label="พอยท์ที่ใช้แลก">
            <PointsPicker label="พอยท์ที่ใช้แลก" value={f.cost} onChange={(v) => actions.updateFormField('cost', v)} presets={REWARD_COST_PRESETS} />
          </Field>
          <Field label="จำนวนของรางวัลที่เหลือ (เว้นว่าง = ไม่จำกัด)">
            <input className="ad-input" value={f.stock ?? ''} onChange={(e) => actions.updateFormField('stock', e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="เช่น 20" />
            <div className="ad-hint">ลดลงเองทุกครั้งที่แลกที่เคาน์เตอร์ และคืนให้เมื่อยกเลิกรายการแลก ใส่ 0 = ของหมด</div>
          </Field>
        </div>
      </Modal>
      {guard.dirtyDialog}
    </>
  )
}
