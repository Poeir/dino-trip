import { Link } from 'react-router-dom'
import useCountUp from '../hooks/useCountUp.js'

// Only plain integers (optionally comma-grouped, with a non-numeric prefix/suffix such as "฿")
// count up. Anything else ("–", "2.5", "12 (50%)") renders as given.
function parseCountable(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? { prefix: '', n: value, suffix: '', group: false } : null
  if (typeof value !== 'string') return null
  const m = value.match(/^(\D*?)(\d{1,3}(?:,\d{3})+|\d+)(\D*)$/)
  if (!m) return null
  const n = parseInt(m[2].replace(/,/g, ''), 10)
  return Number.isSafeInteger(n) ? { prefix: m[1], n, suffix: m[3], group: m[2].includes(',') } : null
}

function StatValue({ value }) {
  const parsed = parseCountable(value)
  const shown = useCountUp(parsed ? parsed.n : null)
  // `shown` is still null on the render where `value` first becomes a number (the hook's effect
  // hasn't run yet), so fall back to the raw value instead of formatting null.
  if (!parsed || shown == null || shown === parsed.n) return <span className="ad-stat__value">{value}</span>
  const text = parsed.group ? shown.toLocaleString('th-TH') : String(shown)
  return (
    <span className="ad-stat__value">
      <span aria-hidden="true">{parsed.prefix}{text}{parsed.suffix}</span>
      <span className="ad-sr">{value}</span>
    </span>
  )
}

// `icon` is a rendered lucide element; `to` turns the card into a link.
// Labels are kept to one line (ellipsis + title) so card heights stay equal.
export default function StatCard({ icon, value, label, tone = 'neutral', to }) {
  const body = (
    <>
      {icon && <span className="ad-stat__icon" aria-hidden="true">{icon}</span>}
      <span className="ad-stat__text">
        <StatValue value={value} />
        <span className="ad-stat__label" title={typeof label === 'string' ? label : undefined}>{label}</span>
      </span>
    </>
  )
  const cls = `ad-stat ad-stat--${tone}`
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>
}
