import { Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import PageControls from '../../components/PageControls.jsx'
import { fetchPlaces } from '../../lib/apiClient.js'
import { usePagedList } from '../../lib/usePagedList.js'
import GooglePlaceImportModal from '../GooglePlaceImportModal.jsx'
import PlaceSyncModal from '../PlaceSyncModal.jsx'
import AdminPageHeader from '../ui/AdminPageHeader.jsx'
import Button from '../ui/Button.jsx'
import ListState from '../ui/ListState.jsx'
import Toolbar from '../ui/Toolbar.jsx'
import PlaceAdminCard from './PlaceAdminCard.jsx'
import PlaceDetailModal from './PlaceDetailModal.jsx'
import PlaceFormModal from './PlaceFormModal.jsx'

// The tab's own sort dropdown -> crudRouter.js's ?sort=/?dir= (distinct from the weighted-rating
// ranking the public places list uses by default).
const PLACE_SORT_PARAMS = {
  'name-asc': { sort: 'name', dir: 'asc' },
  'name-desc': { sort: 'name', dir: 'desc' },
  'rating-desc': { sort: 'rating', dir: 'desc' },
  'rating-asc': { sort: 'rating', dir: 'asc' },
}
const SORT_OPTIONS = [
  { value: 'name-asc', label: 'ชื่อ (ก-ฮ)' },
  { value: 'name-desc', label: 'ชื่อ (ฮ-ก)' },
  { value: 'rating-desc', label: 'คะแนนสูง-ต่ำ' },
  { value: 'rating-asc', label: 'คะแนนต่ำ-สูง' },
]

export default function PlacesTab() {
  const { actions } = useApp()
  const [sortBy, setSortBy] = useState('name-asc')
  const paged = usePagedList(fetchPlaces, { pageSize: 20, extraParams: PLACE_SORT_PARAMS[sortBy] })
  // Google sync has one entry point: the "ซิงก์จาก Google" dialog (choose places, a filter, or
  // everything there). A single place can also be synced from its edit form. Cards only show sync
  // status, never controls.
  const [syncOpen, setSyncOpen] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [importOpen, setImportOpen] = useState(false)

  return (
    <>
      <AdminPageHeader
        title="จัดการสถานที่"
        actions={(
          <>
            <Button variant="secondary" onClick={() => setSyncOpen(true)}><RefreshCw size={15} aria-hidden="true" />ซิงก์จาก Google</Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}><Plus size={16} aria-hidden="true" />เพิ่มจาก Google Maps</Button>
            <Button onClick={actions.onNewPlace}><Plus size={16} aria-hidden="true" />เพิ่มสถานที่ใหม่</Button>
          </>
        )}
      />
      <GooglePlaceImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(place, created) => {
          setImportOpen(false)
          paged.refetch()
          actions.openEditForm('place', place)
          actions.showToast(created ? 'นำเข้าจาก Google แล้ว (ฉบับร่างที่ซ่อนอยู่) — ตรวจแก้แล้วติ๊ก "เผยแพร่" เมื่อพร้อม' : 'สถานที่นี้มีในระบบอยู่แล้ว เปิดให้แก้ไข')
        }}
      />
      <PlaceSyncModal open={syncOpen} onClose={() => setSyncOpen(false)} onFinished={paged.refetch} />
      <PlaceDetailModal place={viewing} onClose={() => setViewing(null)} onEdit={(p) => actions.openEditForm('place', p)} />
      <PlaceFormModal onChanged={paged.refetch} />

      <Toolbar
        search={{ value: paged.query, onChange: paged.setQuery, placeholder: 'ค้นหาสถานที่...', label: 'ค้นหาสถานที่' }}
        sort={{ value: sortBy, onChange: setSortBy, options: SORT_OPTIONS, label: 'เรียงลำดับสถานที่' }}
        count={paged.loading ? 'กำลังโหลด...' : `พบ ${paged.total} รายการ`}
      />
      <ListState
        loading={paged.loading && paged.rows.length === 0}
        error={paged.error ? 'โหลดรายการสถานที่ไม่สำเร็จ' : false}
        empty={!paged.loading && !paged.error && paged.rows.length === 0}
        emptyText="ไม่พบสถานที่ที่ตรงกับเงื่อนไข"
        onRetry={paged.refetch}
      />
      <div className={`ad-card-grid ad-fade${paged.loading ? ' is-loading' : ''}`} hidden={!!paged.error}>
        {paged.rows.map((p) => (
          <PlaceAdminCard
            key={p.id}
            place={p}
            onView={() => setViewing(p)}
            onEdit={() => actions.openEditForm('place', p)}
            onDelete={async () => { await actions.deleteItem('place', p.id); paged.refetch() }}
            onToggleActive={async () => { await actions.togglePlaceActive(p); paged.refetch() }}
          />
        ))}
      </div>
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </>
  )
}
