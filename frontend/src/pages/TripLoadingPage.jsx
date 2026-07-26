export default function TripLoadingPage() {
  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: '120px 32px', textAlign: 'center' }}>
      <img src="./assets/dino-mascot-front.png" alt="" style={{ width: 110, height: 'auto', margin: '0 auto 18px', display: 'block', animation: 'dc-float 1.6s ease-in-out infinite' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
      <div style={{ width: 44, height: 44, borderRadius: '50%', border: '4px solid #C8E6C9', borderTopColor: '#2E7D32', margin: '0 auto 22px', animation: 'dc-spin 0.9s linear infinite' }}></div>
      <h2 data-font="culture" style={{ fontSize: 19, fontWeight: 800, color: '#1B5E20', margin: '0 0 8px' }}>น้องไดโนกำลังจัดแผนการเดินทางให้คุณ...</h2>
      <p style={{ color: '#6d7a72', fontSize: 14 }}>กำลังวิเคราะห์ความสนใจ งบประมาณ และเวลาที่เหมาะสม</p>
    </main>
  )
}
