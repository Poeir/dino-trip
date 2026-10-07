import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import PageControls from '../components/PageControls.jsx'
import FilterPill from '../components/FilterPill.jsx'
import { fetchEvents } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { useSeo } from '../lib/useSeo.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LoadError from '../components/LoadError.jsx'
import { EVENT_ICON, MASCOT } from '../data/categoryImages.js'

const STATUS_OPTIONS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'ongoing', label: 'กำลังจัดอยู่' },
  { value: 'upcoming', label: 'เร็วๆ นี้' },
  { value: 'ended', label: 'จบแล้ว' },
  { value: 'cancelled', label: 'ยกเลิก' },
]
const STATUS_STYLE = {
  ongoing: { bg: 'var(--s-ongoing-bg)', color: 'var(--s-ongoing-fg)' },
  upcoming: { bg: 'var(--s-upcoming-bg)', color: 'var(--s-upcoming-fg)' },
  ended: { bg: 'var(--s-ended-bg)', color: 'var(--s-ended-fg)' },
  cancelled: { bg: 'var(--s-cancelled-bg)', color: 'var(--s-cancelled-fg)' },
}
const MAX_TAGS = 3

export default function EventsListPage() {
  const { state, actions } = useApp()
  useSeo({
    title: 'กิจกรรมและเทศกาลในขอนแก่น',
    description: 'ตารางงานเทศกาล กิจกรรม และอีเวนต์ในขอนแก่น ทั้งที่กำลังจัดอยู่และเร็ว ๆ นี้ พร้อมวันที่ สถานที่ และค่าเข้าชม',
    path: '/events',
  })
  const [status, setStatus] = useState('')

  // Debounced so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(state.eventSearchQuery)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(state.eventSearchQuery), 300)
    return () => clearTimeout(t)
  }, [state.eventSearchQuery])

  const paged = usePagedList(fetchEvents, {
    pageSize: 24,
    extraParams: { search: debouncedSearch || undefined, status: status || undefined },
  })

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: 'var(--page-pt) var(--page-gutter) var(--page-pb)' }}>
      <h1 data-font="culture" style={{ fontSize: 27, fontWeight: 800, color: '#1B5E20', margin: '0 0 6px' }}>กิจกรรมและเทศกาลทั้งหมด</h1>
      <p style={{ color: '#5f6a63', fontSize: 14, margin: '0 0 26px' }}>อัปเดตงานเทศกาล คอนเสิร์ต และกิจกรรมพิเศษทั่วขอนแก่น</p>
      <input
        value={state.eventSearchQuery}
        onChange={actions.onEventSearchChange}
        placeholder="ค้นหากิจกรรม..."
        style={{ width: '100%', maxWidth: 420, border: '1px solid #DCD8C6', borderRadius: 20, padding: '10px 18px', fontSize: 14, marginBottom: 16, display: 'block' }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
        {STATUS_OPTIONS.map((o) => (
          <FilterPill key={o.value} tone={o.value} active={status === o.value} onClick={() => setStatus(o.value)}>{o.label}</FilterPill>
        ))}
      </div>
      {paged.loading && paged.rows.length === 0 && <LoadingSpinner size={36} label="กำลังโหลดกิจกรรม..." />}
      {paged.error && <LoadError message="โหลดรายการกิจกรรมไม่สำเร็จ" onRetry={paged.refetch} />}
      {!paged.loading && !paged.error && paged.rows.length === 0 && (
        <EmptyState mascot={MASCOT.sad} tone="green" style={{ padding: '56px 20px' }} title="ไม่พบกิจกรรมที่ตรงกับการค้นหา" desc="ลองค้นหาด้วยคำอื่น" />
      )}
      <div data-role="card-grid" style={{ display: paged.error ? 'none' : 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 24 }}>
        {paged.rows.map((event) => (
          <div key={event.id} onClick={() => actions.openEvent(event.id)} style={{ display: 'flex', flexDirection: 'column', height: 320, background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.22s ease,box-shadow 0.22s ease', animation: 'dc-fade-up 0.4s ease both' }}>
            <ImageSlot src={event.img} shape="rect" style={{ width: '100%', height: 170, flexShrink: 0 }} placeholder="ภาพงาน" icon={EVENT_ICON} />
            <div style={{ padding: 16, flex: 1, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#9b5527' }}>{event.category}</span>
                {STATUS_STYLE[event.timeStatus] && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: STATUS_STYLE[event.timeStatus].bg, color: STATUS_STYLE[event.timeStatus].color, whiteSpace: 'nowrap' }}>
                    {STATUS_OPTIONS.find((o) => o.value === event.timeStatus)?.label}
                  </span>
                )}
              </div>
              <div style={{ fontWeight: 400, fontSize: 16, color: '#1f2a24', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.name}</div>
              <div style={{ fontWeight: 300, fontSize: 13, color: '#5f6a63', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.dateRange}</div>
              <div style={{ fontWeight: 300, fontSize: 12.5, color: '#626863', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.venueName}</div>
              {event.suitableFor?.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, maxHeight: 24, overflow: 'hidden' }}>
                  {event.suitableFor.slice(0, MAX_TAGS).map((t) => (
                    <span key={t} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#F1EFE4', color: '#5b6a60', whiteSpace: 'nowrap' }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </main>
  )
}
