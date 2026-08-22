import { useApp } from '../context/AppContext.jsx'

export default function SignupPage() {
  const { state, actions } = useApp()
  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: '70px 32px' }}>
      <h1 data-font="culture" style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: '0 0 22px', textAlign: 'center' }}>สมัครสมาชิก Dino</h1>
      <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 26 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>ชื่อ</label>
        <input value={state.authForm.name} onChange={actions.onAuthNameChange} placeholder="ชื่อของคุณ" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 16 }} />
        <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>อีเมล</label>
        <input value={state.authForm.email} onChange={actions.onAuthEmailChange} placeholder="you@email.com" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 16 }} />
        <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>เบอร์โทรศัพท์</label>
        <input value={state.authForm.phone} onChange={actions.onAuthPhoneChange} placeholder="0812345678" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 16 }} />
        <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>รหัสผ่าน</label>
        <input type="password" value={state.authForm.password} onChange={actions.onAuthPasswordChange} placeholder="••••••••" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 16 }} />
        <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>ยืนยันรหัสผ่าน</label>
        <input type="password" value={state.authForm.confirmPassword} onChange={actions.onAuthConfirmPasswordChange} placeholder="••••••••" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 16 }} />
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#4a544d', marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={state.authForm.consent} onChange={actions.onAuthConsentChange} style={{ marginTop: 2 }} />
          <span>ฉันยินยอมให้ Dino เก็บและใช้ข้อมูลส่วนบุคคล (ชื่อ, อีเมล) เพื่อสร้างและดูแลบัญชีผู้ใช้ ตามนโยบายความเป็นส่วนตัว</span>
        </label>
        {state.authError && <div style={{ background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 14 }}>{state.authError}</div>}
        <button onClick={actions.submitSignup} disabled={state.authSubmitting} style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 12, borderRadius: 20, fontWeight: 800, fontSize: 14.5, cursor: state.authSubmitting ? 'default' : 'pointer', opacity: state.authSubmitting ? 0.7 : 1 }}>{state.authSubmitting ? 'กำลังสมัครสมาชิก...' : 'สมัครสมาชิก'}</button>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13.5, color: '#6d7a72' }}>มีบัญชีอยู่แล้ว? <a href="#" onClick={(e) => { e.preventDefault(); actions.goLogin() }} style={{ fontWeight: 700 }}>เข้าสู่ระบบ</a></div>
      </div>
    </main>
  )
}
