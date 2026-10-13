import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm } from '../ui/ConfirmDialog.jsx'

// Warns before a form modal is closed with unsaved edits.
//
//   const guard = useDirtyGuard({ open: derived.isKbFormOpen, value: state.formData })
//   <Modal onClose={() => guard.requestClose(actions.cancelForm)} ... />
//   ...
//   {guard.dirtyDialog}
//
// The snapshot of `value` is taken the moment `open` turns true (after that render, so values
// loaded by the open action are the baseline). `rebaseline()` re-snapshots after the form values
// are replaced from the server (e.g. a sync result) so that doesn't count as an edit.
export function useDirtyGuard({ open, value }) {
  const { confirm, confirmDialog } = useConfirm()
  const snapshotRef = useRef(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const [rebaseTick, setRebaseTick] = useState(0)

  useEffect(() => {
    snapshotRef.current = open ? JSON.stringify(valueRef.current) : null
  }, [open])

  useEffect(() => {
    if (rebaseTick) snapshotRef.current = JSON.stringify(valueRef.current)
  }, [rebaseTick])

  const isDirty = useCallback(() => snapshotRef.current !== null && JSON.stringify(valueRef.current) !== snapshotRef.current, [])
  const rebaseline = useCallback(() => setRebaseTick((t) => t + 1), [])

  const requestClose = useCallback(async (close) => {
    if (isDirty()) {
      const ok = await confirm({
        title: 'ปิดฟอร์มโดยไม่บันทึก?',
        message: 'มีข้อมูลที่ยังไม่ได้บันทึก หากปิดตอนนี้ข้อมูลที่แก้ไขจะหายไป',
        confirmLabel: 'ปิดโดยไม่บันทึก',
        cancelLabel: 'กลับไปแก้ไข',
        danger: true,
      })
      if (!ok) return
    }
    close()
  }, [confirm, isDirty])

  return { isDirty, rebaseline, requestClose, dirtyDialog: confirmDialog }
}
