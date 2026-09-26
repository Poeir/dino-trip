import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import LoadError from '../components/LoadError.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { fetchAdminTripStats } from '../lib/apiClient.js'

// Trip-planning statistics for the dashboard. One series per chart, all in the
// brand green (no categorical palette needed): a daily count column chart and
// ranked horizontal bars. Every mark has a hover tooltip and a printed value.
const WINDOWS = [
  { days: 7, label: '7 วัน' },
  { days: 30, label: '30 วัน' },
  { days: 90, label: '90 วัน' },
  { days: 365, label: '1 ปี' },
]
const BAR = '#2E7D32'
const fmtShort = (isoDay) => new Date(`${isoDay}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
const fmtLong = (isoDay) => new Date(`${isoDay}T00:00:00`).toLocaleDateString('th-TH', { dateStyle: 'medium' })
const num = (n) => Number(n).toLocaleString('th-TH')

const chipStyle = (active) => ({
  padding: '6px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? '#2E7D32' : '#DCD8C6'}`, background: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f',
})

function StatCard({ value, label, tone = 'normal' }) {
  const warn = tone === 'warn'
  return (
    <div style={{ background: '#fff', border: `1px solid ${warn ? '#f0c6c6' : '#E7E3D2'}`, borderRadius: 16, padding: '16px 18px' }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: warn ? '#a33232' : '#1B5E20' }}>{value}</div>
      <div style={{ fontSize: 13, color: '#6d7a72' }}>{label}</div>
    </div>
  )
}

function Panel({ title, note, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 18 }}>
      <div style={{ fontWeight: 800, fontSize: 14.5, color: '#1B5E20', marginBottom: note ? 2 : 12 }}>{title}</div>
      {note && <div style={{ fontSize: 12, color: '#8a938c', marginBottom: 12 }}>{note}</div>}
      {children}
    </div>
  )
}

