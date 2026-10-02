import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { fetchAdminPlaceReportCount, fetchAdminEventReportCount } from '../lib/apiClient.js'
import { adminTabs } from '../data/seed.js'

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
  if (nav.isRedeem) return (
    <span style={{ width: 14, height: 11, border: `2px solid ${nav.iconColor}`, borderRadius: 2, position: 'relative', display: 'inline-block', marginTop: 2 }}>
      <span style={{ position: 'absolute', top: -2, left: 4, width: 2, height: 11, background: nav.iconColor }}></span>
      <span style={{ position: 'absolute', top: 2, left: -1, width: 12, height: 2, background: nav.iconColor }}></span>
    </span>
  )
  if (nav.isUsers) return (
    <span style={{ position: 'relative', width: 14, height: 14, display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: 0, left: 4, width: 6, height: 6, borderRadius: '50%', background: nav.iconColor }}></span>
      <span style={{ position: 'absolute', bottom: 0, left: 1, width: 12, height: 6, borderRadius: '6px 6px 2px 2px', background: nav.iconColor }}></span>
    </span>
  )
  if (nav.isReports) return (
    <span style={{ position: 'relative', width: 12, height: 14, display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: 0, left: 1, width: 2, height: 14, background: nav.iconColor }}></span>
      <span style={{ position: 'absolute', top: 1, left: 3, width: 9, height: 7, background: nav.iconColor, borderRadius: '0 2px 2px 0' }}></span>
    </span>
  )
  if (nav.isTrips) return (
    <span style={{ position: 'relative', width: 14, height: 14, display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: 0, left: 0, width: 5, height: 5, borderRadius: '50%', border: `2px solid ${nav.iconColor}`, boxSizing: 'border-box' }}></span>
      <span style={{ position: 'absolute', bottom: 0, right: 0, width: 5, height: 5, borderRadius: '50%', background: nav.iconColor }}></span>
      <span style={{ position: 'absolute', top: 4, left: 5, width: 2, height: 7, background: nav.iconColor, transform: 'rotate(-40deg)', transformOrigin: 'top' }}></span>
    </span>
  )
  return null
}

export default function AdminSidebar() {
  const { actions } = useApp()
  const { tab = 'dashboard' } = useParams()
  const navigate = useNavigate()

  // Pending-report badge; refreshed whenever the admin switches tab (e.g. after
  // clearing the queue) rather than polled.
  const [pendingReports, setPendingReports] = useState(0)
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchAdminPlaceReportCount(), fetchAdminEventReportCount()])
      .then(([p, e]) => { if (!cancelled) setPendingReports(p.pending + e.pending) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tab])

  const adminNav = adminTabs.map((t) => {
    const active = t.key === tab
    return {
      key: t.key, label: t.label, onClick: () => { actions.cancelForm(); navigate(`/admin/${t.key}`) },
      bg: active ? '#E8F5E9' : 'transparent', color: active ? '#1B5E20' : '#6d7a72',
      iconBg: active ? 'linear-gradient(135deg,#66BB6A,#2E7D32)' : '#F1F8E9',
      iconColor: active ? '#fff' : '#7d8a80',
      isDashboard: t.icon === 'dashboard', isPlaces: t.icon === 'places', isEvents: t.icon === 'events', isKnowledge: t.icon === 'knowledge', isQr: t.icon === 'qr', isRedeem: t.icon === 'redeem', isUsers: t.icon === 'users', isTrips: t.icon === 'trips', isReports: t.icon === 'reports',
      badge: t.key === 'reports' ? pendingReports : 0
    }
  })

  return (
    <aside style={{ width: 238, background: '#FFFFFF', borderRight: '1px solid #E7E3D2', padding: '20px 0', flexShrink: 0, display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', alignSelf: 'flex-start', overflowY: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px 20px', borderBottom: '1px solid #F0EDE0', marginBottom: 14 }}>
        <img src="/assets/dino-logo-mark.png" alt="" style={{ width: 34, height: 34, borderRadius: 10 }} />
        <div>
          <div style={{ color: '#1B5E20', fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>Dino Admin</div>
          <div style={{ color: '#9aa39c', fontSize: 11 }}>ขอนแก่น</div>
        </div>
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#a8b0a9', letterSpacing: 1, padding: '0 20px 8px' }}>เมนูหลัก</div>
      {adminNav.map((nav) => (
        <div key={nav.key} onClick={nav.onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '0 12px 3px', padding: '10px 12px', borderRadius: 11, cursor: 'pointer', transition: 'all 0.18s ease', fontSize: 13.5, fontWeight: 600, color: nav.color, background: nav.bg }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: nav.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <NavIcon nav={nav} />
          </span>
          {nav.label}
          {nav.badge > 0 && <span style={{ marginLeft: 'auto', background: '#c0392b', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '1px 7px' }}>{nav.badge > 99 ? '99+' : nav.badge}</span>}
        </div>
      ))}
      <div style={{ marginTop: 'auto', padding: '16px 20px 0', borderTop: '1px solid #F0EDE0' }}>
        <div onClick={actions.adminLogout} style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#8a938c' }}>← ออกจากระบบ</div>
      </div>
    </aside>
  )
}
