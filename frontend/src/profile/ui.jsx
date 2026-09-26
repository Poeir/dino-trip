// Small shared building blocks for the profile tabs (inline styles, like the rest of the app).

export const inputStyle = { width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, background: '#fff' }

export const primaryBtn = (disabled) => ({
  background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '11px 24px', borderRadius: 20,
  fontSize: 14, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
})
export const ghostBtn = { background: '#fff', color: '#4a544d', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 20, fontSize: 14, fontWeight: 700, cursor: 'pointer' }
export const dangerBtn = (disabled) => ({
  background: '#a33232', color: '#fff', border: 'none', padding: '11px 24px', borderRadius: 20, fontSize: 14, fontWeight: 800,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
})

// A section of the profile sheet: separated from its neighbours by the dashed
// rule in .dc-sec rather than boxed. `danger` is the one boxed, red-tinted variant.
export function Card({ title, subtitle, danger, action, children }) {
  const box = danger ? { border: '1px solid #e6b8b8', background: '#fff8f8', borderRadius: 14, padding: '18px 20px', margin: '22px 0 0' } : null
  return (
    <section className={box ? undefined : 'dc-sec'} style={box || undefined}>
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          {title && <h2 data-font="culture" style={{ margin: 0, fontSize: 18, fontWeight: 800, color: danger ? '#a33232' : '#1B5E20' }}>{title}</h2>}
          {action}
        </div>
      )}
      {subtitle && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6d7a72', lineHeight: 1.6, maxWidth: 620 }}>{subtitle}</p>}
      <div style={{ marginTop: title ? 14 : 0 }}>{children}</div>
    </section>
  )
}

// role="status"/"alert" so a screen reader announces the result of a save.
export function Notice({ kind = 'error', children }) {
  if (!children) return null
  const ok = kind === 'success'
  return (
    <div role={ok ? 'status' : 'alert'} style={{ background: ok ? '#E8F5E9' : '#fdecec', color: ok ? '#1B5E20' : '#a33232', fontSize: 13, padding: '9px 12px', borderRadius: 8, margin: '12px 0' }}>
      {children}
    </div>
  )
}

export const formGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }
