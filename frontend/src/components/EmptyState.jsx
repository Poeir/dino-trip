// Shared "nothing here" block: a dashed card with an illustration (see
// data/categoryImages.js), a title, an optional description and an optional
// action. Replaces the near-identical dashed-box divs that were copied across
// the list pages and admin tabs. `compact` is for empty states nested inside
// a card/table rather than standing alone on a page.
// `mascot` (a MASCOT pose URL) takes precedence over `icon` and renders larger.
export default function EmptyState({ icon, mascot, title, desc, action, compact = false, tone = 'sand', style = {} }) {
  const border = tone === 'green' ? '#C8E6C9' : '#DCD8C6'
  const img = mascot || icon
  const size = mascot ? (compact ? 84 : 120) : (compact ? 56 : 84)
  return (
    <div
      style={{
        textAlign: 'center',
        padding: compact ? '22px 16px' : '44px 24px',
        border: compact ? 'none' : `1px dashed ${border}`,
        borderRadius: 16,
        background: compact ? 'transparent' : '#fff',
        ...style,
      }}
    >
      {img && (
        <img
          src={img}
          alt=""
          style={{ width: size, height: size, objectFit: 'contain', display: 'block', margin: '0 auto 12px' }}
        />
      )}
      <div style={{ fontWeight: 800, fontSize: compact ? 14 : 15, color: '#1B5E20', marginBottom: desc ? 4 : 0 }}>{title}</div>
      {desc && <div style={{ fontSize: 13, color: '#6d7a72', maxWidth: 340, margin: '0 auto' }}>{desc}</div>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  )
}
