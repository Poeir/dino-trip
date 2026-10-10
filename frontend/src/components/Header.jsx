import { NavLink } from 'react-router-dom'
import UserMenu from './UserMenu.jsx'
import { useApp } from '../context/AppContext.jsx'

const navLinkStyle = ({ isActive }) => ({ fontSize: 15, color: isActive ? '#1B5E20' : '#1f2a24', fontWeight: isActive ? '800' : '600', position: 'relative', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 })
const underline = (isActive) => ({ position: 'absolute', bottom: -12, left: 0, height: 3, width: isActive ? '100%' : '0%', background: '#2E7D32', borderRadius: 2, transition: 'width 0.2s ease' })

export default function Header() {
  const { state, actions } = useApp()
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 40, background: '#ffffff', borderBottom: '1px solid #E7E3D2', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '0 32px', height: 68 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', justifySelf: 'start' }} onClick={actions.goHome}>
        <img src="/assets/dino-logo-full.webp" alt="Dino" width={67} height={34} style={{ height: 34, width: 'auto', flexShrink: 0 }} />
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
        {state.loggedIn && (
          <NavLink to="/trips" style={navLinkStyle}>
            {({ isActive }) => (<>ทริปของฉัน<span style={underline(isActive)}></span></>)}
          </NavLink>
        )}
        <NavLink to="/points" style={navLinkStyle}>
          {({ isActive }) => (<>พอยท์สะสม<span style={underline(isActive)}></span></>)}
        </NavLink>
      </nav>
      <div data-role={state.authChecked ? 'header-auth' : 'desktop-nav'} style={{ display: 'flex', alignItems: 'center', gap: 14, justifySelf: 'end' }}>
        {!state.authChecked ? (
          // Session check still in flight: reserve the space instead of flashing
          // the logged-out buttons for a moment.
          <div style={{ width: 230, height: 36 }} aria-hidden="true"></div>
        ) : state.loggedIn ? (
          <UserMenu />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a data-role="header-login-link" href="#" onClick={(e) => { e.preventDefault(); actions.goLogin() }} style={{ fontSize: 14, fontWeight: 600, color: '#1f2a24' }}>เข้าสู่ระบบ</a>
            <button onClick={actions.goSignup} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 20, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>สมัครสมาชิก</button>
          </div>
        )}
      </div>
    </header>
  )
}
