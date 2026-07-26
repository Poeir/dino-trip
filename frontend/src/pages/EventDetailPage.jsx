import { useApp } from '../context/AppContext.jsx'
import EventDetailView from '../components/EventDetailView.jsx'

export default function EventDetailPage() {
  const { actions, derived } = useApp()
  const ev = derived.selectedEvent
  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 32px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#8a938c', flexWrap: 'wrap' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); actions.goHome() }} style={{ color: '#8a938c', fontWeight: 600 }}>หน้าแรก</a>
        <span>/</span>
        <a href="#" onClick={(e) => { e.preventDefault(); actions.goEvents() }} style={{ color: '#8a938c', fontWeight: 600 }}>กิจกรรม &amp; เทศกาล</a>
        <span>/</span>
        <span style={{ color: '#1B5E20', fontWeight: 700 }}>{ev.name}</span>
      </div>
      <div style={{ marginTop: 16 }}>
        <EventDetailView event={ev} />
      </div>
    </main>
  )
}
