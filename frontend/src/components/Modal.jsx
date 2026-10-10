import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'

// Shared by public and admin pages -- keep changes additive.
//
// Props (new ones are optional):
//   footer  - node rendered in a non-scrolling bar pinned to the panel bottom
//   size    - 'sm' | 'md' | 'lg' | 'xl' shorthand for maxWidth (maxWidth wins if both are given)
//   mobile  - 'full' (default; admin shell makes the panel full-screen <= 700px via data-role)
//             or 'sheet' (bottom sheet; styled in admin/admin.css)
const SIZES = { sm: 420, md: 560, lg: 760, xl: 960 }
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Open modals, oldest first: Escape only closes the top-most one.
const modalStack = []
let scrollLocks = 0
let savedOverflow = ''

function lockScroll() {
  if (scrollLocks++ === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
}
function unlockScroll() {
  if (--scrollLocks === 0) document.body.style.overflow = savedOverflow
}

export default function Modal({ open, onClose, title, children, maxWidth, size, footer, mobile = 'full' }) {
  const panelRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const titleId = useId()
  const width = maxWidth ?? SIZES[size] ?? 640

  useEffect(() => {
    if (!open) return
    const token = {}
    modalStack.push(token)
    lockScroll()
    const previouslyFocused = document.activeElement
    const panel = panelRef.current
    // Respect autoFocus inside the modal; otherwise focus the panel itself.
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true })

    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== token) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current?.()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) { e.preventDefault(); panel.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
      else if (!panel.contains(active)) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const i = modalStack.indexOf(token)
      if (i >= 0) modalStack.splice(i, 1)
      unlockScroll()
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [open])

  if (!open) return null

  const sheet = mobile === 'sheet'
  const closeButton = (
    <button type="button" onClick={onClose} aria-label="ปิด" style={{ background: 'none', border: 'none', fontSize: 22, color: '#626863', cursor: 'pointer', lineHeight: 1, padding: 4, display: 'flex' }}><X size={22} /></button>
  )
  const header = title && (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: footer ? 0 : 18, ...(footer ? { padding: '20px 24px 14px', flex: '0 0 auto' } : {}) }}>
      <h2 id={titleId} style={{ fontSize: 17, fontWeight: 800, color: '#1B5E20', margin: 0 }}>{title}</h2>
      {closeButton}
    </div>
  )

  const panelBase = { background: '#fff', borderRadius: 16, width: `min(94vw, ${width}px)`, maxHeight: '90vh', boxShadow: 'var(--shadow-modal, 0 20px 60px rgba(0,0,0,0.25))', outline: 'none' }

  return (
    <div
      onClick={onClose}
      data-modal-overlay=""
      data-mobile={sheet ? 'sheet' : undefined}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,22,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-modal, 1000)', padding: 20 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        data-role={sheet ? undefined : 'admin-form-panel'}
        data-modal-panel=""
        onClick={(e) => e.stopPropagation()}
        style={footer
          ? { ...panelBase, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
          : { ...panelBase, padding: 24, overflowY: 'auto' }}
      >
        {footer ? (
          <>
            {header}
            <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: title ? '0 24px 16px' : '24px 24px 16px' }}>{children}</div>
            <div data-modal-footer="" style={{ flex: '0 0 auto', padding: '12px 24px', borderTop: '1px solid var(--c-line, #E7E3D2)', background: '#fff', display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{footer}</div>
          </>
        ) : (
          <>
            {header}
            {children}
          </>
        )}
      </div>
    </div>
  )
}
