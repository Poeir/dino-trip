import { useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'

const labelStyle = { fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }
const inputStyle = { width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14 }

// Landing page for our own password-reset email link (see sendPasswordResetEmail
// in backend/src/lib/mailer.js, sent from auth.routes.js's /forgot-password
// handler). Unlike ConfirmEmailPage this does NOT auto-consume the token on
// mount -- it just validates one is present, then shows a form; the token is
// only spent when the visitor submits a new password (see submitResetPassword
// in AppContext.jsx).
export default function ResetPasswordPage() {
  const { state, actions, derived } = useApp()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#d7ede0,#eaf6ee)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 36, width: 380, boxShadow: '0 16px 40px rgba(0,0,0,0.1)' }}>
        <h1 data-font="culture" style={{ fontSize: 19, fontWeight: 800, color: '#1B5E20', margin: '0 0 20px', textAlign: 'center' }}>ตั้งรหัสผ่านใหม่</h1>
        {!token ? (
          <>
            <div style={{ background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 16, textAlign: 'left' }}>ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง</div>
            <div style={{ textAlign: 'center' }}>
              <a href="#" onClick={(e) => { e.preventDefault(); actions.goForgotPassword() }} style={{ fontSize: 13.5, fontWeight: 700, color: '#1B5E20' }}>ขอลิงก์ใหม่</a>
            </div>
          </>
        ) : (
          <>
            <label style={labelStyle}>รหัสผ่านใหม่</label>
            <input type="password" value={state.resetForm.password} onChange={actions.onResetPasswordChange} placeholder="••••••••" style={{ ...inputStyle, marginBottom: 8 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
              {derived.resetPasswordRules.map((r) => (
                <span key={r.key} style={{ fontSize: 12, fontWeight: 600, color: r.met ? '#2E7D32' : '#a9b3ac', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 800 }}>{r.met ? '✓' : '○'}</span>{r.label}
                </span>
              ))}
            </div>
            <label style={labelStyle}>ยืนยันรหัสผ่านใหม่</label>
            <input type="password" value={state.resetForm.confirmPassword} onChange={actions.onResetConfirmPasswordChange} placeholder="••••••••" style={{ ...inputStyle, marginBottom: state.resetForm.confirmPassword ? 6 : 16 }} />
            {state.resetForm.confirmPassword && (
              <p style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 600, color: derived.resetPasswordsMatch ? '#2E7D32' : '#a33232' }}>
                {derived.resetPasswordsMatch ? '✓ รหัสผ่านตรงกัน' : '✗ รหัสผ่านไม่ตรงกัน'}
              </p>
            )}
            {state.authError && <div style={{ background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 14 }}>{state.authError}</div>}
            <button onClick={() => actions.submitResetPassword(token)} disabled={state.authSubmitting} style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 12, borderRadius: 20, fontWeight: 800, fontSize: 14.5, cursor: state.authSubmitting ? 'default' : 'pointer', opacity: state.authSubmitting ? 0.7 : 1 }}>{state.authSubmitting ? 'กำลังบันทึก...' : 'ตั้งรหัสผ่านใหม่'}</button>
          </>
        )}
      </div>
    </div>
  )
}
