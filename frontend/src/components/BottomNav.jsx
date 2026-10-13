import { NavLink } from 'react-router-dom'
import { Calendar, House, MapPin, ScanLine, Sparkles } from 'lucide-react'

const iconProps = { size: 22, strokeWidth: 1.9, 'aria-hidden': true }

const icons = {
  home: <House {...iconProps} />,
  places: <MapPin {...iconProps} />,
  trip: <Sparkles {...iconProps} />,
  events: <Calendar {...iconProps} />,
  scan: <ScanLine {...iconProps} />,
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
