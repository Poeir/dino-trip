import { MASCOT } from '../data/categoryImages.js'
import { LONG_TRIP_DAYS } from '../data/seed.js'
import { useApp } from '../context/AppContext.jsx'

export default function TripLoadingPage() {
  const { state } = useApp()
  // A 5-day plan took ~90 s to generate; say so, or it looks stuck.
  const longTrip = (state.tripForm?.dayCount || 1) >= LONG_TRIP_DAYS
  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: 'var(--page-pv-center) var(--page-gutter)', textAlign: 'center' }}>
      <img src={MASCOT.think} alt="" width={150} height={150} style={{ width: 150, height: 'auto', margin: '0 auto 14px', display: 'block', animation: 'dc-float 1.6s ease-in-out infinite' }} />
      <div style={{ width: 44, height: 44, borderRadius: '50%', border: '4px solid #C8E6C9', borderTopColor: '#2E7D32', margin: '0 auto 22px', animation: 'dc-spin 0.9s linear infinite' }}></div>
      <h2 data-font="culture" style={{ fontSize: 19, fontWeight: 800, color: '#1B5E20', margin: '0 0 8px' }}>น้องไดโนกำลังจัดแผนการเดินทางให้คุณ...</h2>
      <p style={{ color: '#5f6a63', fontSize: 14 }}>กำลังวิเคราะห์ความสนใจ งบประมาณ และเวลาที่เหมาะสม</p>
      {longTrip && (
        <p style={{ color: '#2E7D32', fontSize: 13.5, fontWeight: 700, marginTop: 10 }}>ทริปหลายวันอาจใช้เวลาประมาณ 1–2 นาที อย่าเพิ่งปิดหน้านี้นะครับ</p>
      )}
    </main>
  )
}
