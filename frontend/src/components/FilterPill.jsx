// Single source of truth for filter pills (places categories, event status, ...).
// Styles live in index.css (.dc-pill) so every page renders them identically.
// `tone` (ongoing | upcoming | ended | cancelled) colors the pill by meaning; omit for the default green.
export default function FilterPill({ active, icon, tone, onClick, children }) {
  return (
    <button type="button" aria-pressed={!!active} data-tone={tone || undefined} onClick={onClick} className={`dc-pill${active ? ' is-active' : ''}${icon ? ' has-icon' : ''}`}>
      {icon}
      {children}
    </button>
  )
}
