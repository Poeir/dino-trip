import { useApp } from '../context/AppContext.jsx'

export default function MobileMenu() {
  const { state, actions, derived } = useApp()
  if (!state.mobileMenuOpen) return null
  return (
    <div style={{ position: 'sticky', top: 68, zIndex: 39, background: '#fff', borderBottom: '1px solid #E7E3D2', display: 'flex', flexDirection: 'column', padding: '10px 24px 18px', gap: 4, animation: 'dc-fade-up 0.25s ease both' }}>
      <a href="#" onClick={(e) => { e.preventDefault(); actions.goHome() }} style={{ padding: '12px 4px', fontSize: 15, fontWeight: 700, color: derived.navHomeColor, borderBottom: '1px solid #F0EDE0' }}>หน้าแรก</a>
      <a href="#" onClick={(e) => { e.preventDefault(); actions.goPlaces() }} style={{ padding: '12px 4px', fontSize: 15, fontWeight: 700, color: derived.navPlacesColor, borderBottom: '1px solid #F0EDE0' }}>สถานที่ท่องเที่ยว</a>
      <a href="#" onClick={(e) => { e.preventDefault(); actions.goEvents() }} style={{ padding: '12px 4px', fontSize: 15, fontWeight: 700, color: derived.navEventsColor, borderBottom: '1px solid #F0EDE0' }}>กิจกรรม &amp; เทศกาล</a>
      <a href="#" onClick={(e) => { e.preventDefault(); actions.goTripForm() }} style={{ padding: '12px 4px', fontSize: 15, fontWeight: 700, color: derived.navTripColor, borderBottom: '1px solid #F0EDE0' }}>วางแผนทริป AI</a>
      <a href="#" onClick={(e) => { e.preventDefault(); actions.goPoints() }} style={{ padding: '12px 4px', fontSize: 15, fontWeight: 700, color: derived.navPointsColor, borderBottom: '1px solid #F0EDE0' }}>พอยท์สะสม</a>
      {!state.loggedIn && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); actions.goLogin() }} style={{ flex: 1, textAlign: 'center', padding: 11, border: '1px solid #DCD8C6', borderRadius: 16, fontSize: 14, fontWeight: 700, color: '#1f2a24' }}>เข้าสู่ระบบ</a>
          <button onClick={actions.goSignup} style={{ flex: 1, background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 11, borderRadius: 16, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>สมัครสมาชิก</button>
        </div>
      )}
    </div>
  )
}
