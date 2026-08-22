import { useApp } from '../context/AppContext.jsx'

export default function LoginPage() {
  const { state, actions } = useApp()
  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: '70px 32px' }}>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <img src="./assets/dino-mascot-front.png" alt="Dino" style={{ width: 96, height: 'auto', margin: '0 auto 10px', display: 'block' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
        <h1 data-font="culture" style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>เข้าสู่ระบบ Dino</h1>
      </div>
      <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 26 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>อีเมล</label>
        <input value={state.authForm.email} onChange={actions.onAuthEmailChange} placeholder="you@email.com" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 16 }} />
        <label style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', display: 'block', marginBottom: 6 }}>รหัสผ่าน</label>
        <input type="password" value={state.authForm.password} onChange={actions.onAuthPasswordChange} placeholder="••••••••" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 16 }} />
        {state.authError && <div style={{ background: '#fdecec', color: '#a33232', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 14 }}>{state.authError}</div>}
        <button onClick={actions.submitLogin} disabled={state.authSubmitting} style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 12, borderRadius: 20, fontWeight: 800, fontSize: 14.5, cursor: state.authSubmitting ? 'default' : 'pointer', opacity: state.authSubmitting ? 0.7 : 1 }}>{state.authSubmitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</button>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13.5, color: '#6d7a72' }}>ยังไม่มีบัญชี? <a href="#" onClick={(e) => { e.preventDefault(); actions.goSignup() }} style={{ fontWeight: 700 }}>สมัครสมาชิก</a></div>
      </div>
    </main>
  )
}
