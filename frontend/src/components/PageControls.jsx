// Numbered pager -- shared by every server-paginated list (admin tables and
// the public places/events pages, all driven by usePagedList.js). Jumps
// straight to any page instead of forcing prev/next one click at a time,
// with an ellipsis so a 20+ page list doesn't render 20+ buttons.
const PILL = 34

function Chevron({ direction }) {
  return (
    <svg width={9} height={14} viewBox="0 0 9 14" fill="none" style={{ transform: direction === 'right' ? 'scaleX(-1)' : undefined }}>
      <path d="M7.5 1 1.5 7l6 6" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// e.g. page=6, totalPages=19 -> [1, '…', 5, 6, 7, '…', 19]
function pageList(page, totalPages) {
  const keep = new Set([1, totalPages, page - 1, page, page + 1])
  const pages = [...keep].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const withDots = []
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) withDots.push('…')
    withDots.push(p)
  })
  return withDots
}

function PagerButton({ active, disabled, onClick, ariaLabel, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      className={`dc-pager-btn${active ? ' dc-pager-active' : ''}`}
      style={{
        minWidth: PILL, height: PILL, padding: '0 4px', borderRadius: PILL / 2,
        border: active ? 'none' : '1px solid #DCD8C6',
        background: active ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff',
        color: active ? '#fff' : disabled ? '#c3c9c3' : '#3c463f',
        fontSize: 13, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  )
}

export default function PageControls({ page, totalPages, total, onChange }) {
  if (totalPages <= 1) return null
  return (
    <nav aria-label="เปลี่ยนหน้า" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        <PagerButton disabled={page <= 1} onClick={() => onChange(page - 1)} ariaLabel="หน้าก่อนหน้า">
          <Chevron direction="left" />
        </PagerButton>
        {pageList(page, totalPages).map((p, i) => p === '…' ? (
          <span key={`dots-${i}`} style={{ width: PILL, textAlign: 'center', color: '#626863', fontSize: 13 }}>…</span>
        ) : (
          <PagerButton key={p} active={p === page} onClick={() => onChange(p)} ariaLabel={`ไปหน้า ${p}`}>
            {p}
          </PagerButton>
        ))}
        <PagerButton disabled={page >= totalPages} onClick={() => onChange(page + 1)} ariaLabel="หน้าถัดไป">
          <Chevron direction="right" />
        </PagerButton>
      </div>
      <div style={{ fontSize: 12, color: '#626863' }}>หน้า {page} จาก {totalPages} · ทั้งหมด {total} รายการ</div>
    </nav>
  )
}
