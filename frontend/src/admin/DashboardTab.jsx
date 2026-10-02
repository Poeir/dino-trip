import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { triggerReindex, fetchReindexStatus, fetchReindexPending, fetchPlaces, fetchAdminStats } from '../lib/apiClient.js'
import LoadError from '../components/LoadError.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { REWARD_ICON } from '../data/categoryImages.js'
import TripStatsSection from './TripStatsSection.jsx'

const POLL_MS = 2500

// Polls chatbot-service (via the Node proxy) for the reindex job's state.
// See backend/src/routes/reindex.routes.js and
// chatbot-service/src/services/rag/embedder.py for what's on the other end.
function useReindexStatus(onSettled) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef(null)
  const prevStateRef = useRef(null)

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }

  const poll = async () => {
    let next
    try {
      next = await fetchReindexStatus()
    } catch (e) {
      // Previously swallowed silently, leaving the card stuck on "checking
      // status..." forever with the button disabled and no way to retry --
      // surface it instead (e.g. chatbot-service unreachable) so the admin
      // can see something's actually wrong.
      stopPolling()
      setBusy(false)
      setError(e.message || 'ตรวจสอบสถานะไม่สำเร็จ')
      return
    }
    setError(null)
    if (prevStateRef.current === 'running' && next.state !== 'running') onSettled(next)
    prevStateRef.current = next.state
    setStatus(next)
    if (next.state !== 'running') {
      stopPolling()
      setBusy(false)
    }
  }

  useEffect(() => { poll(); return stopPolling }, [])

  const run = async () => {
    setBusy(true)
    try {
      await triggerReindex()
    } catch (e) {
      // "already running" is harmless -- poll() below still surfaces the
      // true state either way. A hard failure (service down) needs to reach
      // the admin, not vanish silently; poll() immediately after will
      // clear this again if it turns out to just be "already running".
      setError(e.message || 'สั่งอัปเดตดัชนีไม่สำเร็จ')
    }
    if (!pollRef.current) pollRef.current = setInterval(poll, POLL_MS)
    poll()
  }

  return { status, error, busy: busy || status?.state === 'running', run }
}

const formatTime = (iso) => iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : null

const PENDING_SECTIONS = [
  { key: 'places', label: 'สถานที่' },
  { key: 'events', label: 'อีเวนท์' },
  { key: 'knowledgeBase', label: 'องค์ความรู้' },
]

// Plain inline SVG (no icon library in this project) instead of an emoji --
// emoji render inconsistently across platforms/fonts and don't take a
// currentColor/size prop the way the rest of this card's icons do.
function RefreshIcon({ size = 14, spinning = false }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ animation: spinning ? 'dc-spin 0.9s linear infinite' : 'none', flexShrink: 0 }}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

// Fetched on demand when the admin expands the pending list, not polled --
// unlike status (which useReindexStatus polls every POLL_MS while a run is
// in progress), the actual row names only matter when someone's looking.
//
// The parent (ReindexCard) owns this fetch rather than the list owning it,
// because the "มี N รายการ..." headline count and this list must come from
// the same query: the headline used to read status.pending (a periodic
// snapshot) while this list ran its own independent fetch, so the two could
// land at different moments and disagree -- expanding the list would then
// show a different total than the headline just displayed, looking exactly
// like the index had silently updated itself on click.
function usePendingItems(reloadKey, enabled) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setItems(null)
    setError(null)
    fetchReindexPending()
      .then((data) => { if (!cancelled) setItems(data) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [enabled, reloadKey])

  const total = items ? PENDING_SECTIONS.reduce((sum, s) => sum + (items[s.key]?.length || 0), 0) : null
  return { items, error, total }
}

