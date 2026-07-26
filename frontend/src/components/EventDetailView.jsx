import ImageSlot from './ImageSlot.jsx'

export default function EventDetailView({ event: ev, imageHeight = 460 }) {
  if (!ev || !ev.id) return null
  return (
    <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 22, padding: 32, boxShadow: '0 14px 34px rgba(46,125,50,0.08)' }}>
      <div data-role="event-detail-grid" style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 32, alignItems: 'start' }}>
        <div data-role="place-detail-media" style={{ position: 'sticky', top: 88 }}>
          <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, color: '#E07B39', background: '#FDEEE3', padding: '4px 12px', borderRadius: 10, marginBottom: 10 }}>{ev.category}</span>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B5E20', margin: '0 0 16px', lineHeight: 1.3 }}>{ev.name}</h1>
          <div style={{ borderRadius: 16, overflow: 'hidden' }}>
            <ImageSlot src={ev.img} shape="rect" style={{ width: '100%', height: imageHeight }} placeholder="ภาพปกงาน" />
          </div>
          <button style={{ width: '100%', marginTop: 20, background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '12px 26px', borderRadius: 22, fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}>ดูช่องทางซื้อบัตร</button>
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
          <ImageSlot shape="rounded" radius={12} style={{ width: '100%', height: 160 }} placeholder="แผนที่สถานที่จัดงาน" />
        </div>
      </div>
    </div>
  )
}
