import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { confirmEmailChange, fetchMe } from '../lib/apiClient.js'

// Landing page for the link sent to the NEW address when the user asks to
// change their email (profile.routes.js POST /email). The token is single-use,
// so the request is fired exactly once even under React StrictMode's doubled
// effects.
export default function ConfirmEmailChangePage() {
  const { actions } = useApp()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('working') // 'working' | 'done' | 'error'
  const [message, setMessage] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const token = searchParams.get('token')
    if (!token) { setStatus('error'); setMessage('ลิงก์ยืนยันไม่ถูกต้อง'); return }
    confirmEmailChange(token)
      .then(async ({ email }) => {
        setMessage(email)
        setStatus('done')
        // If this browser is signed in as that account, show the new address right away.
        const { user } = await fetchMe().catch(() => ({ user: null }))
        if (user) actions.setCurrentUser(user)
      })
      .catch((err) => { setStatus('error'); setMessage(err.message || 'ลิงก์ยืนยันหมดอายุหรือไม่ถูกต้อง') })
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#d7ede0,#eaf6ee)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 36, width: 380, maxWidth: '100%', boxShadow: '0 16px 40px rgba(0,0,0,0.1)', textAlign: 'center' }}>
        {status === 'working' && <div style={{ color: '#6d7a72', fontSize: 14 }}>กำลังยืนยันอีเมลใหม่...</div>}
        {status === 'done' && (
          <>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#1B5E20', marginBottom: 8 }}>เปลี่ยนอีเมลเรียบร้อยแล้ว</div>
            <p style={{ fontSize: 14, color: '#4a544d', margin: '0 0 18px', wordBreak: 'break-all' }}>ใช้ <b>{message}</b> เข้าสู่ระบบได้ตั้งแต่ตอนนี้</p>
            <Link to="/profile" style={{ fontSize: 13.5, fontWeight: 700, color: '#1B5E20' }}>ไปที่โปรไฟล์</Link>
          </>
        )}
        {status === 'error' && (
          <>
            <div role="alert" style={{ background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 16, textAlign: 'left' }}>{message}</div>
            <Link to="/profile?tab=security" style={{ fontSize: 13.5, fontWeight: 700, color: '#1B5E20' }}>กลับไปหน้าโปรไฟล์</Link>
          </>
        )}
      </div>
    </div>
  )
}
