import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import { fetchProfile } from '../lib/apiClient.js'
import OverviewTab from '../profile/OverviewTab.jsx'
import InfoTab from '../profile/InfoTab.jsx'
import HistoryTab from '../profile/HistoryTab.jsx'
import EventRequestsTab from '../profile/EventRequestsTab.jsx'
import SecurityTab from '../profile/SecurityTab.jsx'
import AvatarEditor from '../profile/AvatarEditor.jsx'
import ProfilePass from '../profile/ProfilePass.jsx'

const TABS = [
  { key: 'overview', to: '/profile', label: 'ภาพรวม' },
  { key: 'info', to: '/profile?tab=info', label: 'ข้อมูล' },
  { key: 'history', to: '/profile?tab=history', label: 'ประวัติ' },
  { key: 'events', to: '/profile?tab=events', label: 'กิจกรรมของฉัน' },
  { key: 'security', to: '/profile?tab=security', label: 'ความปลอดภัย' },
]

export default function ProfilePage() {
  const { actions } = useApp()
  // Tabs live in ?tab= rather than /profile/:tab: the app's header/footer load
  // images from relative /assets/ URLs, which only resolve on one-level paths.
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab = TABS.some((t) => t.key === requested) ? requested : 'overview'
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState(null)
  const [avatarOpen, setAvatarOpen] = useState(false)

  const load = () => {
    setError(null)
    fetchProfile().then(setProfile).catch(setError)
  }
  useEffect(load, [])

  // A fresh profile from the API: keep the page and the header (currentUser) in step.
  const applyProfile = (next) => {
    setProfile((p) => ({ ...p, ...next }))
    actions.setCurrentUser(next)
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px 64px' }}>
      {error ? (
        <LoadError message={error.message || 'โหลดข้อมูลโปรไฟล์ไม่สำเร็จ'} onRetry={load} />
      ) : !profile ? (
        <LoadingSpinner size={36} label="กำลังโหลดโปรไฟล์..." />
      ) : (
        <>
          <ProfilePass profile={profile} onEditAvatar={() => setAvatarOpen(true)} />
          <nav className="dc-ptabs" aria-label="เมนูโปรไฟล์">
            {TABS.map((t) => (
              <Link key={t.key} to={t.to} aria-current={tab === t.key ? 'page' : undefined} className={`dc-ptab${tab === t.key ? ' active' : ''}`}>{t.label}</Link>
            ))}
          </nav>
          <div className="dc-sheet">
            {tab === 'overview' && <OverviewTab profile={profile} />}
            {tab === 'info' && <InfoTab profile={profile} onSaved={applyProfile} />}
            {tab === 'history' && <HistoryTab />}
            {tab === 'events' && <EventRequestsTab />}
            {tab === 'security' && <SecurityTab profile={profile} onPendingChange={(pendingEmail) => setProfile((p) => ({ ...p, pendingEmail }))} />}
          </div>
          <AvatarEditor open={avatarOpen} onClose={() => setAvatarOpen(false)} profile={profile} onSaved={applyProfile} />
        </>
      )}
    </main>
  )
}
