import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'

export default function EventsListPage() {
  const { derived } = useApp()
  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '36px 32px 60px' }}>
      <h1 data-font="culture" style={{ fontSize: 27, fontWeight: 800, color: '#1B5E20', margin: '0 0 6px' }}>กิจกรรมและเทศกาลทั้งหมด</h1>
      <p style={{ color: '#6d7a72', fontSize: 14, margin: '0 0 26px' }}>อัปเดตงานเทศกาล คอนเสิร์ต และกิจกรรมพิเศษทั่วขอนแก่น</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 24 }}>
        {derived.eventsView.map((event) => (
          <div key={event.id} onClick={event.onOpen} style={{ display: 'flex', flexDirection: 'column', height: 320, background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.22s ease,box-shadow 0.22s ease', animation: 'dc-fade-up 0.4s ease both' }}>
            <ImageSlot src={event.img} shape="rect" style={{ width: '100%', height: 170, flexShrink: 0 }} placeholder="ภาพงาน" />
            <div style={{ padding: 16, flex: 1, overflow: 'hidden' }}>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#E07B39', marginBottom: 12 }}>{event.category}</span>
              <div style={{ fontWeight: 400, fontSize: 16, color: '#1f2a24', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.name}</div>
              <div style={{ fontWeight: 300, fontSize: 13, color: '#6d7a72', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.dateRange}</div>
              <div style={{ fontWeight: 300, fontSize: 12.5, color: '#8a938c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.venueName}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
