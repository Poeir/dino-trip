import { useState } from 'react'
import Modal from '../../components/Modal.jsx'
import { useApp } from '../../context/AppContext.jsx'
import {
  suspendUser, unsuspendUser, deleteUser, restoreUser,
  adjustUserPoints, revokeUserSessions, resendUserVerification,
} from '../../lib/apiClient.js'
import Button from '../ui/Button.jsx'
import { useConfirm } from '../ui/ConfirmDialog.jsx'

const POINTS_DELTA_MAX = 100000

const messageOf = (err) => (err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)

// Manual points adjustment: needs a signed number plus a required reason, so it can't use the
// plain confirm dialog.
function PointsDialog({ user, onSubmit, onClose }) {
  const [reason, setReason] = useState('')
  const [delta, setDelta] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const deltaNum = Number(delta)
  const deltaValid = /^[+-]?\d+$/.test(delta.trim()) && deltaNum !== 0 && Math.abs(deltaNum) <= POINTS_DELTA_MAX
  const newBalance = deltaValid ? user.pointsBalance + deltaNum : null
  const invalid = !reason.trim() || !deltaValid || newBalance < 0
  const hint =
    delta.trim() && !deltaValid ? `ใส่จำนวนเต็มที่ไม่ใช่ 0 และไม่เกิน ${POINTS_DELTA_MAX} เช่น 50 หรือ -20`
    : deltaValid && newBalance < 0 ? 'พอยท์ของผู้ใช้ไม่พอให้หัก'
    : ''

  const close = () => { if (!busy) onClose() }
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await onSubmit({ delta: deltaNum, reason: reason.trim() })
    } catch (err) {
      if (!err?.silent) setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title="ปรับพอยท์"
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>ยกเลิก</Button>
          <Button onClick={submit} loading={busy} disabled={invalid}>บันทึกการปรับพอยท์</Button>
        </>
      )}
    >
      <div className="ad-confirm__msg">ปรับพอยท์ของ {user.displayName} ด้วยมือ ทุกครั้งจะบันทึกไว้เป็นประวัติพร้อมเหตุผล</div>
      <label className="ad-field">
        <span className="ad-field__label">จำนวนพอยท์ที่เพิ่ม (+) หรือหัก (-)</span>
        <input className="ad-input" value={delta} onChange={(e) => setDelta(e.target.value)} inputMode="numeric" placeholder="เช่น 50 หรือ -20" autoFocus />
        <div className={`ad-field__hint${hint ? ' is-error' : ''}`}>
          {hint || (newBalance !== null ? `ยอดปัจจุบัน ${user.pointsBalance} → หลังปรับ ${newBalance} พอยท์` : `ยอดปัจจุบัน ${user.pointsBalance} พอยท์`)}
        </div>
      </label>
      <label className="ad-field">
        <span className="ad-field__label">เหตุผล</span>
        <textarea className="ad-textarea" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
      </label>
      {error && <div className="ad-confirm__error" role="alert">{error}</div>}
    </Modal>
  )
}

// Every account action goes through ConfirmDialog (useConfirm), except points. `onDone` runs after a
// successful call (refresh the open detail + the list behind it).
export function useUserActions({ user, onDone }) {
  const { actions } = useApp()
  const { confirm, confirmDialog } = useConfirm()
  const [pointsOpen, setPointsOpen] = useState(false)

  // The API answers every account change with the updated user.
  const exec = async (call, successMessage) => {
    try {
      await call()
    } catch (err) {
      if (actions.handleSessionExpired(err)) err.silent = true
      throw err
    }
    actions.showToast(successMessage)
    await onDone()
  }

  const name = user?.displayName || ''
  const defs = user && {
    suspend: { title: 'ระงับบัญชี', danger: true, confirmLabel: 'ระงับบัญชี', reason: 'required',
      message: `${name} จะเข้าสู่ระบบและสแกน QR ไม่ได้ทันที และถูกออกจากระบบทุกอุปกรณ์ ข้อมูลและพอยท์ยังอยู่ครบ เปิดใช้งานกลับได้ภายหลัง`,
      call: ({ reason }) => exec(() => suspendUser(user.id, reason), 'ระงับบัญชีแล้ว') },
    unsuspend: { title: 'เปิดใช้งานบัญชี', confirmLabel: 'เปิดใช้งาน',
      message: `${name} จะกลับมาเข้าสู่ระบบและสแกน QR ได้ตามปกติ`,
      call: () => exec(() => unsuspendUser(user.id), 'เปิดใช้งานบัญชีแล้ว') },
    delete: { title: 'ลบบัญชี', danger: true, confirmLabel: 'ลบบัญชี', reason: 'optional',
      message: `บัญชีของ ${name} จะถูกซ่อนและเข้าสู่ระบบไม่ได้ แต่ข้อมูล ประวัติสแกนและการแลกยังเก็บไว้ อีเมลนี้จะถูกสงวนไว้ (สมัครใหม่ด้วยอีเมลเดิมไม่ได้) และกู้คืนบัญชีได้ภายหลัง`,
      call: ({ reason }) => exec(() => deleteUser(user.id, reason), 'ลบบัญชีแล้ว') },
    restore: { title: 'กู้คืนบัญชี', confirmLabel: 'กู้คืนบัญชี',
      message: `${name} จะกลับมาอยู่ในรายชื่อและเข้าสู่ระบบได้อีกครั้ง (ถ้าบัญชีเคยถูกระงับไว้ จะยังคงถูกระงับ)`,
      call: () => exec(() => restoreUser(user.id), 'กู้คืนบัญชีแล้ว') },
    revoke: { title: 'ออกจากระบบทุกอุปกรณ์', confirmLabel: 'ออกจากระบบทุกอุปกรณ์',
      message: `${name} จะถูกออกจากระบบในทุกอุปกรณ์ และต้องเข้าสู่ระบบใหม่`,
      call: () => exec(() => revokeUserSessions(user.id), 'ออกจากระบบทุกอุปกรณ์แล้ว') },
    resend: { title: 'ส่งอีเมลยืนยันใหม่', confirmLabel: 'ส่งอีเมล',
      message: `ส่งลิงก์ยืนยันอีเมลใหม่ไปที่ ${user.email}`,
      call: () => exec(() => resendUserVerification(user.id), 'ส่งอีเมลยืนยันแล้ว') },
  }

  const openAction = (key) => {
    if (key === 'points') { setPointsOpen(true); return }
    const { call, ...options } = defs[key]
    confirm({ ...options, run: call })
  }

  const dialogs = (
    <>
      {confirmDialog}
      {pointsOpen && user && (
        <PointsDialog
          user={user}
          onClose={() => setPointsOpen(false)}
          onSubmit={async ({ delta, reason }) => {
            await exec(() => adjustUserPoints(user.id, delta, reason), 'ปรับพอยท์แล้ว')
            setPointsOpen(false)
          }}
        />
      )}
    </>
  )
  return { openAction, dialogs }
}
