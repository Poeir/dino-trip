import { useEffect, useState } from 'react'
import { CalendarDays, Route, Wallet } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import LoadError from '../components/LoadError.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { fetchAdminTripStats } from '../lib/apiClient.js'
import FilterChips from './ui/FilterChips.jsx'
import StatCard from './ui/StatCard.jsx'
import Facts from './ui/Facts.jsx'

// Trip-planning statistics for the dashboard. One series per chart, all in the
// brand green (no categorical palette needed): a daily count column chart and
// ranked horizontal bars. Every mark has a hover tooltip and a printed value.
const WINDOWS = [
  { value: 7, label: '7 วัน' },
  { value: 30, label: '30 วัน' },
  { value: 90, label: '90 วัน' },
  { value: 365, label: '1 ปี' },
]
const fmtShort = (isoDay) => new Date(`${isoDay}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
const fmtLong = (isoDay) => new Date(`${isoDay}T00:00:00`).toLocaleDateString('th-TH', { dateStyle: 'medium' })
const num = (n) => Number(n).toLocaleString('th-TH')

function Panel({ title, note, children }) {
  return (
    <div className="ad-panel ad-panel--tight">
      <h3 className="ad-panel__title">{title}</h3>
      {note && <div className="ad-panel__note">{note}</div>}
      {children}
    </div>
  )
}

// Ranked horizontal bars: label, bar scaled to the largest row, printed value
// (and share of `total` when given). Text stays in ink colors; only the mark is green.
function HBars({ rows, total, unit = '' }) {
  if (!rows.length) return <div className="ad-fs-sm ad-text-muted">ยังไม่มีข้อมูล</div>
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div className="ad-bars">
      {rows.map((r, i) => (
        <div key={r.key ?? r.label} title={`${r.label}: ${num(r.count)}${unit}${total ? ` (${Math.round((r.count / total) * 100)}%)` : ''}`}>
          <div className="ad-bars__head">
            <span className="ad-ellipsis">{r.label}</span>
            <span className="ad-text-muted ad-nowrap">{num(r.count)}{unit}{total ? ` · ${Math.round((r.count / total) * 100)}%` : ''}</span>
          </div>
          <div className="ad-bars__track">
            <div className="ad-bars__fill" style={{ width: `${(r.count / max) * 100}%`, '--i': i }}></div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Column chart, one column per day. Columns sit on the baseline with rounded
// tops and a 1-2px gap; the hit area is the whole column, not just the bar.
function DailyChart({ daily }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(...daily.map((d) => d.count), 1)
  const gap = daily.length > 120 ? 0 : daily.length > 45 ? 1 : 2
  const hovered = hover != null ? daily[hover] : null
  const mid = daily[Math.floor(daily.length / 2)]
  return (
    <div>
      <div className={`ad-chart ad-chart--gap${gap}${hover != null ? ' is-hovering' : ''}`} role="img" aria-label={`จำนวนแผนทริปที่สร้างต่อวัน ตั้งแต่ ${fmtLong(daily[0].day)} ถึง ${fmtLong(daily[daily.length - 1].day)} สูงสุด ${max} แผนต่อวัน`}>
        <div className="ad-chart__max"><span>{num(max)}</span></div>
        {daily.map((d, i) => (
          <div key={d.day} className={`ad-chart__col${hover === i ? ' is-hover' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="ad-chart__bar" style={{ height: d.count ? `${Math.max((d.count / max) * 100, 2)}%` : 0, '--d': `${Math.round((i / daily.length) * 250)}ms` }}></div>
          </div>
        ))}
        {hovered && (
          <div className={`ad-chart__tip ${hover > daily.length * 0.75 ? 'is-end' : hover < daily.length * 0.25 ? 'is-start' : 'is-mid'}`} style={{ left: `${((hover + 0.5) / daily.length) * 100}%` }}>
            {fmtLong(hovered.day)} · <b>{num(hovered.count)}</b> แผน
          </div>
        )}
      </div>
      <div className="ad-chart__axis">
        <span>{fmtShort(daily[0].day)}</span>
        {daily.length > 6 && <span>{fmtShort(mid.day)}</span>}
        <span>{fmtShort(daily[daily.length - 1].day)}</span>
      </div>
      <details className="ad-details">
        <summary>ดูเป็นตาราง</summary>
        <div className="ad-details__scroll">
          <table className="ad-table ad-table--compact">
            <thead><tr><th scope="col">วันที่</th><th scope="col">จำนวนแผน</th></tr></thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.day}><td>{fmtLong(d.day)}</td><td>{num(d.count)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

const TOP_DEFAULT = 5
const TOP_ALL = 10

export default function TripStatsSection() {
  const { actions } = useApp()
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(false)
    fetchAdminTripStats(days)
      .then((s) => { if (!cancelled) setStats(s) })
      .catch((err) => { if (!cancelled && !actions.handleSessionExpired(err)) setError(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, tick])

  if (error) return <LoadError message="โหลดสถิติการวางแผนทริปไม่สำเร็จ" onRetry={() => setTick((t) => t + 1)} />

  const t = stats?.totals
  const v = (x) => (t ? num(x) : '–')
  // Keep the previous numbers on screen (dimmed) while a new window loads.
  const stale = stats && stats.days !== days
  const pct = (part) => (t && t.total ? ` (${Math.round((part / t.total) * 100)}%)` : '')
  const limit = showAll ? TOP_ALL : TOP_DEFAULT
  const top = (rows) => (rows || []).slice(0, limit)
  const rangeLabel = days === 365 ? '1 ปี' : `${days} วัน`

  return (
    <div className={`ad-fade${stale ? ' is-loading' : ''}`}>
      <div className="ad-toolbar-row">
        <FilterChips label="ช่วงเวลาสถิติ" options={WINDOWS} value={days} onChange={setDays} />
      </div>

      <div className="ad-kpi-row ad-kpi-row--3">
        <StatCard icon={<Route size={20} />} tone="success" value={v(t?.total)} label={`แผนที่สร้างใน ${rangeLabel}`} />
        <StatCard icon={<CalendarDays size={20} />} tone="info" value={v(t?.avgDays)} label="วันต่อทริป (เฉลี่ย)" />
        <StatCard icon={<Wallet size={20} />} tone="warning" value={t ? `฿${num(t.avgCost)}` : '–'} label="ค่าใช้จ่ายต่อทริป (เฉลี่ย)" />
      </div>
      <Facts
        title="รายละเอียดแผนทริป"
        items={[
          { label: 'สร้างโดยผู้ที่เข้าสู่ระบบ', value: t ? `${num(t.loggedIn)}${pct(t.loggedIn)}` : '–' },
          { label: 'สร้างโดยผู้ที่ไม่ได้เข้าสู่ระบบ', value: t ? `${num(t.anonymous)}${pct(t.anonymous)}` : '–' },
          { label: 'ทริปที่ติดดาวไว้', value: v(t?.favorites) },
          { label: 'ทริปผู้ใช้ที่มีสถานที่ปิด/ถูกลบ', value: stats ? num(stats.savedTripsWithFlaggedPlaces) : '–', tone: stats?.savedTripsWithFlaggedPlaces ? 'danger' : undefined },
        ]}
      />

      {stats && stats.totals.total === 0 ? (
        <EmptyState compact title="ยังไม่มีแผนทริปในช่วงเวลานี้" desc="ลองเลือกช่วงเวลาที่กว้างขึ้น" />
      ) : (
        <div className="ad-grid-gap">
          <Panel title="แผนที่สร้างต่อวัน" note="นับทั้งแผนที่บันทึกในบัญชีและที่บันทึกเพื่อสถิติ (วันตามเวลาไทย)">
            {stats ? <DailyChart daily={stats.daily} /> : <div className="ad-fs-sm ad-text-muted">กำลังโหลด...</div>}
          </Panel>
          <div className="ad-toolbar-row">
            <span className="ad-fs-sm ad-text-muted">แสดง {limit} อันดับแรก</span>
            <button type="button" className="ad-link-inline" aria-pressed={showAll} onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'ย่อเหลือ 5 อันดับ' : 'ดูทั้งหมด (10 อันดับ)'}
            </button>
          </div>
          <div className="ad-panels ad-panels--2">
            <Panel title="สถานที่ที่ถูกวางในแผนบ่อยสุด" note="จำนวนแผนที่มีสถานที่นั้น">
              <HBars rows={top((stats?.topPlaces || []).map((p) => ({ key: p.id, label: p.name, count: p.trips })))} unit=" แผน" />
            </Panel>
            <Panel title="ความสนใจที่เลือก" note="ผู้ใช้เลือกได้หลายอย่างต่อแผน">
              <HBars rows={top(stats?.interests)} total={t?.total} />
            </Panel>
            <Panel title="งบประมาณ"><HBars rows={top(stats?.budget)} total={t?.total} /></Panel>
            <Panel title="จังหวะการเที่ยว"><HBars rows={top(stats?.pace)} total={t?.total} /></Panel>
            <Panel title="ขอบเขตพื้นที่"><HBars rows={top(stats?.area)} total={t?.total} /></Panel>
            <Panel title="จำนวนวันต่อทริป"><HBars rows={top((stats?.length || []).map((r) => ({ ...r, label: `${r.label} วัน` })))} total={t?.total} /></Panel>
          </div>
        </div>
      )}
    </div>
  )
}
