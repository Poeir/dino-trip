import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import ImageSlot from '../../components/ImageSlot.jsx'
import PageControls from '../../components/PageControls.jsx'
import { EVENT_ICON } from '../../data/categoryImages.js'
import { fetchEvents } from '../../lib/apiClient.js'
import { usePagedList } from '../../lib/usePagedList.js'
import AdminPageHeader from '../ui/AdminPageHeader.jsx'
import Button from '../ui/Button.jsx'
import EntityCard from '../ui/EntityCard.jsx'
import ListState from '../ui/ListState.jsx'
import Toolbar from '../ui/Toolbar.jsx'
import EventDetailModal, { IndexStatusBadge, TIME_STATUS_LABEL } from './EventDetailModal.jsx'
import EventFormModal from './EventFormModal.jsx'

// The tab's own sort dropdown -> crudRouter.js's ?sort=/?dir=.
const EVENT_SORT_PARAMS = {
  'name-asc': { sort: 'name', dir: 'asc' },
  'name-desc': { sort: 'name', dir: 'desc' },
  status: { sort: 'status', dir: 'asc' },
}
const SORT_OPTIONS = [
  { value: 'name-asc', label: 'ชื่อ (ก-ฮ)' },
  { value: 'name-desc', label: 'ชื่อ (ฮ-ก)' },
  { value: 'status', label: 'สถานะ' },
]

export default function EventsTab() {
  const { actions } = useApp()
  const [sortBy, setSortBy] = useState('name-asc')
  const [viewing, setViewing] = useState(null)
  const paged = usePagedList(fetchEvents, { pageSize: 20, extraParams: EVENT_SORT_PARAMS[sortBy] })

  return (
    <>
      <AdminPageHeader
        title="จัดการกิจกรรม"
        actions={<Button onClick={actions.onNewEvent}><Plus size={16} aria-hidden="true" />สร้างกิจกรรม</Button>}
      />
      <EventDetailModal event={viewing} onClose={() => setViewing(null)} onEdit={(ev) => actions.openEditForm('event', ev)} />
      <EventFormModal onChanged={paged.refetch} />

      <Toolbar
        search={{ value: paged.query, onChange: paged.setQuery, placeholder: 'ค้นหากิจกรรม...', label: 'ค้นหากิจกรรม' }}
        sort={{ value: sortBy, onChange: setSortBy, options: SORT_OPTIONS, label: 'เรียงลำดับกิจกรรม' }}
        count={paged.loading ? 'กำลังโหลด...' : `พบ ${paged.total} รายการ`}
      />
      <ListState
        loading={paged.loading && paged.rows.length === 0}
        error={paged.error ? 'โหลดรายการกิจกรรมไม่สำเร็จ' : false}
        empty={!paged.loading && !paged.error && paged.rows.length === 0}
        emptyText="ไม่พบกิจกรรมที่ตรงกับเงื่อนไข"
        onRetry={paged.refetch}
      />
      <div className={`ad-card-grid ad-fade${paged.loading ? ' is-loading' : ''}`} hidden={!!paged.error}>
        {paged.rows.map((e) => (
          <EntityCard
            key={e.id}
            media={<ImageSlot src={e.img} shape="rect" placeholder="ภาพงาน" icon={EVENT_ICON} />}
            title={e.name}
            subtitle={`${e.dateRange} · ${TIME_STATUS_LABEL[e.timeStatus] || 'ยังไม่ระบุวันที่'}`}
            itemName={e.name}
            onView={() => setViewing(e)}
            onEdit={() => actions.openEditForm('event', e)}
            onDelete={async () => { await actions.deleteItem('event', e.id); paged.refetch() }}
          >
            <IndexStatusBadge event={e} />
          </EntityCard>
        ))}
      </div>
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </>
  )
}
