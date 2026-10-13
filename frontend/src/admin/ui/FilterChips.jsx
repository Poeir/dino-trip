import FilterPill from '../../components/FilterPill.jsx'

// options: [{ value, label, icon?, tone? }];  value: the selected option's value.
// Wraps FilterPill (aria-pressed is set there) in a wrapping row.
export default function FilterChips({ options, value, onChange, label }) {
  return (
    <div className="ad-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <FilterPill key={String(o.value)} active={value === o.value} icon={o.icon} tone={o.tone} onClick={() => onChange(o.value)}>
          {o.label}
        </FilterPill>
      ))}
    </div>
  )
}
