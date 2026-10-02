import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import PageControls from '../components/PageControls.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { fetchAdminEventReports, resolveAdminEventReports, fetchEvent } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { EVENT_REPORT_FIELD_LABEL } from '../data/eventReports.js'

const STATUS_FILTERS = [
  { key: 'pending', label: 'รอตรวจสอบ' },
  { key: 'resolved', label: 'จัดการแล้ว' },
  { key: 'rejected', label: 'ปฏิเสธ' },
]
const RESOLUTION_LABEL = { edited: 'แก้ไขเอง', no_change: 'ไม่ต้องแก้ไข' }
const EVENT_STATUS_LABEL = { upcoming: 'เร็วๆ นี้', published: 'เผยแพร่แล้ว', cancelled: 'ยกเลิก' }

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
const chipStyle = (active) => ({
  padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? '#2E7D32' : '#DCD8C6'}`, background: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f',
})
const btn = (bg, color, border = 'none') => ({ background: bg, color, border, padding: '7px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' })

function Badge({ children, bg, color }) {
  return <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, background: bg, color, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{children}</span>
}

// Admin queue for events: reports grouped per event, then per field. There is
// no external source to sync from, so the admin either edits the event (which
// closes the matching reports itself) or dismisses the report.
export default function EventReportsPanel() {
  const { actions } = useApp()
  const navigate = useNavigate()
  const [status, setStatus] = useState('pending')
  const paged = usePagedList(fetchAdminEventReports, { pageSize: 10, extraParams: { status } })
  const [busyKey, setBusyKey] = useState('')

  const resolve = async (g, field, body, msg) => {
    setBusyKey(`${g.event.id}:${field}`)
    try {
      await resolveAdminEventReports({ eventId: g.event.id, field, ...body })
      actions.showToast(msg)
      paged.refetch()
    } catch (err) {
      actions.reportError('ดำเนินการไม่สำเร็จ: ', err)
    } finally {
      setBusyKey('')
    }
  }

  const openEdit = async (eventId) => {
    try {
      actions.openEditForm('event', await fetchEvent(eventId))
      navigate('/admin/events')
    } catch (err) {
      actions.reportError('เปิดหน้าแก้ไขไม่สำเร็จ: ', err)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>รายงานข้อมูลอีเวนต์</h1>
        <span style={{ fontSize: 13, color: '#6d7a72' }}>{paged.loading ? 'กำลังโหลด...' : `${paged.total} อีเวนต์`}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {STATUS_FILTERS.map((f) => <button key={f.key} onClick={() => setStatus(f.key)} style={chipStyle(status === f.key)}>{f.label}</button>)}
      </div>

      {paged.error ? (
        <LoadError message="โหลดรายงานไม่สำเร็จ" onRetry={paged.refetch} />
      ) : paged.rows.length === 0 ? (
        paged.loading ? <LoadingSpinner size={32} label="กำลังโหลดรายงาน..." /> : <EmptyState title="ไม่มีรายงานในสถานะนี้" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: paged.loading ? 0.5 : 1, transition: 'opacity 0.15s ease' }}>
          {paged.rows.map((g) => {
            if (!g.event) return null
            return (
              <div key={g.event.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', background: '#FBF8EE' }}>
                  <div style={{ fontWeight: 800, color: '#1B5E20', fontSize: 15 }}>{g.event.name}</div>
                  {g.event.dateRange && <span style={{ fontSize: 12.5, color: '#6d7a72' }}>{g.event.dateRange}</span>}
                  {g.event.venueName && <span style={{ fontSize: 12.5, color: '#6d7a72' }}>· {g.event.venueName}</span>}
                  {g.event.status === 'cancelled' && <Badge bg="#fdecec" color="#a33232">{EVENT_STATUS_LABEL.cancelled}</Badge>}
                  <button onClick={() => openEdit(g.event.id)} style={{ ...btn('#E8F5E9', '#2E7D32'), marginLeft: 'auto' }}>เปิดหน้าแก้ไข</button>
                </div>

                {Object.entries(g.fields).map(([field, count]) => {
                  const reports = g.reports.filter((r) => r.field === field)
                  const busy = busyKey === `${g.event.id}:${field}`
                  return (
                    <div key={field} style={{ padding: '12px 16px', borderTop: '1px solid #EFEBDB' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: '#1f2a24' }}>{EVENT_REPORT_FIELD_LABEL[field]}</span>
                        <Badge bg={count >= 3 ? '#fdecec' : '#FFF8E1'} color={count >= 3 ? '#a33232' : '#7A5205'}>{count} คนรายงาน</Badge>
                      </div>
                      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13, color: '#3c463f' }}>
                        {reports.map((r) => (
                          <li key={r.id}>
                            {r.note ? `“${r.note}”` : <span style={{ color: '#a3ab9e' }}>(ไม่มีหมายเหตุ)</span>}
                            <span style={{ color: '#8a938c' }}> — {r.reporter}, {fmtDateTime(r.createdAt)}{r.resolution ? ` · ${RESOLUTION_LABEL[r.resolution]}` : ''}</span>
                          </li>
                        ))}
                      </ul>
                      {status === 'pending' && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button disabled={!!busyKey} onClick={() => resolve(g, field, { status: 'resolved', resolution: 'no_change' }, 'ปิดรายงาน: ข้อมูลถูกต้องแล้ว')} style={btn('#fff', '#3c463f', '1px solid #DCD8C6')}>{busy ? 'กำลังบันทึก...' : 'ข้อมูลถูกต้องแล้ว'}</button>
                          <button disabled={!!busyKey} onClick={() => resolve(g, field, { status: 'rejected' }, 'ปฏิเสธรายงานแล้ว')} style={btn('#fdecec', '#a33232')}>ปฏิเสธ</button>
                          {['photos', 'other'].includes(field) && (
                            <button disabled={!!busyKey} onClick={() => resolve(g, field, { status: 'resolved', resolution: 'edited' }, 'ปิดรายงานแล้ว (แก้ไขเรียบร้อย)')} style={btn('#E8F5E9', '#2E7D32')}>แก้ไขเรียบร้อยแล้ว</button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </>
  )
}
