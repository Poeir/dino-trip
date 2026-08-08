import { useEffect } from 'react'

export default function Modal({ open, onClose, title, children, maxWidth = 640 }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,22,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div
        data-role="admin-form-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, padding: 24, width: `min(94vw, ${maxWidth}px)`, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
      >
        {title && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1B5E20', margin: 0 }}>{title}</h2>
            <button onClick={onClose} aria-label="ปิด" style={{ background: 'none', border: 'none', fontSize: 22, color: '#8a938c', cursor: 'pointer', lineHeight: 1, padding: 4 }}>×</button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
