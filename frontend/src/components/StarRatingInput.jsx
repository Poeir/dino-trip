import { useState } from 'react'

const STAR_COUNT = 5
const emptyColor = '#DCD8C6'
const filledColor = '#F5A623'

// Half-star clicks (left half of a star = x.5, right half = x.0), matching
// the ★ N.N text PlaceCard.jsx already shows on the public site -- so this
// stays the same visual language, not a new one. Clicking sets a value in
// [0.5, 5] by construction, so out-of-range input just isn't reachable this
// way; the numeric field next to it stays editable too, for the one case
// this can't cover -- correcting a Google-imported rating (e.g. 4.3) to its
// exact original value, which half-star clicks would otherwise round away.
export default function StarRatingInput({ value, onChange }) {
  const [hoverValue, setHoverValue] = useState(null)
  const numeric = parseFloat(value)
  const hasValue = !isNaN(numeric)
  const display = hoverValue !== null ? hoverValue : (hasValue ? numeric : 0)

  const fillFor = (starIndex) => {
    const diff = display - (starIndex - 1)
    if (diff >= 1) return '100%'
    if (diff >= 0.5) return '50%'
    return '0%'
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 2 }} onMouseLeave={() => setHoverValue(null)}>
        {Array.from({ length: STAR_COUNT }, (_, i) => i + 1).map((n) => (
          <span key={n} style={{ position: 'relative', fontSize: 26, lineHeight: 1 }}>
            <span style={{ color: emptyColor }}>★</span>
            <span style={{ position: 'absolute', inset: 0, overflow: 'hidden', width: fillFor(n), color: filledColor, pointerEvents: 'none' }}>★</span>
            <span
              role="button"
              aria-label={`ให้คะแนน ${n - 0.5} ดาว`}
              onMouseEnter={() => setHoverValue(n - 0.5)}
              onClick={() => onChange(String(n - 0.5))}
              style={{ position: 'absolute', inset: '0 50% 0 0', cursor: 'pointer' }}
            />
            <span
              role="button"
              aria-label={`ให้คะแนน ${n} ดาว`}
              onMouseEnter={() => setHoverValue(n)}
              onClick={() => onChange(String(n))}
              style={{ position: 'absolute', inset: '0 0 0 50%', cursor: 'pointer' }}
            />
          </span>
        ))}
      </div>
      <input
        type="number" min={0} max={5} step={0.1}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          // DB column is numeric(2,1) -- 1 decimal place. Round here so what
          // the admin sees never silently changes after save/reload; rounding
          // happens on blur (not onChange) so it doesn't fight someone still
          // mid-typing "4.5" one keystroke at a time.
          const n = parseFloat(e.target.value)
          if (!isNaN(n)) onChange(String(Math.round(n * 10) / 10))
        }}
        placeholder="-"
        style={{ width: 64, border: '1px solid #DCD8C6', borderRadius: 8, padding: '6px 8px', fontSize: 13.5 }}
      />
      {hasValue && (
        <button type="button" onClick={() => onChange('')} style={{ background: 'none', border: 'none', color: '#a33232', fontSize: 12, cursor: 'pointer', padding: 0 }}>ล้างค่า</button>
      )}
    </div>
  )
}
