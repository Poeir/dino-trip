import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { fetchAdminEventReports, resolveAdminEventReports, fetchEvent } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { EVENT_REPORT_FIELD_LABEL } from '../data/eventReports.js'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import ReportQueueCard, { ReportQueue, ReportFieldSection } from './ReportQueueCard.jsx'

const STATUS_FILTERS = [
  { key: 'pending', label: 'รอตรวจสอบ' },
  { key: 'resolved', label: 'จัดการแล้ว' },
  { key: 'rejected', label: 'ปฏิเสธ' },
]
const RESOLUTION_LABEL = { edited: 'แก้ไขเอง', no_change: 'ไม่ต้องแก้ไข' }
const EVENT_STATUS_LABEL = { upcoming: 'เร็วๆ นี้', published: 'เผยแพร่แล้ว', cancelled: 'ยกเลิก' }

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
    <ReportQueue
      title="รายงานข้อมูลกิจกรรม"
      countText={`${paged.total} กิจกรรม`}
      filters={STATUS_FILTERS}
      status={status}
      onStatus={setStatus}
      paged={paged}
      errorText="โหลดรายงานไม่สำเร็จ"
      emptyText="ไม่มีรายงานในสถานะนี้"
    >
      {paged.rows.map((g) => {
        if (!g.event) return null
        return (
          <ReportQueueCard
            key={g.event.id}
            title={g.event.name}
            meta={(
              <>
                {g.event.dateRange && <span className="ad-card__meta">{g.event.dateRange}</span>}
                {g.event.venueName && <span className="ad-card__meta">· {g.event.venueName}</span>}
                {g.event.status === 'cancelled' && <Badge tone="danger">{EVENT_STATUS_LABEL.cancelled}</Badge>}
              </>
            )}
            actions={<Button variant="soft" size="sm" onClick={() => openEdit(g.event.id)}><Pencil size={13} aria-hidden="true" />เปิดหน้าแก้ไข</Button>}
          >
            {Object.entries(g.fields).map(([field, count]) => {
              const reports = g.reports.filter((r) => r.field === field)
              const busy = busyKey === `${g.event.id}:${field}`
              return (
                <ReportFieldSection
                  key={field}
                  label={EVENT_REPORT_FIELD_LABEL[field]}
                  badges={<Badge tone={count >= 3 ? 'danger' : 'warning'}>{count} คนรายงาน</Badge>}
                  reports={reports}
                  resolutionLabel={RESOLUTION_LABEL}
                  actions={status === 'pending' && (
                    <>
                      <Button size="sm" variant="secondary" disabled={!!busyKey} loading={busy} onClick={() => resolve(g, field, { status: 'resolved', resolution: 'no_change' }, 'ปิดรายงาน: ข้อมูลถูกต้องแล้ว')}>{busy ? 'กำลังบันทึก...' : 'ข้อมูลถูกต้องแล้ว'}</Button>
                      <Button size="sm" variant="dangersoft" disabled={!!busyKey} onClick={() => resolve(g, field, { status: 'rejected' }, 'ปฏิเสธรายงานแล้ว')}>ปฏิเสธ</Button>
                      {['photos', 'other'].includes(field) && (
                        <Button size="sm" variant="soft" disabled={!!busyKey} onClick={() => resolve(g, field, { status: 'resolved', resolution: 'edited' }, 'ปิดรายงานแล้ว (แก้ไขเรียบร้อย)')}>แก้ไขเรียบร้อยแล้ว</Button>
                      )}
                    </>
                  )}
                />
              )
            })}
          </ReportQueueCard>
        )
      })}
    </ReportQueue>
  )
}
