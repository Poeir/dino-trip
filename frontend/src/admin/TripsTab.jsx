import { StarGlyph } from '../components/Icons.jsx'
import { useEffect, useState } from 'react'
import { Trash2, TriangleAlert } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import PageControls from '../components/PageControls.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import FilterPill from '../components/FilterPill.jsx'
import { fetchAdminTrips, fetchAdminTrip, deleteAdminTrip, fetchPlace } from '../lib/apiClient.js'
import PlaceDetailView from '../components/PlaceDetailView.jsx'
import { usePagedList } from '../lib/usePagedList.js'
import { fmtDate, fmtDateTime } from '../lib/format.js'
import { tripEndOptions } from '../data/seed.js'
import TripDayCard from '../components/TripDayCard.jsx'
import { tripDetailToPlan, decorateTripDays } from '../lib/tripPlanView.js'
import AdminPageHeader from './ui/AdminPageHeader.jsx'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import { useConfirm } from './ui/ConfirmDialog.jsx'
import FilterChips from './ui/FilterChips.jsx'
import { InfoGrid, InfoRow } from './ui/InfoGrid.jsx'
import ListState from './ui/ListState.jsx'
import Toolbar from './ui/Toolbar.jsx'

const OWNER_FILTERS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'user', label: 'เข้าสู่ระบบ' },
  { value: 'anonymous', label: 'ไม่ได้เข้าสู่ระบบ' },
]
const CLOSED_LABEL = { CLOSED_PERMANENTLY: 'ปิดถาวร', CLOSED_TEMPORARILY: 'ปิดชั่วคราว' }

// input.trip_end (chatbot-service TripInput) as one line; null = back at the hotel.
const tripEndText = (te) => {
  if (!te) return null
  const where = te.kind === 'district' ? `อำเภอ${te.name || ''}`
    : te.kind === 'pin' ? (te.name || 'จุดที่ปักหมุด')
    : tripEndOptions.find((o) => o.kind === te.kind)?.label || te.kind
  return te.time ? `${where} (${te.time})` : where
}
// trip_pace is stored as the English key TripFormPage's paceList uses
// (relaxed/standard/packed, see chatbot-service's models.py) -- shown here in
// the same Thai labels the tourist picked from, not the raw key.
const PACE_LABEL = { relaxed: 'สายชิลล์ (relaxed)', standard: 'กำลังดี (standard)', packed: 'สายลุย (packed)' }
const TABLE_HEADERS = ['ทริป', 'ผู้สร้าง', 'วันที่เดินทาง', 'สถานที่', 'ค่าใช้จ่าย', 'สร้างเมื่อ']

const fmtShortDate = (d) => fmtDate(d, 'medium')
const fmtRange = (t) => {
  if (t.dayCount <= 1) return fmtShortDate(t.startDate)
  const end = new Date(`${t.startDate}T00:00:00`)
  end.setDate(end.getDate() + t.dayCount - 1)
  return `${fmtShortDate(t.startDate)} – ${end.toLocaleDateString('th-TH', { dateStyle: 'medium' })}`
}

const OwnerBadge = ({ owner }) => (owner
  ? <Badge tone="success">เข้าสู่ระบบ</Badge>
  : <Badge>ไม่ได้เข้าสู่ระบบ</Badge>)

const IssueBadge = ({ children }) => <Badge tone="danger" icon={<TriangleAlert size={12} aria-hidden="true" />}>{children}</Badge>

// What (if anything) is wrong with a stop's place today.
function placeIssue(item) {
  if (item.kind !== 'place') return null
  if (!item.place) return 'ถูกลบออกจากระบบแล้ว'
  if (item.place.isActive === false) return 'ถูกปิดการแสดงผล'
  return CLOSED_LABEL[item.place.businessStatus] || null
}

// Real places only: the start / end / free-time slots have synthetic ids
// (hotel_dummy, trip_end, free_time_dummy_*, removed_*) and no place to show.
const isPlaceId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')

