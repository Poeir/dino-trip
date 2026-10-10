import { useState } from 'react'
import PageControls from '../../components/PageControls.jsx'
import { fetchAdminUsers } from '../../lib/apiClient.js'
import { usePagedList } from '../../lib/usePagedList.js'
import AdminPageHeader from '../ui/AdminPageHeader.jsx'
import FilterChips from '../ui/FilterChips.jsx'
import Toolbar from '../ui/Toolbar.jsx'
import UserDetailModal from './UserDetailModal.jsx'
import UserTable from './UserTable.jsx'

const STATUS_FILTERS = [
  { value: 'visible', label: 'ทั้งหมด' },
  { value: 'active', label: 'ใช้งานอยู่' },
  { value: 'suspended', label: 'ถูกระงับ' },
  { value: 'deleted', label: 'ลบแล้ว' },
]
const SORT_OPTIONS = {
  'created-desc': { label: 'สมัครล่าสุด', sort: 'created', dir: 'desc' },
  'created-asc': { label: 'สมัครเก่าสุด', sort: 'created', dir: 'asc' },
  'name-asc': { label: 'ชื่อ (ก-ฮ)', sort: 'name', dir: 'asc' },
  'points-desc': { label: 'พอยท์มาก-น้อย', sort: 'points', dir: 'desc' },
  'lastLogin-desc': { label: 'ใช้งานล่าสุด', sort: 'lastLogin', dir: 'desc' },
}

export default function UsersTab() {
  const [statusFilter, setStatusFilter] = useState('visible')
  const [roleFilter, setRoleFilter] = useState('')
  const [verifiedFilter, setVerifiedFilter] = useState('')
  const [sortKey, setSortKey] = useState('created-desc')
  const sort = SORT_OPTIONS[sortKey]
  const paged = usePagedList(fetchAdminUsers, {
    pageSize: 20,
    extraParams: { status: statusFilter, role: roleFilter || undefined, verified: verifiedFilter || undefined, sort: sort.sort, dir: sort.dir },
  })
  const [selectedId, setSelectedId] = useState(null)

  return (
    <>
      <AdminPageHeader title="ผู้ใช้" subtitle={paged.loading ? 'กำลังโหลด...' : `พบ ${paged.total} บัญชี`} />

      <div className="ad-mb">
        <FilterChips label="สถานะบัญชี" options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
      </div>
      <Toolbar
        search={{ value: paged.query, onChange: paged.setQuery, placeholder: 'ค้นหาชื่อ อีเมล หรือเบอร์โทร...', label: 'ค้นหาผู้ใช้' }}
        filters={(
          <>
            <select className="ad-toolbar__sort" aria-label="บทบาท" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">ทุกบทบาท</option>
              <option value="tourist">นักท่องเที่ยว</option>
              <option value="admin">admin</option>
            </select>
            <select className="ad-toolbar__sort" aria-label="สถานะอีเมล" value={verifiedFilter} onChange={(e) => setVerifiedFilter(e.target.value)}>
              <option value="">อีเมล: ทั้งหมด</option>
              <option value="true">ยืนยันอีเมลแล้ว</option>
              <option value="false">ยังไม่ยืนยันอีเมล</option>
            </select>
          </>
        )}
        sort={{ value: sortKey, onChange: setSortKey, options: Object.entries(SORT_OPTIONS).map(([value, o]) => ({ value, label: o.label })) }}
      />

      <UserTable rows={paged.rows} loading={paged.loading} error={paged.error} onRetry={paged.refetch} onSelect={setSelectedId} />
      {paged.rows.length > 0 && <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />}

      {selectedId && <UserDetailModal userId={selectedId} onClose={() => setSelectedId(null)} onChanged={paged.refetch} />}
    </>
  )
}