// Ranked horizontal bars: label, bar scaled to the largest row, printed value
// (and share of `total` when given). Text stays in ink colors; only the mark is green.
function HBars({ rows, total, unit = '' }) {
  if (!rows.length) return <div style={{ fontSize: 13, color: '#8a938c' }}>ยังไม่มีข้อมูล</div>
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {rows.map((r) => (
        <div key={r.key ?? r.label} title={`${r.label}: ${num(r.count)}${unit}${total ? ` (${Math.round((r.count / total) * 100)}%)` : ''}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: '#3c463f', marginBottom: 3 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <span style={{ color: '#6d7a72', flexShrink: 0 }}>{num(r.count)}{unit}{total ? ` · ${Math.round((r.count / total) * 100)}%` : ''}</span>
          </div>
          <div style={{ height: 8, background: '#F1F8E9', borderRadius: 4 }}>
            <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', background: BAR, borderRadius: 4 }}></div>
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
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', height: 150, borderBottom: '1px solid #DCD8C6', paddingTop: 18 }}
        role="img" aria-label={`จำนวนแผนทริปที่สร้างต่อวัน ตั้งแต่ ${fmtLong(daily[0].day)} ถึง ${fmtLong(daily[daily.length - 1].day)} สูงสุด ${max} แผนต่อวัน`}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, borderTop: '1px dashed #EFEBDB', fontSize: 10.5, color: '#8a938c', lineHeight: 1 }}><span style={{ background: '#fff', paddingRight: 4 }}>{num(max)}</span></div>
        {daily.map((d, i) => (
          <div key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: `0 ${gap / 2}px`, cursor: 'default', background: hover === i ? 'rgba(46,125,50,0.06)' : 'transparent' }}>
            <div style={{ width: '100%', height: d.count ? `${Math.max((d.count / max) * 100, 2)}%` : 0, background: BAR, opacity: hover == null || hover === i ? 1 : 0.55, borderRadius: '3px 3px 0 0' }}></div>
          </div>
        ))}
        {hovered && (
          <div style={{ position: 'absolute', top: -6, left: `${((hover + 0.5) / daily.length) * 100}%`, transform: `translate(${hover > daily.length * 0.75 ? '-100%' : hover < daily.length * 0.25 ? '0' : '-50%'}, -100%)`, background: '#1f2a24', color: '#fff', fontSize: 12, padding: '5px 10px', borderRadius: 8, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 2 }}>
            {fmtLong(hovered.day)} · <b>{num(hovered.count)}</b> แผน
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#8a938c', marginTop: 5 }}>
        <span>{fmtShort(daily[0].day)}</span>
        {daily.length > 6 && <span>{fmtShort(mid.day)}</span>}
        <span>{fmtShort(daily[daily.length - 1].day)}</span>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: 12.5, color: '#2E7D32', fontWeight: 700, cursor: 'pointer' }}>ดูเป็นตาราง</summary>
        <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8, border: '1px solid #EFEBDB', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: '#6d7a72', background: '#FBF8EE', position: 'sticky', top: 0 }}><th style={{ padding: '6px 12px' }}>วันที่</th><th style={{ padding: '6px 12px' }}>จำนวนแผน</th></tr></thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.day} style={{ borderTop: '1px solid #EFEBDB' }}><td style={{ padding: '5px 12px' }}>{fmtLong(d.day)}</td><td style={{ padding: '5px 12px' }}>{num(d.count)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

export default function TripStatsSection() {
  const { actions } = useApp()
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(false)
    fetchAdminTripStats(days)
      .then((s) => { if (!cancelled) setStats(s) })
      .catch((err) => { if (!cancelled && !actions.handleSessionExpired(err)) setError(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, tick])

  if (error) return <div style={{ marginTop: 22 }}><LoadError message="โหลดสถิติการวางแผนทริปไม่สำเร็จ" onRetry={() => setTick((t) => t + 1)} /></div>

  const t = stats?.totals
  const v = (x) => (t ? num(x) : '–')
  // Keep the previous numbers on screen (dimmed) while a new window loads.
  const stale = stats && stats.days !== days
  const pct = (part) => (t && t.total ? ` (${Math.round((part / t.total) * 100)}%)` : '')

  return (
    <div style={{ marginTop: 26, opacity: stale ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1B5E20', margin: 0 }}>สถิติการวางแผนทริป</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map((w) => <button key={w.days} onClick={() => setDays(w.days)} aria-pressed={days === w.days} style={chipStyle(days === w.days)}>{w.label}</button>)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 14, marginBottom: 16 }}>
        <StatCard value={v(t?.total)} label={`แผนที่สร้างใน ${days === 365 ? '1 ปี' : `${days} วัน`}`} />
        <StatCard value={t ? `${num(t.loggedIn)}${pct(t.loggedIn)}` : '–'} label="สร้างโดยผู้ใช้ที่เข้าสู่ระบบ" />
        <StatCard value={t ? `${num(t.anonymous)}${pct(t.anonymous)}` : '–'} label="สร้างโดยผู้ที่ไม่ได้เข้าสู่ระบบ" />
        <StatCard value={v(t?.avgDays)} label="วันต่อทริป (เฉลี่ย)" />
        <StatCard value={t ? `฿${num(t.avgCost)}` : '–'} label="ค่าใช้จ่ายโดยประมาณต่อทริป (เฉลี่ย)" />
        <StatCard value={v(t?.favorites)} label="ทริปที่ติดดาวไว้" />
        <StatCard value={stats ? num(stats.savedTripsWithFlaggedPlaces) : '–'} label="ทริปของผู้ใช้ที่มีสถานที่ปิด/ถูกลบ" tone={stats?.savedTripsWithFlaggedPlaces ? 'warn' : 'normal'} />
      </div>

      {stats && stats.totals.total === 0 ? (
        <EmptyState compact title="ยังไม่มีแผนทริปในช่วงเวลานี้" desc="ลองเลือกช่วงเวลาที่กว้างขึ้น" />
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <Panel title="แผนที่สร้างต่อวัน" note="นับทั้งแผนที่บันทึกในบัญชีและที่บันทึกเพื่อสถิติ (วันตามเวลาไทย)">
            {stats ? <DailyChart daily={stats.daily} /> : <div style={{ fontSize: 13, color: '#8a938c' }}>กำลังโหลด...</div>}
          </Panel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
            <Panel title="สถานที่ที่ถูกวางในแผนบ่อยสุด" note="จำนวนแผนที่มีสถานที่นั้น (10 อันดับ)">
              <HBars rows={(stats?.topPlaces || []).map((p) => ({ key: p.id, label: p.name, count: p.trips }))} unit=" แผน" />
            </Panel>
            <Panel title="ความสนใจที่เลือก" note="ผู้ใช้เลือกได้หลายอย่างต่อแผน (10 อันดับ)">
              <HBars rows={stats?.interests || []} total={t?.total} />
            </Panel>
            <Panel title="งบประมาณ"><HBars rows={stats?.budget || []} total={t?.total} /></Panel>
            <Panel title="จังหวะการเที่ยว"><HBars rows={stats?.pace || []} total={t?.total} /></Panel>
            <Panel title="ขอบเขตพื้นที่"><HBars rows={stats?.area || []} total={t?.total} /></Panel>
            <Panel title="จำนวนวันต่อทริป"><HBars rows={(stats?.length || []).map((r) => ({ ...r, label: `${r.label} วัน` }))} total={t?.total} /></Panel>
          </div>
        </div>
      )}
    </div>
  )
}
