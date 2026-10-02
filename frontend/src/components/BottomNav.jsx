import { NavLink } from 'react-router-dom'

const svgProps = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

const icons = {
  home: <svg {...svgProps}><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /></svg>,
  places: <svg {...svgProps}><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>,
  trip: <svg {...svgProps}><path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9L12 3.5Z" /><path d="M18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" /></svg>,
  events: <svg {...svgProps}><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  scan: <svg {...svgProps}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><rect x="8" y="8" width="3" height="3" rx=".6" /><rect x="13" y="8" width="3" height="3" rx=".6" /><rect x="8" y="13" width="3" height="3" rx=".6" /><path d="M13.5 14.5h2.5v1.5" /></svg>,
}

// Primary navigation on small screens (<= 880px; see index.css). Desktop keeps
// the header nav. Profile / "my trips" / sign-out live in the header account
// menu; sign-in and sign-up in the header when logged out.
export default function BottomNav() {
  const items = [
    { to: '/', label: 'หน้าแรก', icon: icons.home, end: true },
    { to: '/places', label: 'สถานที่', icon: icons.places },
    { to: '/trip', label: 'วางแผนทริป', icon: icons.trip, primary: true },
    { to: '/events', label: 'กิจกรรม', icon: icons.events },
    { to: '/points', label: 'สแกนพอยท์', icon: icons.scan },
  ]
  return (
    <nav className="dc-bottom-nav" aria-label="เมนูหลัก">
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `dc-bn-item${it.primary ? ' dc-bn-primary' : ''}${isActive ? ' active' : ''}`}>
          <span className="dc-bn-icon">{it.icon}</span>
          <span className="dc-bn-label">{it.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
