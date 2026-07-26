import { useApp } from '../context/AppContext.jsx'

export default function AdminLoginPage() {
  const { state, actions } = useApp()
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#d7ede0,#eaf6ee)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 36, width: 360, boxShadow: '0 16px 40px rgba(0,0,0,0.1)', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1B5E20', margin: '0 0 2px' }}>Dino Admin Portal</h1>
        <div style={{ fontSize: 12.5, color: '#6d7a72', marginBottom: 22 }}>สำหรับผู้ดูแลระบบ</div>
        <input value={state.authForm.email} onChange={actions.onAuthEmailChange} placeholder="Username" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 12, textAlign: 'left' }} />
        <input type="password" value={state.authForm.password} onChange={actions.onAuthPasswordChange} placeholder="Password" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 18, textAlign: 'left' }} />
        <button onClick={actions.adminLogin} style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 11, borderRadius: 20, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>เข้าสู่ระบบ</button>
        <div style={{ marginTop: 14 }}><a href="#" onClick={(e) => { e.preventDefault(); actions.goPublic() }} style={{ fontSize: 12.5, color: '#6d7a72' }}>← กลับสู่หน้าเว็บ</a></div>
      </div>
    </div>
  )
}
