import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import PageControls from '../components/PageControls.jsx'
import { fetchEvents } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'

export default function EventsListPage() {
  const { state, actions } = useApp()

  // Debounced so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(state.eventSearchQuery)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(state.eventSearchQuery), 300)
    return () => clearTimeout(t)
  }, [state.eventSearchQuery])

  const paged = usePagedList(fetchEvents, {
    pageSize: 24,
    extraParams: { search: debouncedSearch || undefined },
  })

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '36px 32px 60px' }}>
      <h1 data-font="culture" style={{ fontSize: 27, fontWeight: 800, color: '#1B5E20', margin: '0 0 6px' }}>กิจกรรมและเทศกาลทั้งหมด</h1>
      <p style={{ color: '#6d7a72', fontSize: 14, margin: '0 0 26px' }}>อัปเดตงานเทศกาล คอนเสิร์ต และกิจกรรมพิเศษทั่วขอนแก่น</p>
      <input
        value={state.eventSearchQuery}
        onChange={actions.onEventSearchChange}
        placeholder="ค้นหากิจกรรม..."
        style={{ width: '100%', maxWidth: 420, border: '1px solid #DCD8C6', borderRadius: 20, padding: '10px 18px', fontSize: 14, marginBottom: 22, display: 'block' }}
      />
      {paged.loading && paged.rows.length === 0 && <LoadingSpinner size={36} label="กำลังโหลดกิจกรรม..." />}
      {!paged.loading && paged.rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed #C8E6C9', borderRadius: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#3c463f', marginBottom: 4 }}>ไม่พบกิจกรรมที่ตรงกับการค้นหา</div>
          <div style={{ fontSize: 13, color: '#8a938c' }}>ลองค้นหาด้วยคำอื่น</div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 24 }}>
        {paged.rows.map((event) => (
          <div key={event.id} onClick={() => actions.openEvent(event.id)} style={{ display: 'flex', flexDirection: 'column', height: 320, background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.22s ease,box-shadow 0.22s ease', animation: 'dc-fade-up 0.4s ease both' }}>
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
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </main>
  )
}
