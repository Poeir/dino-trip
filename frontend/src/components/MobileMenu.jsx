import { NavLink } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'

const mobileNavLinkStyle = ({ isActive }) => ({ padding: '12px 4px', fontSize: 15, fontWeight: 700, color: isActive ? '#1B5E20' : '#1f2a24', borderBottom: '1px solid #F0EDE0', textDecoration: 'none' })

export default function MobileMenu() {
  const { state, actions } = useApp()
  if (!state.mobileMenuOpen) return null
  return (
    <div style={{ position: 'sticky', top: 68, zIndex: 39, background: '#fff', borderBottom: '1px solid #E7E3D2', display: 'flex', flexDirection: 'column', padding: '10px 24px 18px', gap: 4, animation: 'dc-fade-up 0.25s ease both' }}>
      <NavLink to="/" end onClick={actions.closeMobileMenu} style={mobileNavLinkStyle}>หน้าแรก</NavLink>
      <NavLink to="/places" onClick={actions.closeMobileMenu} style={mobileNavLinkStyle}>สถานที่ท่องเที่ยว</NavLink>
      <NavLink to="/events" onClick={actions.closeMobileMenu} style={mobileNavLinkStyle}>กิจกรรม &amp; เทศกาล</NavLink>
      <NavLink to="/trip" onClick={actions.closeMobileMenu} style={mobileNavLinkStyle}>วางแผนทริป AI</NavLink>
      <NavLink to="/points" onClick={actions.closeMobileMenu} style={mobileNavLinkStyle}>พอยท์สะสม</NavLink>
      {!state.loggedIn && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); actions.goLogin() }} style={{ flex: 1, textAlign: 'center', padding: 11, border: '1px solid #DCD8C6', borderRadius: 16, fontSize: 14, fontWeight: 700, color: '#1f2a24' }}>เข้าสู่ระบบ</a>
          <button onClick={actions.goSignup} style={{ flex: 1, background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 11, borderRadius: 16, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>สมัครสมาชิก</button>
        </div>
      )}
    </div>
  )
}
