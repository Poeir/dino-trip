import { useEffect, useState } from 'react'
import { PlaceReportsPanel } from './PlaceReportsTab.jsx'
import EventReportsPanel from './EventReportsPanel.jsx'
import { fetchAdminPlaceReportCount, fetchAdminEventReportCount } from '../lib/apiClient.js'

const chipStyle = (active) => ({
  padding: '8px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
  border: `1px solid ${active ? '#1B5E20' : '#DCD8C6'}`, background: active ? '#1B5E20' : '#fff', color: active ? '#fff' : '#3c463f',
})

// The "รายงานข้อมูล" admin tab: one queue per kind of record, switched here.
// Each kind's pending count is shown on its chip so nothing hides behind the
// toggle.
export default function ReportsTab() {
  const [kind, setKind] = useState('place')
  const [counts, setCounts] = useState({ place: 0, event: 0 })

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchAdminPlaceReportCount(), fetchAdminEventReportCount()])
      .then(([p, e]) => { if (!cancelled) setCounts({ place: p.pending, event: e.pending }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [kind])

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button onClick={() => setKind('place')} style={chipStyle(kind === 'place')}>สถานที่{counts.place > 0 ? ` (${counts.place})` : ''}</button>
        <button onClick={() => setKind('event')} style={chipStyle(kind === 'event')}>อีเวนต์{counts.event > 0 ? ` (${counts.event})` : ''}</button>
      </div>
      {kind === 'place' ? <PlaceReportsPanel /> : <EventReportsPanel />}
    </>
  )
}
