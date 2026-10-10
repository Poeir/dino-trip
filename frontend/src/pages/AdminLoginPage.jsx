import { ArrowLeft } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'

const inputStyle = { width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 12, textAlign: 'left' }
const labelStyle = { display: 'block', textAlign: 'left', fontSize: 13, fontWeight: 700, color: '#3c463f', marginBottom: 4 }

export default function AdminLoginPage() {
  const { state, actions } = useApp()

  // Reached directly (e.g. a new tab) while the session cookie already
  // belongs to an admin -- fetchMe() in AppContext hydrates adminLoggedIn
  // on load, but nothing was redirecting away from this route once it did.
  if (!state.authChecked) return null
  if (state.adminLoggedIn) return <Navigate to="/admin" replace />

  const onSubmit = (e) => {
    e.preventDefault()
    if (!state.authSubmitting) actions.adminLogin()
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#d7ede0,#eaf6ee)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form onSubmit={onSubmit} style={{ background: '#fff', borderRadius: 16, padding: 36, width: 'min(360px, 100%)', boxShadow: '0 16px 40px rgba(0,0,0,0.1)', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1B5E20', margin: '0 0 2px' }}>Dino Admin Portal</h1>
        <div style={{ fontSize: 12.5, color: '#5f6a63', marginBottom: 22 }}>สำหรับผู้ดูแลระบบ</div>
        <label htmlFor="admin-email" style={labelStyle}>อีเมล</label>
        <input id="admin-email" name="email" type="email" autoComplete="username" value={state.authForm.email} onChange={actions.onAuthEmailChange} placeholder="Email" style={inputStyle} />
        <label htmlFor="admin-password" style={labelStyle}>รหัสผ่าน</label>
        <input id="admin-password" name="password" type="password" autoComplete="current-password" value={state.authForm.password} onChange={actions.onAuthPasswordChange} placeholder="Password" style={inputStyle} />
        {state.authError && <div role="alert" style={{ background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 12, textAlign: 'left' }}>{state.authError}</div>}
        <button type="submit" disabled={state.authSubmitting} style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 11, borderRadius: 20, fontWeight: 800, fontSize: 14, cursor: state.authSubmitting ? 'default' : 'pointer', opacity: state.authSubmitting ? 0.7 : 1 }}>{state.authSubmitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</button>
        <div style={{ marginTop: 14 }}><a href="#" onClick={(e) => { e.preventDefault(); actions.goPublic() }} style={{ fontSize: 12.5, color: '#5f6a63' }}><ArrowLeft size={13} strokeWidth={2.4} style={{ verticalAlign: '-2px' }} /> กลับสู่หน้าเว็บ</a></div>
      </form>
    </div>
  )
}
