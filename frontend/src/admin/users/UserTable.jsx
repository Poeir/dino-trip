import Avatar from '../../components/Avatar.jsx'
import { fmtDateTime } from '../../lib/format.js'
import Badge from '../ui/Badge.jsx'
import DataTable from '../ui/DataTable.jsx'

export function StatusBadge({ user }) {
  if (user.deletedAt) return <Badge>ลบแล้ว</Badge>
  if (user.status === 'suspended') return <Badge tone="danger">ถูกระงับ</Badge>
  return <Badge tone="success">ใช้งานอยู่</Badge>
}

const COLUMNS = [
  { key: 'user', header: 'ผู้ใช้', render: (u) => (
    <span className="ad-person">
      <Avatar user={u} size={38} />
      <span className="ad-person__text">
        <span className="ad-person__name">{u.displayName} {u.role === 'admin' && <Badge tone="warning">admin</Badge>}</span>
        <span className="ad-person__sub">{u.email}</span>
      </span>
    </span>
  ) },
  { key: 'phone', header: 'เบอร์โทร', nowrap: true, render: (u) => u.phone || '-' },
  { key: 'status', header: 'สถานะ', render: (u) => (
    <span className="ad-badges">
      <StatusBadge user={u} />
      {!u.emailVerified && <Badge tone="warning">ยังไม่ยืนยันอีเมล</Badge>}
    </span>
  ) },
  { key: 'points', header: 'พอยท์', className: 'ad-points-strong', render: (u) => u.pointsBalance },
  { key: 'created', header: 'สมัครเมื่อ', nowrap: true, className: 'ad-text-muted', render: (u) => fmtDateTime(u.createdAt) },
  { key: 'login', header: 'ใช้งานล่าสุด', nowrap: true, className: 'ad-text-muted', render: (u) => (u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'ยังไม่เคย') },
]

export default function UserTable({ rows, loading, error, onRetry, onSelect }) {
  return (
    <DataTable
      label="รายชื่อผู้ใช้"
      columns={COLUMNS}
      rows={rows}
      loading={loading}
      error={error ? 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ' : null}
      onRetry={onRetry}
      empty="ไม่พบบัญชีที่ตรงกับเงื่อนไข"
      onRowClick={(u) => onSelect(u.id)}
      rowClassName={(u) => (u.deletedAt ? 'is-muted' : '')}
    />
  )
}
