import { useApp } from '../context/AppContext.jsx'

function NavIcon({ nav }) {
  if (nav.isDashboard) return (
    <span style={{ width: 12, height: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
      <span style={{ background: nav.iconColor, borderRadius: 1 }}></span><span style={{ background: nav.iconColor, borderRadius: 1 }}></span>
      <span style={{ background: nav.iconColor, borderRadius: 1 }}></span><span style={{ background: nav.iconColor, borderRadius: 1 }}></span>
    </span>
  )
  if (nav.isPlaces) return <span style={{ width: 11, height: 11, borderRadius: '50% 50% 50% 0', background: nav.iconColor, transform: 'rotate(-45deg)' }}></span>
  if (nav.isEvents) return (
    <span style={{ width: 14, height: 12, border: `2px solid ${nav.iconColor}`, borderRadius: 2, position: 'relative' }}>
      <span style={{ position: 'absolute', top: -4, left: 2, width: 2, height: 5, background: nav.iconColor }}></span>
      <span style={{ position: 'absolute', top: -4, right: 2, width: 2, height: 5, background: nav.iconColor }}></span>
    </span>
  )
  if (nav.isKnowledge) return <span style={{ width: 15, height: 11, background: nav.iconColor, borderRadius: '4px 4px 4px 0' }}></span>
  if (nav.isQr) return (
    <span style={{ width: 14, height: 11, border: `2px solid ${nav.iconColor}`, borderRadius: 2, position: 'relative', display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: 1, left: 2.5, width: 5, height: 5, borderRadius: '50%', border: `1.5px solid ${nav.iconColor}` }}></span>
    </span>
  )
  return null
}

export default function AdminSidebar() {
  const { actions, derived } = useApp()
  return (
    <aside style={{ width: 238, background: '#FFFFFF', borderRight: '1px solid #E7E3D2', padding: '20px 0', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px 20px', borderBottom: '1px solid #F0EDE0', marginBottom: 14 }}>
        <img src="./assets/dino-logo-mark.png" alt="" style={{ width: 34, height: 34, borderRadius: 10 }} />
        <div>
          <div style={{ color: '#1B5E20', fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>Dino Admin</div>
          <div style={{ color: '#9aa39c', fontSize: 11 }}>ขอนแก่น</div>
        </div>
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#a8b0a9', letterSpacing: 1, padding: '0 20px 8px' }}>เมนูหลัก</div>
      {derived.adminNav.map((nav) => (
        <div key={nav.key} onClick={nav.onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '0 12px 3px', padding: '10px 12px', borderRadius: 11, cursor: 'pointer', transition: 'all 0.18s ease', fontSize: 13.5, fontWeight: 600, color: nav.color, background: nav.bg }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: nav.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <NavIcon nav={nav} />
          </span>
          {nav.label}
        </div>
      ))}
      <div style={{ marginTop: 'auto', padding: '16px 20px 0', borderTop: '1px solid #F0EDE0' }}>
        <div onClick={actions.adminLogout} style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#8a938c' }}>← ออกจากระบบ</div>
      </div>
    </aside>
  )
}
