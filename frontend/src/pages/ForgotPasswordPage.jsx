import { useApp } from '../context/AppContext.jsx'

export default function ForgotPasswordPage() {
  const { state, actions } = useApp()
  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: '70px 32px' }}>
      <h1 data-font="culture" style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: '0 0 22px', textAlign: 'center' }}>ลืมรหัสผ่าน</h1>
      <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 26 }}>
        {state.forgotPasswordSent ? (
          <>
            <div style={{ background: '#E8F5E9', color: '#1B5E20', fontSize: 13.5, padding: '14px 16px', borderRadius: 10, marginBottom: 14, lineHeight: 1.6 }}>
              หากอีเมล <strong>{state.authForm.email}</strong> มีอยู่ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปให้แล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึงโฟลเดอร์สแปม)
            </div>
            <div style={{ textAlign: 'center', fontSize: 13.5, color: '#6d7a72' }}>
              <a href="#" onClick={(e) => { e.preventDefault(); actions.goLogin() }} style={{ fontWeight: 700 }}>กลับไปเข้าสู่ระบบ</a>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13.5, color: '#6d7a72', margin: '0 0 16px', lineHeight: 1.6 }}>กรอกอีเมลที่ใช้สมัครสมาชิก เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้</p>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>อีเมล</label>
            <input value={state.authForm.email} onChange={actions.onAuthEmailChange} placeholder="you@email.com" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 16 }} />
            {state.authError && <div style={{ background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 14 }}>{state.authError}</div>}
            <button onClick={actions.submitForgotPassword} disabled={state.authSubmitting} style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 12, borderRadius: 20, fontWeight: 800, fontSize: 14.5, cursor: state.authSubmitting ? 'default' : 'pointer', opacity: state.authSubmitting ? 0.7 : 1 }}>{state.authSubmitting ? 'กำลังส่ง...' : 'ส่งลิงก์รีเซ็ตรหัสผ่าน'}</button>
            <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13.5, color: '#6d7a72' }}>นึกรหัสผ่านออกแล้ว? <a href="#" onClick={(e) => { e.preventDefault(); actions.goLogin() }} style={{ fontWeight: 700 }}>เข้าสู่ระบบ</a></div>
          </>
        )}
      </div>
    </main>
  )
}
