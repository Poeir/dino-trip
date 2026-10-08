import { Check, AlertCircle } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'

// Position comes from .dc-toast in index.css: bottom-right on desktop, a full-
// width strip above the bottom nav on phones (where the nav would cover it).
// `toastTone` is 'success' (default) or 'error'; errors use role="alert" and
// a red background so a failure never reads as a green check.
export default function Toast() {
  const { state } = useApp()
  if (!state.toastMsg) return null
  const isError = state.toastTone === 'error'
  const Icon = isError ? AlertCircle : Check
  return (
    <div role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} className="dc-toast" style={{ background: isError ? '#a33232' : '#1B5E20', color: '#fff', padding: '13px 22px', borderRadius: 14, fontSize: 13.5, fontWeight: 700, boxShadow: '0 14px 30px rgba(0,0,0,0.25)', animation: 'dc-pop 0.25s ease both', zIndex: 'var(--z-toast, 1100)' }}>
      <Icon size={16} strokeWidth={3} style={{ verticalAlign: '-3px' }} /> {state.toastMsg}
    </div>
  )
}
