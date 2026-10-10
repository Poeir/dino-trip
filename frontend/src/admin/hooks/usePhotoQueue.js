import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'

const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const validatePhotoFile = (file) => {
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) return 'รองรับเฉพาะไฟล์ JPG, PNG, WEBP, GIF'
  if (file.size > MAX_PHOTO_BYTES) return `ไฟล์ใหญ่เกินไป (จำกัด ${MAX_PHOTO_BYTES / 1024 / 1024}MB)`
  return null
}

// Photo handling shared by the place and event forms.
//
// Existing = already-uploaded photos (have an id; fetched when an existing item is opened for edit).
// Pending  = picked locally but not uploaded yet -- unavoidable for a brand-new item, which has no
// id to upload against until the rest of the form is saved (see uploadPending).
//
//   open        form-open flag; the queue resets (and reloads existing photos) whenever it flips on
//   editingId   id of the item being edited (null when creating)
//   fetchPhotos(id)               -> existing photos
//   uploadPhoto(id, file)         -> the updated item
//   deletePhoto(editingId, photoId) -> anything; passed to onDeleted
//   onDeleted(result)             side effects after a delete (refetch the list etc.)
//   loadErrorLabel / entityLabel  Thai strings for error toasts ('โหลดรูปของสถานที่ไม่สำเร็จ: ', 'สถานที่')
export function usePhotoQueue({ open, editingId, fetchPhotos, uploadPhoto, deletePhoto, onDeleted, loadErrorLabel, entityLabel }) {
  const { actions } = useApp()
  const [existingPhotos, setExistingPhotos] = useState([])
  const [pendingFiles, setPendingFiles] = useState([])
  const [photoError, setPhotoError] = useState('')
  const [removingId, setRemovingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [busyText, setBusyText] = useState('')

  useEffect(() => {
    if (!open) return
    pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.previewUrl))
    setPendingFiles([])
    setPhotoError('')
    setExistingPhotos([])
    if (editingId) {
      fetchPhotos(editingId).then(setExistingPhotos).catch((err) => { setExistingPhotos([]); actions.reportError(loadErrorLabel, err) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const addFiles = (files) => {
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

  const removePending = (index) => {
    setPendingFiles((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  const removeExisting = async (photoId) => {
    setRemovingId(photoId)
    try {
      const result = await deletePhoto(editingId, photoId)
      onDeleted?.(result)
      setExistingPhotos((prev) => prev.filter((p) => p.id !== photoId))
      actions.showToast('ลบรูปแล้ว')
    } catch (err) {
      actions.reportError('ลบรูปไม่สำเร็จ: ', err)
    } finally {
      setRemovingId(null)
    }
  }

  // Uploads the pending files one after another (sequential, not Promise.all: the backend assigns
  // each photo's `position` from the current count in the DB, so parallel uploads could race and
  // land on the same position). Returns { saved, failed } where `saved` is the item as returned by
  // the last successful upload. The form stays open meanwhile so the gallery's busy state is visible.
  const uploadPending = async (saved) => {
    if (!pendingFiles.length) return { saved, failed: false }
    setBusy(true)
    let uploadedCount = 0
    let failed = false
    try {
      for (const pf of pendingFiles) {
        setBusyText(`กำลังอัปโหลดรูป ${uploadedCount + 1}/${pendingFiles.length}...`)
        saved = await uploadPhoto(saved.id, pf.file)
        uploadedCount++
      }
    } catch (err) {
      failed = true
      actions.reportError(`บันทึก${entityLabel}แล้ว แต่อัปโหลดรูปสำเร็จแค่ ${uploadedCount}/${pendingFiles.length} (เปิดฟอร์มแก้ไขเพื่ออัปโหลดที่เหลือ): `, err)
    } finally {
      setBusy(false)
      setBusyText('')
    }
    return { saved, failed }
  }

  const galleryProps = {
    existingPhotos,
    pendingFiles,
    onAddFiles: addFiles,
    onRemoveExisting: removeExisting,
    onRemovePending: removePending,
    removingId,
    busy,
    busyText,
  }

  return { galleryProps, photoError, pendingCount: pendingFiles.length, uploadPending }
}
