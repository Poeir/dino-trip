import { usePagedList } from '../lib/usePagedList.js'
import { fetchProfileHistory } from '../lib/apiClient.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import PageControls from '../components/PageControls.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { MASCOT } from '../data/categoryImages.js'
import { Card } from './ui.jsx'
import { useState } from 'react'

const FILTERS = [
  { value: undefined, label: 'ทั้งหมด' },
  { value: 'scan', label: 'สแกน QR' },
  { value: 'redeem', label: 'แลกรางวัล' },
  { value: 'adjust', label: 'ปรับพอยท์' },
]
const TYPE_LABEL = { scan: 'สแกน QR', redeem: 'แลกรางวัล', adjust: 'ปรับพอยท์' }

const fmt = (d) => new Date(d).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function Row({ item }) {
  const cancelled = item.status === 'cancelled'
  const positive = item.delta > 0
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #F0EDE0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1f2a24', textDecoration: cancelled ? 'line-through' : 'none', wordBreak: 'break-word' }}>{item.title}</div>
        <div style={{ fontSize: 12, color: '#8a938c' }}>
          {TYPE_LABEL[item.type]} · {fmt(item.at)}
          {cancelled && <span style={{ color: '#a33232', fontWeight: 700 }}> · ยกเลิกแล้ว (คืนพอยท์)</span>}
        </div>
        {item.note && <div style={{ fontSize: 12.5, color: '#6d7a72', marginTop: 2 }}>เหตุผล: {item.note}</div>}
      </div>
      <div data-font="culture" style={{ fontWeight: 900, fontSize: 16, color: cancelled ? '#a9b3ac' : positive ? '#2E7D32' : '#a33232', textDecoration: cancelled ? 'line-through' : 'none', whiteSpace: 'nowrap' }}>
        {positive ? '+' : ''}{item.delta}
      </div>
    </li>
  )
}

export default function HistoryTab() {
  const [type, setType] = useState(undefined)
  const list = usePagedList(fetchProfileHistory, { pageSize: 20, extraParams: { type } })

  return (
    <Card title="ประวัติพอยท์">
      <div role="group" aria-label="กรองประวัติ" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {FILTERS.map((f) => (
          <button key={f.label} type="button" aria-pressed={type === f.value} onClick={() => setType(f.value)}
            style={{ padding: '6px 14px', borderRadius: 16, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: type === f.value ? 'none' : '1px solid #DCD8C6', background: type === f.value ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff', color: type === f.value ? '#fff' : '#3c463f' }}>
            {f.label}
          </button>
        ))}
      </div>

      {list.error ? (
        <LoadError message="โหลดประวัติไม่สำเร็จ" onRetry={list.refetch} />
      ) : list.loading ? (
        <LoadingSpinner size={28} label="กำลังโหลดประวัติ..." />
      ) : list.rows.length === 0 ? (
        <EmptyState compact mascot={MASCOT.sleep} title="ยังไม่มีรายการ" desc="สแกน QR ที่สถานที่ท่องเที่ยวเพื่อเริ่มสะสมพอยท์" />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{list.rows.map((item) => <Row key={item.id} item={item} />)}</ul>
      )}
      <PageControls page={list.page} totalPages={list.totalPages} total={list.total} onChange={list.setPage} />
    </Card>
  )
}
