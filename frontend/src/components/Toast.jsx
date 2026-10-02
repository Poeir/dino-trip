import { useApp } from '../context/AppContext.jsx'

// Position comes from .dc-toast in index.css: bottom-right on desktop, a full-
// width strip above the bottom nav on phones (where the nav would cover it).
export default function Toast() {
  const { state } = useApp()
  if (!state.toastMsg) return null
  return (
    <div role="status" aria-live="polite" className="dc-toast" style={{ background: '#1B5E20', color: '#fff', padding: '13px 22px', borderRadius: 14, fontSize: 13.5, fontWeight: 700, boxShadow: '0 14px 30px rgba(0,0,0,0.25)', animation: 'dc-pop 0.25s ease both', zIndex: 90 }}>
      ✓ {state.toastMsg}
    </div>
  )
}
