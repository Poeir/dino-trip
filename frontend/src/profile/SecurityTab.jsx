import { Check, Circle } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Field from '../components/Field.jsx'
import Modal from '../components/Modal.jsx'
import { changePassword, requestEmailChange, cancelEmailChangeRequest, deleteMyAccount } from '../lib/apiClient.js'
import { Card, Notice, inputStyle, primaryBtn, ghostBtn, dangerBtn } from './ui.jsx'

// Same rules the server enforces (userValidation.js PASSWORD_RULES).
const RULES = [
  { label: 'อย่างน้อย 8 ตัวอักษร', test: (p) => p.length >= 8 },
  { label: 'มีตัวพิมพ์ใหญ่ (A-Z)', test: (p) => /[A-Z]/.test(p) },
  { label: 'มีตัวพิมพ์เล็ก (a-z)', test: (p) => /[a-z]/.test(p) },
  { label: 'มีตัวเลข (0-9)', test: (p) => /[0-9]/.test(p) },
]

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const strong = RULES.every((r) => r.test(next))
  const matches = next === confirm
  const canSubmit = current && strong && matches && !busy

  const submit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true); setError(''); setDone(false)
    try {
      await changePassword(current, next)
      setCurrent(''); setNext(''); setConfirm(''); setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="เปลี่ยนรหัสผ่าน" subtitle="เมื่อเปลี่ยนแล้ว อุปกรณ์อื่นที่เข้าสู่ระบบอยู่จะถูกออกจากระบบ">
      <form onSubmit={submit} style={{ display: 'grid', gap: 14, maxWidth: 420 }}>
        <Field label="รหัสผ่านปัจจุบัน" required><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} style={inputStyle} /></Field>
        <Field label="รหัสผ่านใหม่" required><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} style={inputStyle} /></Field>
        <ul style={{ listStyle: 'none', margin: '-6px 0 0', padding: 0, fontSize: 12 }}>
          {RULES.map((r) => <li key={r.label} style={{ color: r.test(next) ? '#2E7D32' : '#626863' }}>{r.test(next) ? <Check size={13} strokeWidth={3} style={{ verticalAlign: '-2px' }} /> : <Circle size={13} strokeWidth={2.4} style={{ verticalAlign: '-2px' }} />} {r.label}</li>)}
        </ul>
        <Field label="ยืนยันรหัสผ่านใหม่" required error={confirm && !matches ? 'รหัสผ่านไม่ตรงกัน' : undefined}>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputStyle} />
        </Field>
        <Notice>{error}</Notice>
        <Notice kind="success">{done && 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว'}</Notice>
        <div><button type="submit" disabled={!canSubmit} style={primaryBtn(!canSubmit)}>{busy ? 'กำลังบันทึก...' : 'เปลี่ยนรหัสผ่าน'}</button></div>
      </form>
    </Card>
  )
}

function EmailCard({ profile, onPendingChange }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const { pendingEmail } = await requestEmailChange(email.trim(), password)
      onPendingChange(pendingEmail)
      setOpen(false); setEmail(''); setPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const cancel = async () => {
    setBusy(true); setError('')
    try { await cancelEmailChangeRequest(); onPendingChange(null) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Card title="อีเมล" subtitle="อีเมลใช้สำหรับเข้าสู่ระบบและรับข่าวสารจากระบบ">
      <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1f2a24', wordBreak: 'break-all' }}>{profile.email}</div>
      {profile.pendingEmail && (
        <div style={{ background: '#FFF8E1', border: '1px solid #F0DDA0', borderRadius: 10, padding: '10px 12px', margin: '12px 0', fontSize: 13, color: '#7A5205' }}>
          รอการยืนยันอีเมลใหม่: <b style={{ wordBreak: 'break-all' }}>{profile.pendingEmail}</b><br />
          เราส่งลิงก์ยืนยันไปที่อีเมลนั้นแล้ว (หมดอายุใน 24 ชั่วโมง) อีเมลสำหรับเข้าสู่ระบบจะยังเป็นอีเมลเดิมจนกว่าจะยืนยัน
          <div style={{ marginTop: 8 }}><button type="button" onClick={cancel} disabled={busy} style={{ ...ghostBtn, padding: '6px 14px', fontSize: 12.5 }}>ยกเลิกคำขอ</button></div>
        </div>
      )}
      {!open ? (
        <div style={{ marginTop: 12 }}><button type="button" onClick={() => setOpen(true)} style={ghostBtn}>เปลี่ยนอีเมล</button></div>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 14, maxWidth: 420, marginTop: 14 }}>
          <Field label="อีเมลใหม่" required><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} /></Field>
          <Field label="รหัสผ่านปัจจุบัน (เพื่อยืนยันตัวตน)" required><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} /></Field>
          <Notice>{error}</Notice>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={!email || !password || busy} style={primaryBtn(!email || !password || busy)}>{busy ? 'กำลังส่ง...' : 'ส่งลิงก์ยืนยัน'}</button>
            <button type="button" onClick={() => { setOpen(false); setError('') }} style={ghostBtn}>ยกเลิก</button>
          </div>
        </form>
      )}
    </Card>
  )
}

function DeleteCard() {
  const { actions } = useApp()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const close = () => { if (!busy) { setOpen(false); setPassword(''); setError('') } }
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await deleteMyAccount(password)
      actions.signedOutLocally()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Card title="ลบบัญชี" danger subtitle="บัญชีของคุณจะถูกปิดและเข้าสู่ระบบไม่ได้อีก ประวัติพอยท์ยังถูกเก็บไว้ และอีเมลนี้จะไม่สามารถนำไปสมัครใหม่ได้ หากต้องการกู้คืนบัญชีต้องติดต่อผู้ดูแลระบบ">
      <button type="button" onClick={() => setOpen(true)} style={dangerBtn(false)}>ลบบัญชีของฉัน</button>
      <Modal open={open} onClose={close} title="ยืนยันการลบบัญชี" maxWidth={400}>
        <form onSubmit={submit}>
          <p style={{ margin: '0 0 14px', fontSize: 13.5, color: '#4a544d', lineHeight: 1.7 }}>พอยท์ที่เหลือจะไม่สามารถนำไปแลกรางวัลได้อีก กรอกรหัสผ่านเพื่อยืนยันการลบบัญชี</p>
          <Field label="รหัสผ่าน" required><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoFocus /></Field>
          <Notice>{error}</Notice>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" onClick={close} disabled={busy} style={ghostBtn}>ยกเลิก</button>
            <button type="submit" disabled={!password || busy} style={dangerBtn(!password || busy)}>{busy ? 'กำลังลบ...' : 'ลบบัญชี'}</button>
          </div>
        </form>
      </Modal>
    </Card>
  )
}

export default function SecurityTab({ profile, onPendingChange }) {
  return (
    <>
      <EmailCard profile={profile} onPendingChange={onPendingChange} />
      <PasswordCard />
      <DeleteCard />
    </>
  )
}
