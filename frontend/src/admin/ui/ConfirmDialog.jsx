import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../../components/Modal.jsx'
import Button from './Button.jsx'

// Admin confirmation dialog + a Promise-returning hook.
//
//   const { confirm, confirmDialog } = useConfirm()
//   ...
//   const res = await confirm({ title, message, confirmLabel, danger: true, reason: 'required' })
//   if (!res) return            // cancelled
//   res.reason                  // trimmed text from the reason field ('' when none)
//   return <>{...}{confirmDialog}</>
//
// Options:
//   title, message (node), confirmLabel ('ยืนยัน'), cancelLabel ('ยกเลิก'), danger (false)
//   reason: 'none' (default) | 'optional' | 'required';  reasonLabel, reasonPlaceholder
//   run: async ({ reason }) => result  -- optional. When given, the dialog stays open with a busy
//        button while it runs; a thrown error is shown inside the dialog (set err.silent = true to
//        show nothing) and the dialog stays open for a retry. The promise resolves with
//        { reason, result } after success.
// Resolves to false when cancelled (Esc, backdrop, or the cancel button).

const messageOf = (err) => (err?.status === undefined ?'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)

function ConfirmDialog({ options, onResolve }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const open = !!options
  const reasonMode = options?.reason || 'none'

  // Fresh state every time a new confirmation opens.
  useEffect(() => {
    if (open) { setReason(''); setBusy(false); setError('') }
  }, [options])

  if (!options) return null
  const needsReason = reasonMode === 'required' && !reason.trim()

  const cancel = () => { if (!busy) onResolve(false) }
  const submit = async () => {
    const trimmed = reason.trim()
    if (!options.run) { onResolve({ reason: trimmed }); return }
    setBusy(true)
    setError('')
    try {
      const result = await options.run({ reason: trimmed })
      onResolve({ reason: trimmed, result })
    } catch (err) {
      if (!err?.silent) setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={cancel}
      title={options.title}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={cancel} disabled={busy}>{options.cancelLabel || 'ยกเลิก'}</Button>
          <Button variant={options.danger ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={needsReason}>{options.confirmLabel || 'ยืนยัน'}</Button>
        </>
      )}
    >
      {options.message && <div className="ad-confirm__msg">{options.message}</div>}
      {reasonMode !== 'none' && (
        <label className="ad-confirm__reason">
          <span className="ad-confirm__reason-label">{options.reasonLabel || (reasonMode === 'required' ? 'เหตุผล' : 'เหตุผล (ไม่บังคับ)')}</span>
          <textarea
            className="ad-textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={options.reasonPlaceholder}
            disabled={busy}
          />
        </label>
      )}
      {error && <div className="ad-confirm__error" role="alert">{error}</div>}
    </Modal>
  )
}

export function useConfirm() {
  const [options, setOptions] = useState(null)
  const resolverRef = useRef(null)

  const confirm = useCallback((opts) => new Promise((resolve) => {
    // A second request while one is open cancels the first.
    resolverRef.current?.(false)
    resolverRef.current = resolve
    setOptions({ ...opts })
  }), [])

  const handleResolve = useCallback((value) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setOptions(null)
    resolve?.(value)
  }, [])

  // Don't leave a caller awaiting forever if the tab unmounts with the dialog open.
  useEffect(() => () => { resolverRef.current?.(false); resolverRef.current = null }, [])

  const confirmDialog = <ConfirmDialog options={options} onResolve={handleResolve} />
  return { confirm, confirmDialog }
}

export default ConfirmDialog
