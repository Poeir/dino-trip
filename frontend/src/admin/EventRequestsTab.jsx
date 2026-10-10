import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { fetchAdminEventRequests, approveEventRequest, rejectEventRequest } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { fmtDateTime } from '../lib/format.js'
import { EVENT_REQUEST_STATUS } from '../data/eventRequests.js'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import { useConfirm } from './ui/ConfirmDialog.jsx'
import ReportQueueCard, { ReportQueue } from './ReportQueueCard.jsx'

const STATUS_FILTERS = [
  { key: 'pending', label: 'รออนุมัติ' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'rejected', label: 'ไม่อนุมัติ' },
]
const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'danger' }

function Detail({ label, children }) {
  if (!children) return null
  return <div className="ad-fs-sm"><span className="ad-text-muted">{label}: </span>{children}</div>
}

// Admin queue of event requests from users. Approving copies the request into
// the public events list; rejecting needs a reason the requester will see.
export default function EventRequestsTab() {
  const { actions } = useApp()
  const [status, setStatus] = useState('pending')
  const paged = usePagedList(fetchAdminEventRequests, { pageSize: 10, extraParams: { status } })
  const [busyId, setBusyId] = useState('')
  const { confirm, confirmDialog } = useConfirm()

  const run = async (id, fn, msg) => {
    setBusyId(id)
    try {
      await fn()
      actions.showToast(msg)
      paged.refetch()
    } catch (err) {
      actions.reportError('ดำเนินการไม่สำเร็จ: ', err)
      paged.refetch() // e.g. 409: someone else already reviewed it
    } finally {
      setBusyId('')
    }
  }

  const reject = async (r) => {
    const res = await confirm({
      title: 'ไม่อนุมัติคำขอนี้?',
      message: `“${r.name}” จะถูกปฏิเสธ และผู้ขอจะเห็นเหตุผลที่ระบุไว้ด้านล่าง`,
      confirmLabel: 'ยืนยันไม่อนุมัติ',
      danger: true,
      reason: 'required',
      reasonLabel: 'เหตุผลที่ไม่อนุมัติ (ผู้ขอจะเห็นข้อความนี้)',
    })
    if (res) run(r.id, () => rejectEventRequest(r.id, res.reason), 'ปฏิเสธคำขอแล้ว')
  }

  return (
    <>
      <ReportQueue
        title="คำขอแสดงกิจกรรม"
        countText={`${paged.total} รายการ`}
        filters={STATUS_FILTERS}
        status={status}
        onStatus={setStatus}
        paged={paged}
        errorText="โหลดคำขอไม่สำเร็จ"
        emptyText="ไม่มีคำขอในสถานะนี้"
      >
        {paged.rows.map((r) => {
          const st = EVENT_REQUEST_STATUS[r.status]
          const busy = busyId === r.id
          return (
            <ReportQueueCard
              key={r.id}
              title={r.name}
              badges={<Badge tone={STATUS_TONE[r.status]}>{st.label}</Badge>}
              meta={<span className="ad-card__meta ad-card__push">{r.requester}{r.requesterEmail ? ` (${r.requesterEmail})` : ''} · {fmtDateTime(r.createdAt)}</span>}
            >
              <div className="ad-card__body">
                <Detail label="หมวดหมู่">{r.category}</Detail>
                <Detail label="วันที่จัดงาน">{r.dateRange}</Detail>
                <Detail label="สถานที่">{r.venueName}</Detail>
                <Detail label="ค่าเข้าชม">{r.admission}</Detail>
                <Detail label="ผู้จัดงาน">{r.organizer}</Detail>
                <Detail label="เหมาะสำหรับ">{r.suitableFor.join(', ')}</Detail>
                {r.images.length > 0 && (
                  <div className="ad-thumbs">
                    {r.images.map((src) => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="รูปประกอบคำขอ" /></a>)}
                  </div>
                )}
                {r.desc && <div className="ad-fs-sm ad-pre">{r.desc}</div>}
                {r.status === 'rejected' && <div className="ad-fs-sm ad-text-danger">เหตุผลที่ไม่อนุมัติ: {r.rejectReason}</div>}
                {r.status === 'approved' && <div className="ad-fs-xs ad-text-muted">อนุมัติเมื่อ {fmtDateTime(r.reviewedAt)} — แก้ไขเพิ่มเติม/เพิ่มรูปได้ที่แท็บ “กิจกรรม”</div>}

                {r.status === 'pending' && (
                  <div className="ad-actions ad-actions--top">
                    <Button disabled={!!busyId} loading={busy} onClick={() => run(r.id, () => approveEventRequest(r.id), 'อนุมัติแล้ว กิจกรรมแสดงบนหน้าเว็บแล้ว')}>{busy ? 'กำลังบันทึก...' : 'อนุมัติ'}</Button>
                    <Button variant="dangersoft" disabled={!!busyId} onClick={() => reject(r)}>ไม่อนุมัติ</Button>
                  </div>
                )}
              </div>
            </ReportQueueCard>
          )
        })}
      </ReportQueue>
      {confirmDialog}
    </>
  )
}