function PendingList({ items, error }) {
  if (error) return <div style={{ color: '#a33232', fontSize: 12, marginTop: 10 }}>โหลดรายการไม่สำเร็จ: {error}</div>
  if (items === null) return <div style={{ fontSize: 12.5, color: '#5f6a63', marginTop: 10 }}>กำลังโหลดรายการ...</div>

  const sections = PENDING_SECTIONS.map((s) => ({ ...s, rows: items[s.key] || [] })).filter((s) => s.rows.length)
  if (!sections.length) return <div style={{ fontSize: 12.5, color: '#5f6a63', marginTop: 10 }}>ไม่มีรายการค้างอัปเดตดัชนี</div>

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
      {sections.map((s) => (
        <div key={s.key}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: '#1B5E20', marginBottom: 4 }}>{s.label} ({s.rows.length})</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#333', display: 'grid', gap: 2 }}>
            {s.rows.map((row) => <li key={row.id}>{row.name}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ReindexCard() {
  const { actions } = useApp()
  const [expanded, setExpanded] = useState(false)
  const onSettled = (s) => {
    if (s.state === 'done') actions.showToast(`อัปเดตดัชนีค้นหาแล้ว ${s.embeddedCount} รายการ`)
    else if (s.state === 'error') actions.showToast('อัปเดตดัชนีค้นหาไม่สำเร็จ: ' + s.error)
  }
  const { status, error, busy, run } = useReindexStatus(onSettled)
  const { items: pendingItems, error: pendingError, total: pendingTotal } = usePendingItems(status?.finishedAt, expanded)
  // Once the detail list has loaded, it's the source of truth for the
  // headline count too (see usePendingItems' comment) -- falls back to the
  // status snapshot before the list has ever been fetched.
  const pendingCount = pendingTotal ?? ((status?.pending?.places || 0) + (status?.pending?.knowledgeBase || 0) + (status?.pending?.events || 0))
  // Only the very first check (no result and no error yet) blocks the
  // button -- once a connection error has surfaced, clicking the button
  // should retry rather than staying disabled forever.
  const checking = status === null && !error
  const retrying = status === null && error

  return (
    <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 20, marginTop: 16, animation: 'dc-fade-up 0.35s ease 0.3s both' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#1B5E20', marginBottom: 4 }}>ดัชนีค้นหาแชทบอท (Embedding)</div>
          <div style={{ fontSize: 12.5, color: '#5f6a63' }}>
            {checking ? 'กำลังตรวจสอบสถานะ...' : status === null ? 'ตรวจสอบสถานะไม่สำเร็จ' : pendingCount > 0
              ? <>มี {pendingCount} รายการที่เพิ่ม/แก้ไขแล้วยังไม่อัปเดตดัชนี{' · '}
                <span style={{ color: '#2E7D32', fontWeight: 700, cursor: 'pointer' }} onClick={() => setExpanded((v) => !v)}>
                  {expanded ? 'ซ่อนรายการ' : 'ดูรายการ'}
                </span>
              </>
              : 'ดัชนีค้นหาเป็นปัจจุบันแล้ว'}
            {status?.finishedAt && status.state !== 'running' && ` · รันล่าสุด ${formatTime(status.finishedAt)}`}
          </div>
        </div>
        <button
          onClick={run}
          disabled={busy || checking}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: busy || checking ? '#A5D6A7' : 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13, cursor: busy || checking ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
        >
          <RefreshIcon spinning={status?.state === 'running'} />
          {status?.state === 'running' ? 'กำลังอัปเดต...' : retrying ? 'ลองใหม่' : 'อัปเดตดัชนีค้นหา'}
        </button>
      </div>
      {error && <div style={{ color: '#a33232', fontSize: 12, marginTop: 10 }}>เชื่อมต่อ chatbot-service ไม่สำเร็จ: {error}</div>}
      {status?.state === 'error' && <div style={{ color: '#a33232', fontSize: 12, marginTop: 10 }}>เกิดข้อผิดพลาด: {status.error}</div>}
      {expanded && <PendingList items={pendingItems} error={pendingError} />}
    </div>
  )
}

function StatCard({ value, label, tone = 'normal' }) {
  const warn = tone === 'warn'
  return (
    <div style={{ background: '#fff', border: `1px solid ${warn ? '#f0c6c6' : '#E7E3D2'}`, borderRadius: 16, padding: '16px 18px' }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: warn ? '#a33232' : '#1B5E20' }}>{value}</div>
      <div style={{ fontSize: 13, color: '#5f6a63' }}>{label}</div>
    </div>
  )
}

const fmtDateTime = (iso) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

// Users, points and counter redemptions -- numbers that come from the API's
// own aggregate query rather than the bulk-loaded lists the cards above use.
function UsageSection({ stats, error, onRetry }) {
  if (error) return <div style={{ marginTop: 22 }}><LoadError message="โหลดสถิติผู้ใช้ไม่สำเร็จ" onRetry={onRetry} /></div>
  const n = (v) => (stats ? v : '–')
  return (
    <div style={{ marginTop: 22 }}>
      {stats && stats.activeAdmins < 2 && (
        <div style={{ background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: 14, padding: '12px 16px', marginBottom: 16, fontSize: 13.5, color: '#7A5205', lineHeight: 1.6 }}>
          ตอนนี้มี admin ที่ใช้งานได้ <b>{stats.activeAdmins} คน</b> ถ้าบัญชีนี้ใช้ไม่ได้จะไม่มีใครเข้าหน้า admin ได้ ควรเพิ่ม admin สำรองไว้ด้วยคำสั่ง <code>node scripts/create-admin.js อีเมล รหัสผ่าน</code> ในโฟลเดอร์ backend
        </div>
      )}
      <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1B5E20', margin: '0 0 12px' }}>ผู้ใช้และการแลกของรางวัล</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 14, marginBottom: 16 }}>
        <StatCard value={n(stats?.users.total)} label="ผู้ใช้ทั้งหมด" />
        <StatCard value={n(stats?.users.newLast7Days)} label="สมัครใหม่ใน 7 วัน" />
        <StatCard value={n(stats?.users.suspended)} label="ถูกระงับ" tone={stats?.users.suspended ? 'warn' : 'normal'} />
        <StatCard value={n(stats?.users.unverified)} label="ยังไม่ยืนยันอีเมล" />
        <StatCard value={n(stats?.scansLast7Days)} label="สแกน QR ใน 7 วัน" />
        <StatCard value={n(stats?.points.outstanding)} label="พอยท์คงค้างในบัญชีผู้ใช้" />
        <StatCard value={n(stats?.redemptionsLast30Days)} label="แลกของรางวัลใน 30 วัน" />
      </div>
      <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, color: '#1B5E20', marginBottom: 10 }}>การแลกของรางวัลล่าสุด</div>
        {!stats ? (
          <div style={{ fontSize: 13, color: '#626863' }}>กำลังโหลด...</div>
        ) : stats.recentRedemptions.length === 0 ? (
          <EmptyState compact icon={REWARD_ICON} title="ยังไม่มีการแลกของรางวัล" />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {stats.recentRedemptions.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 13.5, opacity: r.status === 'cancelled' ? 0.6 : 1 }}>
                <span><b>{r.userName}</b> แลก {r.rewardName} ({r.cost} พอยท์){r.status === 'cancelled' && <span style={{ color: '#a33232' }}> · ยกเลิกแล้ว</span>}</span>
                <span style={{ color: '#5f6a63' }}>{fmtDateTime(r.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DashboardTab() {
  const { state, actions } = useApp()
  const [placesCount, setPlacesCount] = useState(null)
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState(false)

  const loadStats = () => {
    setStatsError(false)
    fetchAdminStats()
      .then(setStats)
      .catch((err) => { if (!actions.handleSessionExpired(err)) setStatsError(true) })
  }
  useEffect(() => { loadStats() }, [])

  // {limit:1, sort:'rating', dir:'desc'} takes crudRouter's cheap count()+
  // limit/offset path instead of the weighted-rating sort branch (which
  // would pull every row into memory just to rank a single one nobody
  // needs ranked) -- see places.routes.js/crudRouter.js.
  useEffect(() => {
    let cancelled = false
    fetchPlaces({ limit: 1, sort: 'rating', dir: 'desc' })
      .then(({ total }) => { if (!cancelled) setPlacesCount(total) })
      .catch(() => { if (!cancelled) setPlacesCount(0) })
    return () => { cancelled = true }
  }, [])

  // A dash instead of a misleading "0" while the fetch these counts come
  // from is still in flight (state.dataLoading, see AppContext.jsx).
  const stat = (n) => state.dataLoading ? '–' : n
  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: '0 0 20px' }}>แดชบอร์ด</h1>
      <div data-role="admin-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 20, animation: 'dc-fade-up 0.35s ease both' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#E8F5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <span style={{ width: 11, height: 11, borderRadius: '50% 50% 50% 0', background: '#2E7D32', transform: 'rotate(-45deg)' }}></span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1B5E20' }}>{placesCount == null ? '–' : placesCount}</div>
          <div style={{ fontSize: 13, color: '#5f6a63' }}>สถานที่ทั้งหมด</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 20, animation: 'dc-fade-up 0.35s ease 0.05s both' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#FDEEE3', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <span style={{ width: 14, height: 12, border: '2px solid #E07B39', borderRadius: 2, position: 'relative' }}>
              <span style={{ position: 'absolute', top: -4, left: 2, width: 2, height: 5, background: '#E07B39' }}></span>
              <span style={{ position: 'absolute', top: -4, right: 2, width: 2, height: 5, background: '#E07B39' }}></span>
            </span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1B5E20' }}>{stat(state.events.length)}</div>
          <div style={{ fontSize: 13, color: '#5f6a63' }}>อีเวนท์ทั้งหมด</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 20, animation: 'dc-fade-up 0.35s ease 0.1s both' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#E8F5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <span style={{ width: 15, height: 11, background: '#2E7D32', borderRadius: '4px 4px 4px 0' }}></span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1B5E20' }}>{stat(state.knowledgeBase.length)}</div>
          <div style={{ fontSize: 13, color: '#5f6a63' }}>องค์ความรู้แชทบอท</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #FFE082', borderRadius: 16, padding: 20, animation: 'dc-fade-up 0.35s ease 0.15s both' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#FFF8E1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <span style={{ width: 14, height: 11, border: '2px solid #7A5205', borderRadius: 2, position: 'relative', display: 'inline-block' }}>
              <span style={{ position: 'absolute', top: 1, left: 2.5, width: 5, height: 5, borderRadius: '50%', border: '1.5px solid #7A5205' }}></span>
            </span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#7A5205' }}>{stats ? stats.points.distributed : '–'}</div>
          <div style={{ fontSize: 13, color: '#7A5205' }}>พอยท์ที่แจกไปแล้ว</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 20, animation: 'dc-fade-up 0.35s ease 0.2s both' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#FFF8E1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <span style={{ width: 17, height: 13, border: '2px solid #7A5205', borderRadius: 3, position: 'relative', display: 'inline-block' }}>
              <span style={{ position: 'absolute', top: 1.5, left: 3, width: 6, height: 6, borderRadius: '50%', border: '2px solid #7A5205' }}></span>
            </span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1B5E20' }}>{stat(state.qrs.length)}</div>
          <div style={{ fontSize: 13, color: '#5f6a63' }}>จำนวน QR ทั้งหมด</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 20, animation: 'dc-fade-up 0.35s ease 0.25s both' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#FFF8E1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <span style={{ width: 18, height: 14, border: '2px solid #7A5205', borderRadius: 2, position: 'relative' }}>
              <span style={{ position: 'absolute', top: -6, left: 6.5, width: 2, height: 20, background: '#7A5205' }}></span>
              <span style={{ position: 'absolute', top: 2, left: -1, width: 20, height: 2, background: '#7A5205' }}></span>
            </span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1B5E20' }}>{stat(state.rewards.length)}</div>
          <div style={{ fontSize: 13, color: '#5f6a63' }}>จำนวนของรางวัล</div>
        </div>
      </div>
      <UsageSection stats={stats} error={statsError} onRetry={loadStats} />
      <TripStatsSection />
      <ReindexCard />
    </>
  )
}
