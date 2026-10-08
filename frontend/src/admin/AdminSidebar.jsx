import { BookOpen, CalendarDays, Flag, Gift, Inbox, LayoutDashboard, LogOut, MapPin, QrCode, Route, Ticket, Users, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { useAdminPendingCounts } from '../lib/useAdminPendingCounts.js'
import { adminTabs } from '../data/seed.js'

const ICONS = {
  dashboard: LayoutDashboard,
  places: MapPin,
  events: CalendarDays,
  knowledge: BookOpen,
  reports: Flag,
  'event-requests': Inbox,
  qr: QrCode,
  rewards: Gift,
  redeem: Ticket,
  users: Users,
  trips: Route,
}

const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'
// Keep in step with the breakpoints in admin.css: <= 760px the sidebar is an off-canvas drawer.
const DRAWER_MQ = '(max-width: 760px)'

// `open` / `onClose` drive the mobile drawer; above 760px the sidebar is always visible
// (full width, or an icon rail <= 1024px) and these are ignored.
export default function AdminSidebar({ open = false, onClose }) {
  const { actions } = useApp()
  const { tab = 'dashboard' } = useParams()
  const asideRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Pending-report badge; refreshed whenever the admin switches tab (e.g. after
  // clearing the queue) rather than polled.
  const { reports: pendingReports, requests: pendingRequests } = useAdminPendingCounts(tab)

  // Drawer: focus trap, Esc to close, restore focus, close if the viewport grows past the breakpoint.
  useEffect(() => {
    if (!open) return
    const aside = asideRef.current
    const previouslyFocused = document.activeElement
    const first = aside?.querySelector(FOCUSABLE)
    first?.focus({ preventScroll: true })

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return }
      if (e.key !== 'Tab' || !aside) return
      const items = Array.from(aside.querySelectorAll(FOCUSABLE))
      if (items.length === 0) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && active === lastEl) { e.preventDefault(); firstEl.focus() }
      else if (!aside.contains(active)) { e.preventDefault(); firstEl.focus() }
    }
    const mq = window.matchMedia(DRAWER_MQ)
    const onMq = () => { if (!mq.matches) closeRef.current?.() }
    window.addEventListener('keydown', onKey)
    mq.addEventListener('change', onMq)
    return () => {
      window.removeEventListener('keydown', onKey)
      mq.removeEventListener('change', onMq)
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [open])

  const badgeFor = (key) => (key === 'reports' ? pendingReports : key === 'event-requests' ? pendingRequests : 0)

  // Consecutive tabs sharing a group render under one heading.
  const groups = []
  for (const t of adminTabs) {
    const last = groups[groups.length - 1]
    if (last && last.name === t.group) last.tabs.push(t)
    else groups.push({ name: t.group, tabs: [t] })
  }

  const handleNavigate = () => {
    actions.cancelForm()
    onClose?.()
  }

  return (
    <>
      {/* Always mounted so it can fade out; hidden (display/visibility) unless the drawer is open. */}
      <div className="ad-backdrop" data-open={open ? 'true' : 'false'} onClick={open ? onClose : undefined} aria-hidden="true" />
      <aside
        ref={asideRef}
        className="ad-sidebar"
        data-open={open ? 'true' : 'false'}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? 'true' : undefined}
        aria-label={open ? 'เมนูผู้ดูแลระบบ' : undefined}
      >
        <div className="ad-sidebar__brand">
          <img src="/assets/dino-logo-mark.png" alt="" className="ad-sidebar__logo" />
          <div className="ad-sidebar__brand-text">
            <div className="ad-sidebar__title">Dino Admin</div>
            <div className="ad-sidebar__sub">ขอนแก่น</div>
          </div>
          <button type="button" className="ad-sidebar__close" onClick={onClose} aria-label="ปิดเมนู"><X size={20} /></button>
        </div>

        <nav className="ad-sidebar__nav" aria-label="เมนูผู้ดูแลระบบ">
          {groups.map((g) => (
            <div key={g.name} className="ad-nav__group" role="group" aria-label={g.name}>
              <div className="ad-nav__heading" aria-hidden="true">{g.name}</div>
              {g.tabs.map((t) => {
                const Icon = ICONS[t.icon]
                const badge = badgeFor(t.key)
                return (
                  // Link + manual active state rather than NavLink: `/admin` (no tab) is the dashboard too.
                  <Link
                    key={t.key}
                    to={`/admin/${t.key}`}
                    className={`ad-nav__link${t.key === tab ? ' is-active' : ''}`}
                    aria-current={t.key === tab ? 'page' : undefined}
                    title={t.label}
                    onClick={handleNavigate}
                  >
                    {Icon && <Icon size={18} strokeWidth={2} className="ad-nav__icon" aria-hidden="true" />}
                    <span className="ad-nav__label">{t.label}</span>
                    {badge > 0 && (
                      <span className="ad-nav__badge">
                        {badge > 99 ? '99+' : badge}
                        <span className="ad-sr"> รายการรอตรวจสอบ</span>
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="ad-sidebar__footer">
          <button type="button" className="ad-nav__logout" onClick={actions.adminLogout} title="ออกจากระบบ">
            <LogOut size={18} strokeWidth={2} className="ad-nav__icon" aria-hidden="true" />
            <span className="ad-nav__label">ออกจากระบบ</span>
          </button>
        </div>
      </aside>
    </>
  )
}
