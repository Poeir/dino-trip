import { useApp } from '../context/AppContext.jsx'
import AdminSidebar from '../admin/AdminSidebar.jsx'
import DashboardTab from '../admin/DashboardTab.jsx'
import PlacesTab from '../admin/PlacesTab.jsx'
import EventsTab from '../admin/EventsTab.jsx'
import KnowledgeTab from '../admin/KnowledgeTab.jsx'
import QrTab from '../admin/QrTab.jsx'
import Toast from '../components/Toast.jsx'

export default function AdminDashboardPage() {
  const { derived } = useApp()
  return (
    <div data-role="admin-shell" style={{ minHeight: '100vh', display: 'flex' }}>
      <AdminSidebar />
      <main style={{ flex: 1, padding: 0, background: '#FBF8EE', overflowY: 'auto' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #E7E3D2', padding: '16px 34px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13, color: '#8a938c' }}>ผู้ดูแลระบบ · {derived.adminTabLabel}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ fontSize: 13, color: '#3c463f', fontWeight: 600 }}>admin@dino.go.th</span>
            <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#66BB6A,#2E7D32)' }}></span>
          </div>
        </div>
        <div style={{ padding: '28px 34px 40px' }}>
          {derived.isAdminDashboardTab && <DashboardTab />}
          {derived.isAdminPlacesTab && <PlacesTab />}
          {derived.isAdminEventsTab && <EventsTab />}
          {derived.isAdminKbTab && <KnowledgeTab />}
          {derived.isAdminQrTab && <QrTab />}
        </div>
      </main>
      <Toast />
    </div>
  )
}
