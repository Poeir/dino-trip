import { CalendarDays, CheckCircle2, Flag, Inbox, MapPin, RefreshCw, ScanLine, TriangleAlert, UserPlus, Users, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { triggerReindex, fetchReindexStatus, fetchReindexPending, fetchPlaces, fetchAdminStats, fetchAdminSystem } from '../lib/apiClient.js'
import { fmtDateTime } from '../lib/format.js'
import { useAdminPendingCounts } from '../lib/useAdminPendingCounts.js'
import LoadError from '../components/LoadError.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { REWARD_ICON } from '../data/categoryImages.js'
import AdminPageHeader from './ui/AdminPageHeader.jsx'
import Button from './ui/Button.jsx'
import StatCard from './ui/StatCard.jsx'
import Facts from './ui/Facts.jsx'
import SegmentedTabs from './ui/SegmentedTabs.jsx'
import TripStatsSection from './TripStatsSection.jsx'

const POLL_MS = 2500
const num = (v) => Number(v).toLocaleString('th-TH')

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
  { key: 'events', label: 'กิจกรรม' },
  { key: 'knowledgeBase', label: 'ฐานความรู้' },
]

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
  if (error) return <div className="ad-error-text ad-fs-xs ad-mt-sm">โหลดรายการไม่สำเร็จ: {error}</div>
  if (items === null) return <div className="ad-fs-xs ad-text-muted ad-mt-sm">กำลังโหลดรายการ...</div>

  const sections = PENDING_SECTIONS.map((s) => ({ ...s, rows: items[s.key] || [] })).filter((s) => s.rows.length)
  if (!sections.length) return <div className="ad-fs-xs ad-text-muted ad-mt-sm">ไม่มีรายการค้างอัปเดตดัชนี</div>

  return (
    <div className="ad-pending-wrap">
      {sections.map((s) => (
        <div key={s.key}>
          <div className="ad-pending-head">{s.label} ({s.rows.length})</div>
          <ul className="ad-pending-list">
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
    else if (s.state === 'error') actions.showToast('อัปเดตดัชนีค้นหาไม่สำเร็จ: ' + s.error, 2400, 'error')
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
    <div className="ad-panel ad-panel--tall ad-fade-up">
      <div className="ad-between">
        <div>
          <div className="ad-panel__title ad-panel__title--tight">ดัชนีค้นหาแชทบอท (Embedding)</div>
          <div className="ad-fs-xs ad-text-muted">
            {checking ? 'กำลังตรวจสอบสถานะ...' : status === null ? 'ตรวจสอบสถานะไม่สำเร็จ' : pendingCount > 0
              ? <>มี {pendingCount} รายการที่เพิ่ม/แก้ไขแล้วยังไม่อัปเดตดัชนี{' · '}
                <button type="button" className="ad-link-inline" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
                  {expanded ? 'ซ่อนรายการ' : 'ดูรายการ'}
                </button>
              </>
              : 'ดัชนีค้นหาเป็นปัจจุบันแล้ว'}
            {status?.finishedAt && status.state !== 'running' && ` · รันล่าสุด ${formatTime(status.finishedAt)}`}
          </div>
        </div>
        <Button onClick={run} disabled={busy || checking}>
          <RefreshCw size={14} strokeWidth={2.5} aria-hidden="true" className={status?.state === 'running' ? 'ad-spin' : undefined} />
          {status?.state === 'running' ? 'กำลังอัปเดต...' : retrying ? 'ลองใหม่' : 'อัปเดตดัชนีค้นหา'}
        </Button>
      </div>
      {error && <div className="ad-error-text ad-fs-xs ad-mt-sm">เชื่อมต่อ chatbot-service ไม่สำเร็จ: {error}</div>}
      {status?.state === 'error' && <div className="ad-error-text ad-fs-xs ad-mt-sm">เกิดข้อผิดพลาด: {status.error}</div>}
      {expanded && <PendingList items={pendingItems} error={pendingError} />}
    </div>
  )
}


const lsGet = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } }

