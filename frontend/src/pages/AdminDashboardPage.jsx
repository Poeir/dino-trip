import { Suspense, useState } from 'react'
import { Menu } from 'lucide-react'
import { Navigate, useParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import '../admin/admin.css'
import AdminSidebar from '../admin/AdminSidebar.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import Toast from '../components/Toast.jsx'
import { lazyPage } from '../lib/lazyPage.js'
import { adminTabs } from '../data/seed.js'

// One chunk per admin tab: opening /admin/users no longer downloads the places,
// QR and event editors. (This page itself is already a lazy chunk in App.jsx.)
const TAB_COMPONENTS = {
  dashboard: lazyPage(() => import('../admin/DashboardTab.jsx')),
  places: lazyPage(() => import('../admin/places/PlacesTab.jsx')),
  events: lazyPage(() => import('../admin/events/EventsTab.jsx')),
  knowledge: lazyPage(() => import('../admin/KnowledgeTab.jsx')),
  reports: lazyPage(() => import('../admin/ReportsTab.jsx')),
  'event-requests': lazyPage(() => import('../admin/EventRequestsTab.jsx')),
  qr: lazyPage(() => import('../admin/qr/QrTab.jsx')),
  rewards: lazyPage(() => import('../admin/rewards/RewardsTab.jsx')),
  redeem: lazyPage(() => import('../admin/RedeemTab.jsx')),
  users: lazyPage(() => import('../admin/users/UsersTab.jsx')),
  trips: lazyPage(() => import('../admin/TripsTab.jsx')),
}

export default function AdminDashboardPage() {
  const { tab = 'dashboard' } = useParams()
  const { state } = useApp()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const knownTab = adminTabs.find((t) => t.key === tab)
  const TabComponent = TAB_COMPONENTS[tab]
  // Unknown /admin/<anything> used to render a blank page.
  if (!knownTab || !TabComponent) return <Navigate to="/admin" replace />
  const email = state.currentUser?.email || 'ผู้ดูแลระบบ'
  return (
    <div data-role="admin-shell" className="ad-shell">
      <AdminSidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main className="ad-main">
        <div className="ad-topbar">
          <button type="button" className="ad-topbar__menu" onClick={() => setDrawerOpen(true)} aria-label="เปิดเมนู" aria-expanded={drawerOpen}>
            <Menu size={22} />
          </button>
          <div className="ad-topbar__title">ผู้ดูแลระบบ</div>
          <div className="ad-topbar__user">
            <span className="ad-topbar__email" title={email}>{email}</span>
            <span className="ad-topbar__avatar" aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
          </div>
        </div>
        <div className="ad-content">
          {/* Fallback fades in after a short delay (no flash on fast loads); the keyed wrapper replays the
              enter animation on every tab change. Both are CSS-only (admin.css). */}
          <Suspense fallback={<div className="ad-delayed"><LoadingSpinner size={36} label="กำลังโหลด..." /></div>}>
            <div key={tab} className="ad-route">
              <TabComponent />
            </div>
          </Suspense>
        </div>
      </main>
      <Toast />
    </div>
  )
}
