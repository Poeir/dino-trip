import { MapPin, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import PageControls from '../../components/PageControls.jsx'
import { fetchPlaceAreas, fetchPlaces, publishPlacesBatch } from '../../lib/apiClient.js'
import { usePagedList } from '../../lib/usePagedList.js'
import AreaImportModal from '../AreaImportModal.jsx'
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
  const [district, setDistrict] = useState('')
  const [subdistrict, setSubdistrict] = useState('')
  const [areas, setAreas] = useState([])
  useEffect(() => { fetchPlaceAreas().then(setAreas).catch(() => {}) }, [])
  const subdistrictOptions = areas.find((a) => a.name === district)?.subdistricts || []
  // '' = all, 'false' = hidden only (the imported drafts waiting for review).
  const [visibility, setVisibility] = useState('')
  const paged = usePagedList(fetchPlaces, { pageSize: 20, extraParams: { ...PLACE_SORT_PARAMS[sortBy], district, subdistrict, isActive: visibility } })
  const [selected, setSelected] = useState(() => new Set())
  const [publishing, setPublishing] = useState(false)
  // Selection is per filter view: switching filters/pages must not publish rows the admin can no longer see.
  useEffect(() => { setSelected(new Set()) }, [visibility, district, subdistrict, paged.page, paged.query])
  const hiddenOnPage = paged.rows.filter((p) => !p.isActive)
  const allHiddenSelected = hiddenOnPage.length > 0 && hiddenOnPage.every((p) => selected.has(p.id))
  const toggleSelected = (id) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const publishSelected = async () => {
    setPublishing(true)
    try {
      const r = await publishPlacesBatch([...selected])
      const reindexNote = { started: ' — กำลังสร้างดัชนีให้แชทบอท', busy: ' — มีงาน embedding รันอยู่ กรุณากดอัปเดตดัชนีที่แดชบอร์ดอีกครั้งเมื่อเสร็จ', failed: ' — สั่ง embedding ไม่สำเร็จ กรุณากดอัปเดตดัชนีที่แดชบอร์ด', skipped: '' }[r.reindex]
      actions.showToast(`เผยแพร่แล้ว ${r.published} แห่ง${reindexNote}`)
      setSelected(new Set())
      paged.refetch()
    } catch (err) {
      if (!actions.handleSessionExpired(err)) actions.showToast('เผยแพร่ไม่สำเร็จ: ' + err.message)
    } finally { setPublishing(false) }
  }
  // Google sync has one entry point: the "ซิงก์จาก Google" dialog (choose places, a filter, or
  // everything there). A single place can also be synced from its edit form. Cards only show sync
  // status, never controls.
  const [syncOpen, setSyncOpen] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [areaImportOpen, setAreaImportOpen] = useState(false)

  return (
    <>
      <AdminPageHeader
        title="จัดการสถานที่"
        actions={(
          <>
            <Button variant="secondary" onClick={() => setSyncOpen(true)}><RefreshCw size={15} aria-hidden="true" />ซิงก์จาก Google</Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}><Plus size={16} aria-hidden="true" />เพิ่มจาก Google Maps</Button>
            <Button variant="secondary" onClick={() => setAreaImportOpen(true)}><MapPin size={15} aria-hidden="true" />นำเข้าตามพื้นที่</Button>
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
      <AreaImportModal open={areaImportOpen} onClose={() => setAreaImportOpen(false)} onFinished={paged.refetch} />
      <PlaceSyncModal open={syncOpen} onClose={() => setSyncOpen(false)} onFinished={paged.refetch} />
      <PlaceDetailModal place={viewing} onClose={() => setViewing(null)} onEdit={(p) => actions.openEditForm('place', p)} />
      <PlaceFormModal onChanged={paged.refetch} />

      <Toolbar
        search={{ value: paged.query, onChange: paged.setQuery, placeholder: 'ค้นหาสถานที่...', label: 'ค้นหาสถานที่' }}
        filters={(
          <>
            <select className="ad-toolbar__sort" aria-label="กรองตามสถานะ" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="">ทุกสถานะ</option>
              <option value="false">ซ่อนอยู่ / ฉบับร่าง</option>
              <option value="true">เผยแพร่แล้ว</option>
            </select>
            <select className="ad-toolbar__sort" aria-label="กรองตามอำเภอ" value={district} onChange={(e) => { setDistrict(e.target.value); setSubdistrict('') }}>
              <option value="">ทุกอำเภอ</option>
              {areas.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.count})</option>)}
            </select>
            <select className="ad-toolbar__sort" aria-label="กรองตามตำบล" value={subdistrict} onChange={(e) => setSubdistrict(e.target.value)} disabled={!district}>
              <option value="">ทุกตำบล</option>
              {subdistrictOptions.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.count})</option>)}
            </select>
          </>
        )}
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
      {hiddenOnPage.length > 0 && (
        <div className="ad-bulkbar">
          <label className="ad-check">
            <input type="checkbox" checked={allHiddenSelected} onChange={() => setSelected(allHiddenSelected ? new Set() : new Set(hiddenOnPage.map((p) => p.id)))} />
            เลือกที่ซ่อนอยู่ทั้งหมดในหน้านี้ ({hiddenOnPage.length})
          </label>
          <span>เลือกแล้ว {selected.size} แห่ง</span>
          <Button size="sm" onClick={publishSelected} loading={publishing} disabled={publishing || selected.size === 0}>เผยแพร่ที่เลือก</Button>
        </div>
      )}
      <div className={`ad-card-grid ad-fade${paged.loading ? ' is-loading' : ''}`} hidden={!!paged.error}>
        {paged.rows.map((p) => (
          <PlaceAdminCard
            key={p.id}
            place={p}
            onView={() => setViewing(p)}
            onEdit={() => actions.openEditForm('place', p)}
            onDelete={async () => { await actions.deleteItem('place', p.id); paged.refetch() }}
            onToggleActive={async () => { await actions.togglePlaceActive(p); paged.refetch() }}
            selection={p.isActive ? undefined : { checked: selected.has(p.id), onChange: () => toggleSelected(p.id) }}
          />
        ))}
      </div>
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </>
  )
}