// Slim pending-work strip: loud only when something is waiting.
function PendingStrip({ pending }) {
  if (!pending.loaded) return <div className="ad-strip ad-strip--ok">กำลังตรวจสอบงานค้าง...</div>
  if (pending.reports + pending.requests === 0) {
    return (
      <div className="ad-strip ad-strip--ok">
        <CheckCircle2 size={16} aria-hidden="true" /> ไม่มีงานค้าง
      </div>
    )
  }
  return (
    <div className="ad-strip ad-strip--warn" role="status">
      <span className="ad-strip__label">งานค้าง</span>
      {pending.reports > 0 && (
        <Link to="/admin/reports" className="ad-strip__link"><Flag size={14} aria-hidden="true" /> รายงานข้อมูลรอตรวจสอบ <b>{pending.reports}</b></Link>
      )}
      {pending.requests > 0 && (
        <Link to="/admin/event-requests" className="ad-strip__link"><Inbox size={14} aria-hidden="true" /> คำขอกิจกรรมรออนุมัติ <b>{pending.requests}</b></Link>
      )}
    </div>
  )
}

const NOTICE_KEY = 'admin.dashboard.adminNoticeDismissed'

function AdminCountNotice({ count }) {
  const [dismissed, setDismissed] = useState(() => lsGet(NOTICE_KEY) === '1')
  if (dismissed) return null
  return (
    <div className="ad-notice" role="status">
      <TriangleAlert size={16} aria-hidden="true" style={{ flex: '0 0 auto', marginTop: 3 }} />
      <div className="ad-notice__text">
        มี admin ใช้งานได้ {count} คน ควรเพิ่มบัญชีสำรองด้วย <code>node scripts/create-admin.js อีเมล รหัสผ่าน</code> (ในโฟลเดอร์ backend)
      </div>
      <button type="button" className="ad-notice__close" aria-label="ปิดการแจ้งเตือน" onClick={() => { lsSet(NOTICE_KEY, '1'); setDismissed(true) }}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

function RecentRedemptions({ stats }) {
  return (
    <div className="ad-panel ad-panel--tight">
      <h3 className="ad-panel__title">การแลกของรางวัลล่าสุด</h3>
      {!stats ? (
        <div className="ad-fs-sm ad-text-muted">กำลังโหลด...</div>
      ) : stats.recentRedemptions.length === 0 ? (
        <EmptyState compact icon={REWARD_ICON} title="ยังไม่มีการแลกของรางวัล" />
      ) : (
        <div className="ad-redemption-compact">
          {stats.recentRedemptions.map((r) => (
            <div key={r.id} className={`ad-redemption${r.status === 'cancelled' ? ' is-cancelled' : ''}`}>
              <span><b>{r.userName}</b> แลก {r.rewardName} ({r.cost} พอยท์){r.status === 'cancelled' && <span className="ad-text-danger"> · ยกเลิกแล้ว</span>}</span>
              <span className="ad-text-muted">{fmtDateTime(r.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Which build each service is running. The frontend's own build is known
// client-side; backend and chatbot are asked via the admin API. Differing
// commit SHAs mean a deploy only partly landed.
function SystemVersionCard() {
  const [system, setSystem] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetchAdminSystem().then(setSystem).catch(() => setError(true))
  }, [])

  const frontend = { version: __APP_VERSION__, sha: __GIT_SHA__ || null }
  const rows = [
    { label: 'Frontend', info: frontend },
    { label: 'Backend', info: system?.backend },
    { label: 'Chatbot', info: system?.chatbot },
  ]
  const shas = rows.map((r) => r.info?.sha).filter(Boolean)
  const drifted = system && new Set(shas).size > 1
  const chatbotDown = system && !system.chatbot

  return (
    <div className="ad-panel ad-panel--tall ad-fade-up">
      <h3 className="ad-panel__title">เวอร์ชันระบบ</h3>
      <div className="ad-meta-rows">
        {rows.map(({ label, info }) => (
          <div key={label}>
            <span className="ad-meta-label">{label}</span>
            {info
              ? <span className="ad-count-chip">v{info.version}{info.sha && <span className="ad-mono"> ({info.sha})</span>}</span>
              : <span className="ad-text-danger">{error || system ? 'ติดต่อไม่ได้' : 'กำลังตรวจสอบ...'}</span>}
          </div>
        ))}
      </div>
      {(drifted || chatbotDown || error) && (
        <div className="ad-error-text ad-fs-xs ad-mt-sm">
          {error ? 'โหลดข้อมูลเวอร์ชันไม่สำเร็จ' : drifted ? 'แต่ละส่วนรันคนละ commit — การ deploy อาจยังไม่ครบ' : 'ติดต่อ chatbot-service ไม่ได้'}
        </div>
      )}
    </div>
  )
}


const TABS = [
  { id: 'overview', label: 'ภาพรวม' },
  { id: 'users', label: 'ผู้ใช้และรางวัล' },
  { id: 'trips', label: 'แผนทริป' },
]
const TAB_KEY = 'admin.dashboard.tab'

export default function DashboardTab() {
  const { state, actions } = useApp()
  const [placesCount, setPlacesCount] = useState(null)
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState(false)
  const [tab, setTab] = useState(() => {
    const saved = lsGet(TAB_KEY)
    return TABS.some((t) => t.id === saved) ? saved : 'overview'
  })
  // Same counts the sidebar badges show (one shared request).
  const pending = useAdminPendingCounts()

  const changeTab = (id) => { setTab(id); lsSet(TAB_KEY, id) }

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
  const stat = (v) => state.dataLoading ? '–' : v
  const n = (v) => (stats ? v : '–')
  const statsFailed = statsError && <LoadError message="โหลดสถิติผู้ใช้ไม่สำเร็จ" onRetry={loadStats} />

  return (
    <>
      <AdminPageHeader title="แดชบอร์ด" />
      <PendingStrip pending={pending} />
      <SegmentedTabs tabs={TABS} value={tab} onChange={changeTab} label="หมวดสถิติแดชบอร์ด" idPrefix="dash" />

      <div key={tab} className="ad-tabpanel" role="tabpanel" id={`dash-panel-${tab}`} aria-labelledby={`dash-tab-${tab}`} tabIndex={0}>
        {tab === 'overview' && (
          <>
            {stats && stats.activeAdmins < 2 && <AdminCountNotice count={stats.activeAdmins} />}
            {statsFailed}
            <div className="ad-kpi-row">
              <StatCard icon={<MapPin size={18} />} value={placesCount == null ? '–' : placesCount} label="สถานที่" tone="success" />
              <StatCard icon={<CalendarDays size={18} />} value={stat(state.events.length)} label="กิจกรรม" tone="warning" />
              <StatCard icon={<Users size={18} />} value={n(stats?.users.total)} label="ผู้ใช้ทั้งหมด" tone="success" />
              <StatCard icon={<UserPlus size={18} />} value={n(stats?.users.newLast7Days)} label="สมัครใหม่ 7 วัน" tone="success" />
              <StatCard icon={<ScanLine size={18} />} value={n(stats?.scansLast7Days)} label="สแกน QR 7 วัน" tone="info" />
            </div>
            <Facts
              title="ตัวเลขอื่นๆ"
              items={[
                { label: 'ฐานความรู้แชทบอท', value: stat(state.knowledgeBase.length) },
                { label: 'QR ทั้งหมด', value: stat(state.qrs.length) },
                { label: 'ของรางวัล', value: stat(state.rewards.length) },
                { label: 'พอยท์ที่แจกไปแล้ว', value: stats ? num(stats.points.distributed) : '–' },
              ]}
            />
            <div className="ad-two-col">
              <ReindexCard />
              <SystemVersionCard />
            </div>
          </>
        )}

        {tab === 'users' && (
          <>
            {statsFailed}
            <Facts
              title="ผู้ใช้และพอยท์"
              items={[
                { label: 'ถูกระงับ', value: n(stats?.users.suspended), tone: stats?.users.suspended ? 'danger' : undefined },
                { label: 'ยังไม่ยืนยันอีเมล', value: n(stats?.users.unverified) },
                { label: 'พอยท์คงค้างในบัญชีผู้ใช้', value: stats ? num(stats.points.outstanding) : '–' },
                { label: 'แลกของรางวัล 30 วัน', value: n(stats?.redemptionsLast30Days) },
              ]}
            />
            <RecentRedemptions stats={stats} />
          </>
        )}

        {tab === 'trips' && <TripStatsSection />}
      </div>
    </>
  )
}
