import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import Avatar from './Avatar.jsx'

// Signed-in corner of the header: a points chip (links to the scan page) and one
// account button that opens the profile / history / sign-out menu.
export default function UserMenu() {
  const { state, actions } = useApp()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const user = state.currentUser

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Link to="/points" className="dc-points-chip" title="สะสมพอยท์">
        <span className="dc-points-coin" aria-hidden="true" />
        <span>{state.userPoints}</span>
        <span style={{ fontWeight: 600, opacity: 0.8 }}>พอยท์</span>
      </Link>

      <div ref={rootRef} style={{ position: 'relative' }}>
        <button type="button" className="dc-account-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
          <Avatar user={user} size={32} />
          <span className="dc-account-name">{state.userName}</span>
          <ChevronDown size={14} strokeWidth={2.2} color="#5f6a63" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
        </button>

        {open && (
          <div className="dc-account-menu" role="menu">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px 12px' }}>
              <Avatar user={user} size={44} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: '#1B5E20', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.userName}</div>
                <div style={{ fontSize: 12, color: '#626863', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
              </div>
            </div>
            <div className="dc-menu-rule" />
            <Link role="menuitem" to="/profile" className="dc-menu-item" onClick={close}>โปรไฟล์ของฉัน</Link>
            <Link role="menuitem" to="/trips" className="dc-menu-item" onClick={close}>ทริปของฉัน</Link>
            <Link role="menuitem" to="/profile?tab=events" className="dc-menu-item" onClick={close}>กิจกรรมของฉัน</Link>
            <Link role="menuitem" to="/profile?tab=history" className="dc-menu-item" onClick={close}>ประวัติพอยท์</Link>
            <div className="dc-menu-rule" />
            <button role="menuitem" type="button" className="dc-menu-item dc-menu-danger" onClick={() => { close(); actions.logout() }}>ออกจากระบบ</button>
          </div>
        )}
      </div>
    </div>
  )
}
