import { NavLink } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'

const navLinkStyle = ({ isActive }) => ({ fontSize: 15, color: isActive ? '#1B5E20' : '#1f2a24', fontWeight: isActive ? '800' : '600', position: 'relative', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 })
const underline = (isActive) => ({ position: 'absolute', bottom: -12, left: 0, height: 3, width: isActive ? '100%' : '0%', background: '#2E7D32', borderRadius: 2, transition: 'width 0.2s ease' })

export default function Header() {
  const { state, actions } = useApp()
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 40, background: '#ffffff', borderBottom: '1px solid #E7E3D2', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '0 32px', height: 68 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', justifySelf: 'start' }} onClick={actions.goHome}>
        <img src="./assets/dino-logo-full.png" alt="Dino" style={{ height: 34, width: 'auto', flexShrink: 0 }} />
      </div>
      <nav data-role="desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: 30, justifySelf: 'center' }}>
        <NavLink to="/" end style={navLinkStyle}>
          {({ isActive }) => (<>หน้าแรก<span style={underline(isActive)}></span></>)}
        </NavLink>
        <NavLink to="/places" style={navLinkStyle}>
          {({ isActive }) => (<>สถานที่ท่องเที่ยว<span style={underline(isActive)}></span></>)}
        </NavLink>
        <NavLink to="/events" style={navLinkStyle}>
          {({ isActive }) => (<>กิจกรรม &amp; เทศกาล<span style={underline(isActive)}></span></>)}
        </NavLink>
        <NavLink to="/trip" style={navLinkStyle}>
          {({ isActive }) => (<>วางแผนทริป AI<span style={{ background: 'linear-gradient(135deg,#f9a825,#FBC02D)', color: '#1B5E20', fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 8 }}>ใหม่</span><span style={underline(isActive)}></span></>)}
        </NavLink>
        <NavLink to="/points" style={navLinkStyle}>
          {({ isActive }) => (<>พอยท์สะสม<span style={underline(isActive)}></span></>)}
        </NavLink>
      </nav>
      <div data-role="desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: 14, justifySelf: 'end' }}>
        {state.loggedIn ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#E8F5E9', padding: '6px 12px', borderRadius: 20 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20' }}>{state.userPoints} พอยท์</span>
            </div>
            <span style={{ fontSize: 14, color: '#6d7a72' }}>สวัสดี, {state.userName}</span>
            <button onClick={actions.logout} style={{ background: 'none', border: 'none', color: '#6d7a72', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>ออกจากระบบ</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); actions.goLogin() }} style={{ fontSize: 14, fontWeight: 600, color: '#1f2a24' }}>เข้าสู่ระบบ</a>
            <button onClick={actions.goSignup} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 20, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>สมัครสมาชิก</button>
          </div>
        )}
      </div>
      <button data-role="hamburger-btn" onClick={actions.toggleMobileMenu} style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', flexDirection: 'column', gap: 5, padding: 8 }}>
        <span style={{ width: 24, height: 2.5, background: '#1B5E20', borderRadius: 2 }}></span>
        <span style={{ width: 24, height: 2.5, background: '#1B5E20', borderRadius: 2 }}></span>
        <span style={{ width: 24, height: 2.5, background: '#1B5E20', borderRadius: 2 }}></span>
      </button>
    </header>
  )
}
