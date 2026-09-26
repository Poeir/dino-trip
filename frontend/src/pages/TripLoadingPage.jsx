import { MASCOT } from '../data/categoryImages.js'

export default function TripLoadingPage() {
  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: '120px 32px', textAlign: 'center' }}>
      <img src={MASCOT.think} alt="" style={{ width: 150, height: 'auto', margin: '0 auto 14px', display: 'block', animation: 'dc-float 1.6s ease-in-out infinite' }} />
      <div style={{ width: 44, height: 44, borderRadius: '50%', border: '4px solid #C8E6C9', borderTopColor: '#2E7D32', margin: '0 auto 22px', animation: 'dc-spin 0.9s linear infinite' }}></div>
      <h2 data-font="culture" style={{ fontSize: 19, fontWeight: 800, color: '#1B5E20', margin: '0 0 8px' }}>น้องไดโนกำลังจัดแผนการเดินทางให้คุณ...</h2>
      <p style={{ color: '#6d7a72', fontSize: 14 }}>กำลังวิเคราะห์ความสนใจ งบประมาณ และเวลาที่เหมาะสม</p>
    </main>
  )
}
