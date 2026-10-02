import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from './ImageSlot.jsx'
import ReportEventModal from './ReportEventModal.jsx'
import { EVENT_ICON, MAP_ICON } from '../data/categoryImages.js'

export default function EventDetailView({ event: ev, place, imageHeight = 460 }) {
  const { state, actions } = useApp()
  const [reportOpen, setReportOpen] = useState(false)
  if (!ev || !ev.id) return null
  // Reports need an account (spam is attributable); send visitors to log in.
  const handleReport = () => {
    if (!state.loggedIn) { actions.showToast('กรุณาเข้าสู่ระบบก่อนแจ้งข้อมูลไม่ถูกต้อง'); actions.goLogin(); return }
    setReportOpen(true)
  }
  // Mirrors PlaceDetailView.jsx's own mapEmbedSrc: prefers the linked
  // place's coordinates (set via PlacesTab/EventsTab's LocationPicker), and
  // falls back to a text query on the venue name so events at a venue with
  // no registered place (or predating the placeId link) still get a map.
  const mapQuery = place?.location ? `${place.location.lat},${place.location.lng}` : (ev.venueName || null)
  const mapEmbedSrc = mapQuery ? `https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=15&output=embed` : null
  return (
    <div data-role="detail-card" style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 22, padding: 32, boxShadow: '0 14px 34px rgba(46,125,50,0.08)' }}>
      {/* At the root, not inside the sticky media column (a sticky element traps the modal's z-index). */}
      <ReportEventModal open={reportOpen} onClose={() => setReportOpen(false)} event={ev} />
      <div data-role="event-detail-grid" style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 32, alignItems: 'start' }}>
        <div data-role="place-detail-media" style={{ position: 'sticky', top: 88 }}>
          <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, color: '#E07B39', background: '#FDEEE3', padding: '4px 12px', borderRadius: 10, marginBottom: 10 }}>{ev.category}</span>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B5E20', margin: '0 0 16px', lineHeight: 1.3 }}>{ev.name}</h1>
          <div style={{ borderRadius: 16, overflow: 'hidden' }}>
            <ImageSlot src={ev.img} shape="rect" style={{ width: '100%', height: imageHeight }} placeholder="ภาพปกงาน" icon={EVENT_ICON} />
          </div>
          <button onClick={handleReport} style={{ width: '100%', marginTop: 20, background: '#fff', color: '#6d7a72', border: '1px solid #DCD8C6', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>⚑ แจ้งข้อมูลไม่ถูกต้อง</button>
        </div>
        <div>
          <p style={{ fontSize: 15, lineHeight: 1.75, color: '#3c463f', margin: '0 0 24px' }}>{ev.desc}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ border: '1px solid #E7E3D2', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 300, fontSize: 12.5, color: '#8a938c', marginBottom: 4 }}>วันจัดงาน</div>
              <div style={{ fontWeight: 400, fontSize: 14.5 }}>{ev.dateRange}</div>
            </div>
            <div style={{ border: '1px solid #E7E3D2', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 300, fontSize: 12.5, color: '#8a938c', marginBottom: 4 }}>สถานที่จัดงาน</div>
              <div style={{ fontWeight: 400, fontSize: 14.5 }}>{ev.venueName}</div>
            </div>
            <div style={{ border: '1px solid #E7E3D2', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 300, fontSize: 12.5, color: '#8a938c', marginBottom: 4 }}>ค่าเข้าชม</div>
              <div style={{ fontWeight: 400, fontSize: 14.5 }}>{ev.admission}</div>
            </div>
            <div style={{ border: '1px solid #E7E3D2', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 300, fontSize: 12.5, color: '#8a938c', marginBottom: 4 }}>ผู้จัดงาน</div>
              <div style={{ fontWeight: 400, fontSize: 14.5 }}>{ev.organizer}</div>
            </div>
          </div>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1B5E20', marginBottom: 10 }}>เหมาะสำหรับ</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(ev.suitableFor || []).map((tag, i) => (
                <span key={i} style={{ fontSize: 13, background: '#F1F8E9', border: '1px solid #C8E6C9', padding: '5px 12px', borderRadius: 14, color: '#2E7D32' }}>{tag}</span>
              ))}
            </div>
          </div>
          {mapEmbedSrc ? (
            <iframe
              title={`แผนที่ ${ev.name}`}
              src={mapEmbedSrc}
              width="100%"
              height={280}
              style={{ border: 0, borderRadius: 16, display: 'block' }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          ) : (
            <ImageSlot shape="rounded" radius={12} style={{ width: '100%', height: 160 }} placeholder="แผนที่สถานที่จัดงาน" icon={MAP_ICON} />
          )}
        </div>
      </div>
    </div>
  )
}