function TripDetail({ trip }) {
  const input = trip.input || {}
  // A stop clicked in a day card opens the same place view the tourist gets.
  const [selectedPlaceId, setSelectedPlaceId] = useState(null)
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [placeError, setPlaceError] = useState(false)
  useEffect(() => {
    setSelectedPlace(null)
    setPlaceError(false)
    if (!selectedPlaceId) return undefined
    let cancelled = false
    fetchPlace(selectedPlaceId)
      .then((p) => { if (!cancelled) setSelectedPlace(p) })
      // The public endpoint doesn't return hidden places.
      .catch(() => { if (!cancelled) setPlaceError(true) })
    return () => { cancelled = true }
  }, [selectedPlaceId])
  const openPlace = (id) => { if (isPlaceId(id)) setSelectedPlaceId(id) }
  // The API's own items, by id: placeIssue needs fields (isActive,
  // businessStatus) the display shape leaves out.
  const rawItems = new Map(trip.days.flatMap((d) => d.items.map((it) => [it.id, it])))
  return (
    <div>
      <div className="ad-trip-meta">
        <OwnerBadge owner={trip.owner} />
        {trip.owner && <span className="ad-fs-sm">{trip.owner.name}{trip.owner.email && trip.owner.email !== trip.owner.name ? ` · ${trip.owner.email}` : ''}{trip.owner.deleted ? ' (บัญชีถูกลบ)' : ''}</span>}
        {trip.isFavorite && <Badge tone="warning" icon={<StarGlyph size={12} />}>ติดดาว</Badge>}
      </div>

      <InfoGrid>
        <InfoRow label="วันที่เดินทาง">{fmtRange(trip)} ({trip.dayCount} วัน)</InfoRow>
        <InfoRow label="ช่วงเวลาต่อวัน">{input.start_time && input.end_time ? `${input.start_time} – ${input.end_time}` : null}</InfoRow>
        <InfoRow label="งบประมาณ">{input.budget_level || null}</InfoRow>
        <InfoRow label="จังหวะการเที่ยว">{(input.trip_pace && (PACE_LABEL[input.trip_pace] || input.trip_pace)) || null}</InfoRow>
        <InfoRow label="ขอบเขตพื้นที่">{input.area_scope || null}</InfoRow>
        <InfoRow label="ความสนใจ">{(input.interests || []).join(', ') || null}</InfoRow>
        <InfoRow label="อยากกิน">{(input.food_preferences || []).join(', ') || null}</InfoRow>
        <InfoRow label="ต้องไปแน่ๆ">{(input.must_go || []).join(', ') || null}</InfoRow>
        <InfoRow label="จุดเริ่มต้น (ที่พัก/บ้าน)">{input.accommodation_name || null}</InfoRow>
        <InfoRow label="วันสุดท้ายจบที่">{tripEndText(input.trip_end)}</InfoRow>
        <InfoRow label="ระยะทางรวม">{trip.totalDistanceKm} กม.</InfoRow>
        <InfoRow label="ค่าใช้จ่ายโดยประมาณ">฿{Math.round(trip.totalCostEstimate).toLocaleString('th-TH')}</InfoRow>
        <InfoRow label="สร้างเมื่อ">{fmtDateTime(trip.createdAt)}</InfoRow>
        <InfoRow label="แก้ไขล่าสุด">{fmtDateTime(trip.updatedAt)}</InfoRow>
      </InfoGrid>

      {trip.note && <div className="ad-note-box ad-note-box--spaced">{trip.note}</div>}

      {/* Same day cards as the tourist's trip page (TripDayCard), plus what
          only an admin needs per stop: a place that's gone or closed since,
          and the tourist's like/dislike. */}
      <div style={{ marginTop: 18 }}>
        {decorateTripDays(tripDetailToPlan(trip).days).map((day) => (
          <TripDayCard key={day.dayNum} day={day} onSelectPlace={openPlace} itemExtras={(item) => {
            const raw = rawItems.get(item.itemId)
            const issue = raw && placeIssue(raw)
            if (!issue && item.liked == null) return null
            return (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {issue && <IssueBadge>{issue}</IssueBadge>}
                {item.liked === true && <Badge tone="success">ถูกใจ</Badge>}
                {item.liked === false && <Badge tone="danger">ไม่ถูกใจ</Badge>}
              </div>
            )
          }} />
        ))}
      </div>

      <Modal
        open={!!selectedPlaceId}
        onClose={() => setSelectedPlaceId(null)}
        title={selectedPlace ? selectedPlace.name : 'สถานที่'}
        maxWidth={1100}
      >
        {selectedPlace && <PlaceDetailView place={selectedPlace} imageHeight={320} />}
        {!selectedPlace && !placeError && <LoadingSpinner label="กำลังโหลดข้อมูลสถานที่..." />}
        {placeError && <p className="ad-fs-sm">ไม่พบข้อมูลสถานที่นี้ (อาจถูกลบหรือปิดการแสดงผลแล้ว)</p>}
      </Modal>
    </div>
  )
}

