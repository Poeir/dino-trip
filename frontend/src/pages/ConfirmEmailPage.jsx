import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'

// Landing page for our own confirmation email link (see sendVerificationEmail
// in backend/src/lib/mailer.js, sent from auth.routes.js's /signup handler).
// Reads ?token= from the URL and relays it to POST /api/auth/confirm to get
// the same httpOnly cookies /login and /signup already set.
export default function ConfirmEmailPage() {
  const { actions } = useApp()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('working') // 'working' | 'error'
  const [message, setMessage] = useState('')

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('error')
      setMessage('ลิงก์ยืนยันไม่ถูกต้อง')
      return
    }
    actions.completeEmailConfirmation(token)
      .catch(() => { setStatus('error'); setMessage('ลิงก์ยืนยันหมดอายุหรือไม่ถูกต้อง กรุณาสมัครสมาชิกอีกครั้ง') })
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#d7ede0,#eaf6ee)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 36, width: 360, boxShadow: '0 16px 40px rgba(0,0,0,0.1)', textAlign: 'center' }}>
        {status === 'working' ? (
          <div style={{ color: '#6d7a72', fontSize: 14 }}>กำลังยืนยันอีเมล...</div>
        ) : (
          <>
            <div style={{ background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 16, textAlign: 'left' }}>{message}</div>
            <a href="#" onClick={(e) => { e.preventDefault(); actions.goSignup() }} style={{ fontSize: 13.5, fontWeight: 700, color: '#1B5E20' }}>กลับไปหน้าสมัครสมาชิก</a>
          </>
        )}
      </div>
    </div>
  )
}
