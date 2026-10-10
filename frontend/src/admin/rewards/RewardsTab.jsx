import { useState } from 'react'
import { Gift, Plus } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import PageControls from '../../components/PageControls.jsx'
import ImageSlot from '../../components/ImageSlot.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { REWARD_ICON } from '../../data/categoryImages.js'
import { fetchRewards } from '../../lib/apiClient.js'
import { usePagedList } from '../../lib/usePagedList.js'
import AdminPageHeader from '../ui/AdminPageHeader.jsx'
import Button from '../ui/Button.jsx'
import EntityCard from '../ui/EntityCard.jsx'
import ListState from '../ui/ListState.jsx'
import StatCard from '../ui/StatCard.jsx'
import Toolbar from '../ui/Toolbar.jsx'
import RewardFormModal from './RewardFormModal.jsx'

// The sort dropdown -> crudRouter.js's ?sort=/?dir=.
const REWARD_SORT_PARAMS = {
  'name-asc': { sort: 'name', dir: 'asc' },
  'name-desc': { sort: 'name', dir: 'desc' },
  'cost-desc': { sort: 'cost', dir: 'desc' },
  'cost-asc': { sort: 'cost', dir: 'asc' },
}
const SORT_OPTIONS = [
  { value: 'name-asc', label: 'ชื่อ (ก-ฮ)' },
  { value: 'name-desc', label: 'ชื่อ (ฮ-ก)' },
  { value: 'cost-desc', label: 'พอยท์มาก-น้อย' },
  { value: 'cost-asc', label: 'พอยท์น้อย-มาก' },
]

// /admin/rewards
export default function RewardsTab() {
  const { actions } = useApp()
  const [sortBy, setSortBy] = useState('name-asc')
  const paged = usePagedList(fetchRewards, { pageSize: 20, extraParams: REWARD_SORT_PARAMS[sortBy] })

  // `total`/`rows` start at 0/[] before the first fetch settles -- without the loading check these
  // would flash the empty state on every load instead of a spinner.
  const hasAny = paged.total > 0 || paged.loading

  return (
    <>
      <AdminPageHeader
        title="ของรางวัล"
        actions={<Button onClick={actions.onNewReward}><Plus size={16} aria-hidden="true" />เพิ่มของรางวัล</Button>}
      />
      <div className="ad-stat-grid ad-stat-grid--sm">
        <StatCard icon={<Gift size={20} aria-hidden="true" />} value={paged.total} label="ของรางวัลทั้งหมด" tone="warning" />
      </div>

      {paged.error ? (
        <ListState error="โหลดรายการของรางวัลไม่สำเร็จ" onRetry={paged.refetch} />
      ) : hasAny ? (
        <>
          <Toolbar
            search={{ value: paged.query, onChange: paged.setQuery, placeholder: 'ค้นหาของรางวัล...', label: 'ค้นหาของรางวัล' }}
            sort={{ value: sortBy, onChange: setSortBy, options: SORT_OPTIONS, label: 'เรียงลำดับของรางวัล' }}
            count={paged.loading ? 'กำลังโหลด...' : `พบ ${paged.total} รายการ`}
          />
          <ListState
            loading={paged.loading && paged.rows.length === 0}
            empty={!paged.loading && paged.rows.length === 0}
            emptyText={`ไม่พบของรางวัลที่ตรงกับ “${paged.query}”`}
          />
          <div className={`ad-card-grid ad-fade${paged.loading ? ' is-loading' : ''}`}>
            {paged.rows.map((r) => (
              <EntityCard
                key={r.id}
                media={r.imageUrl
                  ? <ImageSlot src={r.imageUrl} radius={10} placeholder={r.name} icon={REWARD_ICON} />
                  : <span className="ad-kb-icon" aria-hidden="true"><Gift size={18} /></span>}
                tile={!r.imageUrl}
                title={r.name}
                subtitle={`${r.cost} พอยท์`}
                itemName={r.name}
                onEdit={() => actions.openEditForm('reward', r)}
                onDelete={async () => { await actions.deleteItem('reward', r.id); paged.refetch() }}
              >
                <div className={`ad-reward__stock${r.stock === 0 ? ' is-out' : ''}`}>{r.stock == null ? 'ไม่จำกัดจำนวน' : r.stock === 0 ? 'ของหมด' : `เหลือ ${r.stock} ชิ้น`}</div>
              </EntityCard>
            ))}
          </div>
          <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
        </>
      ) : (
        <EmptyState
          icon={REWARD_ICON}
          title="ยังไม่มีของรางวัลในระบบ"
          desc="เพิ่มของรางวัลอย่างน้อย 1 ชิ้น เพื่อให้นักท่องเที่ยวมีของให้แลกด้วยพอยท์ที่สะสมได้"
          action={<Button onClick={actions.onNewReward}><Plus size={16} aria-hidden="true" />เพิ่มของรางวัล</Button>}
        />
      )}

      <RewardFormModal onSaved={paged.refetch} />
    </>
  )
}