export default function TripsTab() {
  const { actions } = useApp()
  const [owner, setOwner] = useState('')
  const [issueOnly, setIssueOnly] = useState(false)
  const paged = usePagedList(fetchAdminTrips, { pageSize: 20, extraParams: { owner: owner || undefined, issue: issueOnly ? '1' : undefined } })
  const { confirm, confirmDialog } = useConfirm()

  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState(false)

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

  const closeDetail = () => { setSelectedId(null); setDetail(null) }

  const handleDelete = async () => {
    const trip = detail
    const res = await confirm({
      title: 'ลบแผนทริปนี้?',
      message: `“${trip.title}” จะถูกลบถาวรและกู้คืนไม่ได้${trip.owner ? ` ผู้ใช้ ${trip.owner.name} จะไม่เห็นแผนนี้ในทริปของฉันอีก` : ''} และจะไม่ถูกนับในสถิติ การลบจะถูกบันทึกไว้ในประวัติการดำเนินการของ admin`,
      confirmLabel: 'ลบแผนทริป',
      danger: true,
      reason: 'optional',
      run: async ({ reason }) => {
        try {
          await deleteAdminTrip(trip.id, reason)
        } catch (err) {
          if (actions.handleSessionExpired(err)) err.silent = true
          throw err
        }
      },
    })
    if (!res) return
    actions.showToast('ลบแผนทริปแล้ว')
    const wasOnlyRowOnPage = paged.rows.length === 1 && paged.page > 1
    closeDetail()
    if (wasOnlyRowOnPage) paged.setPage(paged.page - 1)
    paged.refetch()
  }

  return (
    <>
      <AdminPageHeader title="ทริป" subtitle="แผนทริปที่ผู้ใช้สร้างจากตัวช่วยวางแผน" />

      <Toolbar
        search={{ value: paged.query, onChange: paged.setQuery, placeholder: 'ค้นหาชื่อทริป ชื่อหรืออีเมลผู้ใช้...', label: 'ค้นหาทริป' }}
        filters={(
          <>
            <FilterChips label="ผู้สร้างทริป" options={OWNER_FILTERS} value={owner} onChange={setOwner} />
            <FilterPill active={issueOnly} tone="cancelled" icon={<TriangleAlert size={14} aria-hidden="true" />} onClick={() => setIssueOnly((v) => !v)}>มีสถานที่ปิด/ถูกลบ</FilterPill>
          </>
        )}
        count={paged.loading ? 'กำลังโหลด...' : `พบ ${paged.total} แผน`}
      />

      {paged.error ? (
        <LoadError message="โหลดรายการทริปไม่สำเร็จ" onRetry={paged.refetch} />
      ) : paged.rows.length === 0 ? (
        <ListState loading={paged.loading} empty={!paged.loading} emptyText="ไม่พบแผนทริปที่ตรงกับเงื่อนไข" />
      ) : (
        <>
          <div className={`ad-table-wrap ad-fade${paged.loading ? ' is-loading' : ''}`}>
            <table className="ad-table">
              <thead>
                <tr>{TABLE_HEADERS.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {paged.rows.map((t) => (
                  <tr key={t.id} className="is-clickable" onClick={() => setSelectedId(t.id)}>
                    <td className="ad-cell-max">
                      <button type="button" className="ad-link-btn ad-ellipsis" onClick={(e) => { e.stopPropagation(); setSelectedId(t.id) }}>{t.title}</button>
                      {t.hasIssue && <IssueBadge>มีสถานที่ปิด/ถูกลบ</IssueBadge>}
                    </td>
                    <td>
                      <OwnerBadge owner={t.owner} />
                      {t.owner && <div className="ad-fs-xs ad-text-muted">{t.owner.name}</div>}
                    </td>
                    <td className="ad-nowrap">{fmtRange(t)} <span className="ad-text-muted">({t.dayCount} วัน)</span></td>
                    <td>{t.placeCount}</td>
                    <td className="ad-nowrap">฿{Math.round(t.totalCostEstimate).toLocaleString('th-TH')}</td>
                    <td className="ad-nowrap ad-text-muted">{fmtDateTime(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
        </>
      )}

      <Modal open={!!selectedId} onClose={closeDetail} title={detail ? detail.title : 'แผนทริป'} size="lg" maxWidth={820}>
        {detailError ? (
          <LoadError message="โหลดแผนทริปไม่สำเร็จ" onRetry={() => loadDetail(selectedId)} />
        ) : !detail ? (
          <LoadingSpinner size={32} label="กำลังโหลดแผนทริป..." />
        ) : (
          <>
            <div className="ad-actions ad-actions--end">
              <Button variant="dangersoft" size="sm" onClick={handleDelete}><Trash2 size={14} aria-hidden="true" />ลบแผนทริป</Button>
            </div>
            <TripDetail trip={detail} />
          </>
        )}
      </Modal>
      {confirmDialog}
    </>
  )
}
