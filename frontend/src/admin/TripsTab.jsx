import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import PageControls from '../components/PageControls.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { fetchAdminTrips, fetchAdminTrip, deleteAdminTrip } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'

const OWNER_FILTERS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'user', label: 'เข้าสู่ระบบ' },
  { key: 'anonymous', label: 'ไม่ได้เข้าสู่ระบบ' },
]
const CLOSED_LABEL = { CLOSED_PERMANENTLY: 'ปิดถาวร', CLOSED_TEMPORARILY: 'ปิดชั่วคราว' }

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '-')
const fmtRange = (t) => {
  if (t.dayCount <= 1) return fmtDate(t.startDate)
  const end = new Date(`${t.startDate}T00:00:00`)
  end.setDate(end.getDate() + t.dayCount - 1)
  return `${fmtDate(t.startDate)} – ${end.toLocaleDateString('th-TH', { dateStyle: 'medium' })}`
}

const chipStyle = (active) => ({
  padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? '#2E7D32' : '#DCD8C6'}`, background: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f',
})
const btn = (bg, color, border = 'none') => ({ background: bg, color, border, padding: '8px 14px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer' })

function Badge({ children, bg, color }) {
  return <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, background: bg, color, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{children}</span>
}

const OwnerBadge = ({ owner }) => owner
  ? <Badge bg="#E8F5E9" color="#2E7D32">เข้าสู่ระบบ</Badge>
  : <Badge bg="#f3f3f0" color="#6d7a72">ไม่ได้เข้าสู่ระบบ</Badge>

// What (if anything) is wrong with a stop's place today.
function placeIssue(item) {
  if (item.kind !== 'place') return null
  if (!item.place) return 'ถูกลบออกจากระบบแล้ว'
  if (item.place.isActive === false) return 'ถูกปิดการแสดงผล'
  return CLOSED_LABEL[item.place.businessStatus] || null
}

function InfoRow({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: '#8a938c', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#1f2a24', overflowWrap: 'anywhere' }}>{children || '-'}</div>
    </div>
  )
}

function TripDetail({ trip }) {
  const input = trip.input || {}
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <OwnerBadge owner={trip.owner} />
        {trip.owner && <span style={{ fontSize: 13.5, color: '#3c463f' }}>{trip.owner.name}{trip.owner.email && trip.owner.email !== trip.owner.name ? ` · ${trip.owner.email}` : ''}{trip.owner.deleted ? ' (บัญชีถูกลบ)' : ''}</span>}
        {trip.isFavorite && <Badge bg="#FFF8E1" color="#7A5205">★ ติดดาว</Badge>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: '14px 20px', marginBottom: 20 }}>
        <InfoRow label="วันที่เดินทาง">{fmtRange(trip)} ({trip.dayCount} วัน)</InfoRow>
        <InfoRow label="ช่วงเวลาต่อวัน">{input.start_time && input.end_time ? `${input.start_time} – ${input.end_time}` : null}</InfoRow>
        <InfoRow label="งบประมาณ">{input.budget_level}</InfoRow>
        <InfoRow label="จังหวะการเที่ยว">{input.trip_pace}</InfoRow>
        <InfoRow label="ขอบเขตพื้นที่">{input.area_scope}</InfoRow>
        <InfoRow label="ความสนใจ">{(input.interests || []).join(', ')}</InfoRow>
        <InfoRow label="ต้องไปแน่ๆ">{(input.must_go || []).join(', ')}</InfoRow>
        <InfoRow label="ที่พัก">{input.accommodation_name}</InfoRow>
        <InfoRow label="ระยะทางรวม">{trip.totalDistanceKm} กม.</InfoRow>
        <InfoRow label="ค่าใช้จ่ายโดยประมาณ">฿{Math.round(trip.totalCostEstimate).toLocaleString('th-TH')}</InfoRow>
        <InfoRow label="สร้างเมื่อ">{fmtDateTime(trip.createdAt)}</InfoRow>
        <InfoRow label="แก้ไขล่าสุด">{fmtDateTime(trip.updatedAt)}</InfoRow>
      </div>

      {trip.note && <div style={{ background: '#FBF8EE', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#3c463f', marginBottom: 16, overflowWrap: 'anywhere' }}>{trip.note}</div>}

      {trip.days.map((d) => (
        <div key={d.dayNo} style={{ border: '1px solid #EFEBDB', borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ background: '#FBF8EE', padding: '8px 14px', fontSize: 13, fontWeight: 700, color: '#1B5E20' }}>วันที่ {d.dayNo} · {fmtDate(d.date)}</div>
          {d.items.map((it) => {
            const issue = placeIssue(it)
            return (
              <div key={it.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 14px', borderTop: '1px solid #EFEBDB', fontSize: 13.5 }}>
                <span style={{ width: 92, color: '#2E7D32', fontWeight: 700, flexShrink: 0 }}>{it.arrivalTime}{it.departureTime !== it.arrivalTime ? ` – ${it.departureTime}` : ''}</span>
                <span style={{ flex: 1, minWidth: 140, color: '#1f2a24' }}>{it.place?.name || it.placeName}</span>
                {it.kind === 'hotel' && <Badge bg="#f3f3f0" color="#6d7a72">กลับที่พัก</Badge>}
                {it.kind === 'free_time' && <Badge bg="#f3f3f0" color="#6d7a72">เวลาว่าง</Badge>}
                {issue && <Badge bg="#fdecec" color="#a33232">⚠ {issue}</Badge>}
                {it.liked === true && <Badge bg="#E8F5E9" color="#2E7D32">ถูกใจ</Badge>}
                {it.liked === false && <Badge bg="#fdecec" color="#a33232">ไม่ถูกใจ</Badge>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export default function TripsTab() {
  const { actions } = useApp()
  const [owner, setOwner] = useState('')
  const [issueOnly, setIssueOnly] = useState(false)
  const paged = usePagedList(fetchAdminTrips, { pageSize: 20, extraParams: { owner: owner || undefined, issue: issueOnly ? '1' : undefined } })

  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const loadDetail = async (id) => {
    setDetail(null)
    setDetailError(false)
    try {
      setDetail(await fetchAdminTrip(id))
    } catch (err) {
      if (!actions.handleSessionExpired(err)) setDetailError(true)
    }
  }
  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const closeDetail = () => { setSelectedId(null); setDetail(null); setDeleting(false) }
  const openDelete = () => { setReason(''); setDeleteError(''); setDeleting(true) }

  const confirmDelete = async () => {
    setBusy(true)
    setDeleteError('')
    try {
      await deleteAdminTrip(detail.id, reason.trim())
      actions.showToast('ลบแผนทริปแล้ว')
      const wasOnlyRowOnPage = paged.rows.length === 1 && paged.page > 1
      closeDetail()
      if (wasOnlyRowOnPage) paged.setPage(paged.page - 1)
      paged.refetch()
    } catch (err) {
      if (actions.handleSessionExpired(err)) return
      setDeleteError(err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>ทริป</h1>
        <span style={{ fontSize: 13, color: '#6d7a72' }}>{paged.loading ? 'กำลังโหลด...' : `พบ ${paged.total} แผน`}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {OWNER_FILTERS.map((f) => <button key={f.key} onClick={() => setOwner(f.key)} style={chipStyle(owner === f.key)}>{f.label}</button>)}
        <button onClick={() => setIssueOnly((v) => !v)} aria-pressed={issueOnly} style={{ ...chipStyle(issueOnly), borderColor: issueOnly ? '#a33232' : '#DCD8C6', background: issueOnly ? '#fdecec' : '#fff', color: issueOnly ? '#a33232' : '#3c463f' }}>⚠ มีสถานที่ปิด/ถูกลบ</button>
      </div>
      <input value={paged.query} onChange={(e) => paged.setQuery(e.target.value)} placeholder="ค้นหาชื่อทริป ชื่อหรืออีเมลผู้ใช้..."
        style={{ width: '100%', maxWidth: 380, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5, marginBottom: 16, display: 'block' }} />

      {paged.error ? (
        <LoadError message="โหลดรายการทริปไม่สำเร็จ" onRetry={paged.refetch} />
      ) : paged.rows.length === 0 ? (
        paged.loading ? <LoadingSpinner size={32} label="กำลังโหลดทริป..." /> : <EmptyState title="ไม่พบแผนทริปที่ตรงกับเงื่อนไข" />
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, overflowX: 'auto', opacity: paged.loading ? 0.5 : 1, transition: 'opacity 0.15s ease' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#6d7a72', background: '#FBF8EE' }}>
                  {['ทริป', 'ผู้สร้าง', 'วันที่เดินทาง', 'สถานที่', 'ค่าใช้จ่าย', 'สร้างเมื่อ'].map((h) => <th key={h} style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((t) => (
                  <tr key={t.id} tabIndex={0} role="button" onClick={() => setSelectedId(t.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(t.id) }} style={{ borderTop: '1px solid #EFEBDB', cursor: 'pointer' }}>
                    <td style={{ padding: '10px 14px', maxWidth: 280 }}>
                      <div style={{ fontWeight: 700, color: '#1f2a24', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                      {t.hasIssue && <Badge bg="#fdecec" color="#a33232">⚠ มีสถานที่ปิด/ถูกลบ</Badge>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <OwnerBadge owner={t.owner} />
                      {t.owner && <div style={{ fontSize: 12.5, color: '#6d7a72', marginTop: 3 }}>{t.owner.name}</div>}
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#3c463f' }}>{fmtRange(t)} <span style={{ color: '#8a938c' }}>({t.dayCount} วัน)</span></td>
                    <td style={{ padding: '10px 14px' }}>{t.placeCount}</td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>฿{Math.round(t.totalCostEstimate).toLocaleString('th-TH')}</td>
                    <td style={{ padding: '10px 14px', color: '#6d7a72', whiteSpace: 'nowrap' }}>{fmtDateTime(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
        </>
      )}

      <Modal open={!!selectedId} onClose={deleting ? () => {} : closeDetail} title={detail ? detail.title : 'แผนทริป'} maxWidth={820}>
        {detailError ? (
          <LoadError message="โหลดแผนทริปไม่สำเร็จ" onRetry={() => loadDetail(selectedId)} />
        ) : !detail ? (
          <LoadingSpinner size={32} label="กำลังโหลดแผนทริป..." />
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={openDelete} style={btn('#fdecec', '#a33232')}>ลบแผนทริป</button>
            </div>
            <TripDetail trip={detail} />
          </>
        )}
      </Modal>

      <Modal open={deleting && !!detail} onClose={busy ? () => {} : () => setDeleting(false)} title="ลบแผนทริปนี้?" maxWidth={460}>
        {detail && (
          <>
            <div style={{ fontSize: 14, color: '#3c463f', lineHeight: 1.6, marginBottom: 14 }}>
              “{detail.title}” จะถูกลบถาวรและกู้คืนไม่ได้{detail.owner ? ` ผู้ใช้ ${detail.owner.name} จะไม่เห็นแผนนี้ในทริปของฉันอีก` : ''} และจะไม่ถูกนับในสถิติ การลบจะถูกบันทึกไว้ในประวัติการดำเนินการของ admin
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>เหตุผล (ไม่บังคับ)</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, resize: 'vertical', marginBottom: 14 }} />
            {deleteError && <div style={{ fontSize: 13, color: '#a33232', marginBottom: 12 }}>{deleteError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={confirmDelete} disabled={busy} style={{ ...btn(busy ? '#c9d2ca' : '#c0392b', '#fff'), padding: '10px 20px', borderRadius: 16, cursor: busy ? 'default' : 'pointer' }}>{busy ? 'กำลังลบ...' : 'ลบแผนทริป'}</button>
              <button onClick={() => setDeleting(false)} disabled={busy} style={{ ...btn('#fff', '#3c463f', '1px solid #DCD8C6'), padding: '10px 20px', borderRadius: 16 }}>ยกเลิก</button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
