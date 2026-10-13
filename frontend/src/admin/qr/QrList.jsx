import { useEffect, useState } from 'react'
import { Plus, QrCode } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import PageControls from '../../components/PageControls.jsx'
import LoadingSpinner from '../../components/LoadingSpinner.jsx'
import LoadError from '../../components/LoadError.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { QR_ICON } from '../../data/categoryImages.js'
import { fmtDateTime } from '../../lib/format.js'
import Badge from '../ui/Badge.jsx'
import Button from '../ui/Button.jsx'
import EntityCard from '../ui/EntityCard.jsx'
import Toolbar from '../ui/Toolbar.jsx'

// qrs has no DB column to search/sort "by place name" against (that's a join, done client-side), so
// unlike rewards, its list stays a client-side slice of the already bulk-loaded state.qrs rather
// than its own paginated fetch. See usePagedList.js for the server-paginated pattern used elsewhere.
const QR_PAGE_SIZE = 20

const SORT_OPTIONS = [
  { value: 'placeName-asc', label: 'ชื่อสถานที่ (ก-ฮ)' },
  { value: 'placeName-desc', label: 'ชื่อสถานที่ (ฮ-ก)' },
  { value: 'points-desc', label: 'พอยท์มาก-น้อย' },
  { value: 'points-asc', label: 'พอยท์น้อย-มาก' },
]
const SORTERS = {
  'placeName-asc': (a, b) => a.placeName.localeCompare(b.placeName, 'th'),
  'placeName-desc': (a, b) => b.placeName.localeCompare(a.placeName, 'th'),
  'points-desc': (a, b) => b.points - a.points,
  'points-asc': (a, b) => a.points - b.points,
}

const QR_DELETE_MESSAGE = 'ป้าย QR ที่พิมพ์ไปแล้วจะสแกนไม่ได้ และประวัติการสแกนของ QR นี้จะถูกลบด้วย (ถ้าแค่ต้องการหยุดชั่วคราว ให้ใช้ “ปิดใช้งาน” แทน)'

function QrStatusBadge({ qr }) {
  if (!qr.isActive) return <Badge>ปิดใช้งาน</Badge>
  if (qr.expiresAt && new Date(qr.expiresAt) <= new Date()) return <Badge tone="danger">หมดอายุ</Badge>
  return <Badge tone="success">ใช้งานอยู่</Badge>
}

function LoadWarning({ children, onRetry }) {
  return (
    <span className="ad-error-text">
      {children}{' '}
      <button type="button" className="ad-link-inline ad-text-danger" onClick={onRetry}>ลองใหม่</button>
    </span>
  )
}

export default function QrList({
  placeNameById, placeNamesError, onRetryPlaceNames, stats, statsError, onRetryStats,
  togglingId, onPreview, onToggle,
}) {
  const { state, actions, derived } = useApp()
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('placeName-asc')
  const [page, setPage] = useState(1)

  // Search/sort narrow the result set -- back to page 1 so it doesn't land on a now out-of-range page.
  useEffect(() => { setPage(1) }, [query, sortBy])

  const all = derived.qrsView.map((q) => ({ ...q, placeName: placeNameById.get(q.placeId) || '-' }))
  const filtered = all
    .filter((q) => q.placeName.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(SORTERS[sortBy])
  const totalPages = Math.max(1, Math.ceil(filtered.length / QR_PAGE_SIZE))
  const pageView = filtered.slice((page - 1) * QR_PAGE_SIZE, page * QR_PAGE_SIZE)

  // `all` starts empty before the first fetch settles -- without the loading check this would flash
  // the "no QR yet" empty state on every load instead of a spinner.
  const hasAny = all.length > 0 || state.dataLoading

  if (state.dataLoadError && all.length === 0) return <LoadError message="โหลดรายการ QR ไม่สำเร็จ" onRetry={actions.reloadData} />
  if (!hasAny) {
    return (
      <EmptyState
        icon={QR_ICON}
        title="ยังไม่มี QR Code ในระบบ"
        desc="สร้าง QR แรกแล้วผูกกับสถานที่ท่องเที่ยว เพื่อพิมพ์ไปแปะให้นักท่องเที่ยวสแกนรับพอยท์"
        action={<Button onClick={actions.onNewQr}><Plus size={16} aria-hidden="true" />สร้าง QR ใหม่</Button>}
      />
    )
  }

  return (
    <>
      <Toolbar
        search={{ value: query, onChange: setQuery, placeholder: 'ค้นหา QR ตามชื่อสถานที่...', label: 'ค้นหา QR' }}
        sort={{ value: sortBy, onChange: setSortBy, options: SORT_OPTIONS, label: 'เรียงลำดับ QR' }}
        count={`พบ ${filtered.length} รายการ`}
        filters={(placeNamesError || statsError) && (
          <>
            {placeNamesError && <LoadWarning onRetry={onRetryPlaceNames}>โหลดชื่อสถานที่ไม่สำเร็จ</LoadWarning>}
            {statsError && <LoadWarning onRetry={onRetryStats}>โหลดสถิติการสแกนไม่สำเร็จ</LoadWarning>}
          </>
        )}
      />
      {filtered.length === 0 ? (
        state.dataLoading
          ? <LoadingSpinner size={32} label="กำลังโหลด QR..." />
          : <div className="ad-state">ไม่พบ QR ที่ตรงกับ “{query}”</div>
      ) : (
        <>
          <div className="ad-card-grid">
            {pageView.map((q) => {
              const stat = stats.get(q.id)
              return (
                <EntityCard
                  key={q.id}
                  dim={!q.isActive}
                  tile
                  media={<span className="ad-kb-icon" aria-hidden="true"><QrCode size={18} /></span>}
                  mediaOverlay={<span className="ad-entity__status"><QrStatusBadge qr={q} /></span>}
                  title={q.placeName}
                  subtitle={`+${q.points} พอยท์`}
                  itemName={`QR ของ ${q.placeName}`}
                  deleteMessage={QR_DELETE_MESSAGE}
                  onEdit={q.onEdit}
                  actions={(
                    <>
                      <Button variant="secondary" size="sm" onClick={() => onPreview(q)}>ดู QR Code</Button>
                      <Button variant={q.isActive ? 'secondary' : 'soft'} size="sm" loading={togglingId === q.id} onClick={() => onToggle(q)}>{q.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</Button>
                    </>
                  )}
                  onDelete={async () => { await actions.deleteItem('qr', q.id) }}
                >
                  <div className="ad-entity__meta">
                    <div>{statsError ? 'สแกนแล้ว - ครั้ง · แจก - พอยท์' : `สแกนแล้ว ${stat?.scans ?? 0} ครั้ง · แจก ${stat?.pointsTotal ?? 0} พอยท์`}</div>
                    <div>{q.expiresAt ? `หมดอายุ ${fmtDateTime(q.expiresAt)}` : 'ไม่มีวันหมดอายุ'}</div>
                    <div>รัศมี {q.radiusM ?? 200} เมตร</div>
                  </div>
                </EntityCard>
              )
            })}
          </div>
          <PageControls page={page} totalPages={totalPages} total={filtered.length} onChange={setPage} />
        </>
      )}
    </>
  )
}
