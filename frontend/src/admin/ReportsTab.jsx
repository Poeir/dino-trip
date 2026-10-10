import { useState } from 'react'
import { PlaceReportsPanel } from './PlaceReportsTab.jsx'
import EventReportsPanel from './EventReportsPanel.jsx'
import FilterChips from './ui/FilterChips.jsx'
import { useAdminPendingCounts } from '../lib/useAdminPendingCounts.js'

// The "รายงานข้อมูล" admin tab: one queue per kind of record, switched here.
// Each kind's pending count is shown on its chip so nothing hides behind the
// toggle.
export default function ReportsTab() {
  const [kind, setKind] = useState('place')
  const counts = useAdminPendingCounts(kind)

  return (
    <>
      <div className="ad-toolbar">
        <FilterChips
          label="ประเภทรายงาน"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'place', label: `สถานที่${counts.placeReports > 0 ? ` (${counts.placeReports})` : ''}` },
            { value: 'event', label: `กิจกรรม${counts.eventReports > 0 ? ` (${counts.eventReports})` : ''}` },
          ]}
        />
      </div>
      {kind === 'place' ? <PlaceReportsPanel /> : <EventReportsPanel />}
    </>
  )
}
