import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import PageControls from '../components/PageControls.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { fetchAdminEventRequests, approveEventRequest, rejectEventRequest } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { EVENT_REQUEST_STATUS } from '../data/eventRequests.js'

const STATUS_FILTERS = [
  { key: 'pending', label: 'รออนุมัติ' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'rejected', label: 'ไม่อนุมัติ' },
]
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
const chipStyle = (active) => ({
  padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? '#2E7D32' : '#DCD8C6'}`, background: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f',
})
const btn = (bg, color, border = 'none') => ({ background: bg, color, border, padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' })

function Detail({ label, children }) {
  if (!children) return null
  return <div style={{ fontSize: 13, color: '#3c463f' }}><span style={{ color: '#626863' }}>{label}: </span>{children}</div>
}

// Admin queue of event requests from users. Approving copies the request into
// the public events list; rejecting needs a reason the requester will see.
export default function EventRequestsTab() {
  const { actions } = useApp()
  const [status, setStatus] = useState('pending')
  const paged = usePagedList(fetchAdminEventRequests, { pageSize: 10, extraParams: { status } })
  const [busyId, setBusyId] = useState('')
  const [rejectingId, setRejectingId] = useState('')
  const [reason, setReason] = useState('')

  const run = async (id, fn, msg) => {
    setBusyId(id)
    try {
      await fn()
      actions.showToast(msg)
      setRejectingId('')
      setReason('')
      paged.refetch()
    } catch (err) {
      actions.reportError('ดำเนินการไม่สำเร็จ: ', err)
      paged.refetch() // e.g. 409: someone else already reviewed it
    } finally {
      setBusyId('')
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>คำขอแสดงกิจกรรม</h1>
        <span style={{ fontSize: 13, color: '#5f6a63' }}>{paged.loading ? 'กำลังโหลด...' : `${paged.total} รายการ`}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {STATUS_FILTERS.map((f) => <button key={f.key} onClick={() => setStatus(f.key)} style={chipStyle(status === f.key)}>{f.label}</button>)}
      </div>

      {paged.error ? (
        <LoadError message="โหลดคำขอไม่สำเร็จ" onRetry={paged.refetch} />
      ) : paged.rows.length === 0 ? (
        paged.loading ? <LoadingSpinner size={32} label="กำลังโหลดคำขอ..." /> : <EmptyState title="ไม่มีคำขอในสถานะนี้" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: paged.loading ? 0.5 : 1, transition: 'opacity 0.15s ease' }}>
          {paged.rows.map((r) => {
            const st = EVENT_REQUEST_STATUS[r.status]
            const busy = busyId === r.id
            return (
              <div key={r.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', background: '#FBF8EE' }}>
                  <div style={{ fontWeight: 800, color: '#1B5E20', fontSize: 15 }}>{r.name}</div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, background: st.bg, color: st.color, padding: '3px 10px', borderRadius: 20 }}>{st.label}</span>
                  <span style={{ fontSize: 12.5, color: '#5f6a63', marginLeft: 'auto' }}>
                    {r.requester}{r.requesterEmail ? ` (${r.requesterEmail})` : ''} · {fmtDateTime(r.createdAt)}
                  </span>
                </div>
                <div style={{ padding: '12px 16px', display: 'grid', gap: 4 }}>
                  <Detail label="หมวดหมู่">{r.category}</Detail>
                  <Detail label="วันที่จัดงาน">{r.dateRange}</Detail>
                  <Detail label="สถานที่">{r.venueName}</Detail>
                  <Detail label="ค่าเข้าชม">{r.admission}</Detail>
                  <Detail label="ผู้จัดงาน">{r.organizer}</Detail>
                  <Detail label="เหมาะสำหรับ">{r.suitableFor.join(', ')}</Detail>
                  {r.images.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0' }}>
                      {r.images.map((src) => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid #E7E3D2' }} /></a>)}
                    </div>
                  )}
                  {r.desc && <div style={{ fontSize: 13, color: '#3c463f', whiteSpace: 'pre-wrap', marginTop: 4 }}>{r.desc}</div>}
                  {r.status === 'rejected' && <div style={{ fontSize: 13, color: '#a33232', marginTop: 4 }}>เหตุผลที่ไม่อนุมัติ: {r.rejectReason}</div>}
                  {r.status === 'approved' && <div style={{ fontSize: 12.5, color: '#5f6a63', marginTop: 4 }}>อนุมัติเมื่อ {fmtDateTime(r.reviewedAt)} — แก้ไขเพิ่มเติม/เพิ่มรูปได้ที่แท็บ “กิจกรรม”</div>}

                  {r.status === 'pending' && (rejectingId === r.id ? (
                    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                      <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} placeholder="เหตุผลที่ไม่อนุมัติ (ผู้ขอจะเห็นข้อความนี้)"
                        style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, boxSizing: 'border-box' }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button disabled={busy || !reason.trim()} onClick={() => run(r.id, () => rejectEventRequest(r.id, reason.trim()), 'ปฏิเสธคำขอแล้ว')} style={{ ...btn('#a33232', '#fff'), opacity: busy || !reason.trim() ? 0.55 : 1 }}>{busy ? 'กำลังบันทึก...' : 'ยืนยันไม่อนุมัติ'}</button>
                        <button disabled={busy} onClick={() => { setRejectingId(''); setReason('') }} style={btn('#fff', '#3c463f', '1px solid #DCD8C6')}>ยกเลิก</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button disabled={!!busyId} onClick={() => run(r.id, () => approveEventRequest(r.id), 'อนุมัติแล้ว กิจกรรมแสดงบนหน้าเว็บแล้ว')} style={btn('#2E7D32', '#fff')}>{busy ? 'กำลังบันทึก...' : 'อนุมัติ'}</button>
                      <button disabled={!!busyId} onClick={() => { setRejectingId(r.id); setReason('') }} style={btn('#fdecec', '#a33232')}>ไม่อนุมัติ</button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </>
  )
}
