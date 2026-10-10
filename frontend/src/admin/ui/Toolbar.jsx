// search: { value, onChange(string), placeholder?, label? } -- label becomes the aria-label.
// filters: node (e.g. <FilterChips/>);  sort: { value, onChange(value), options: [{value,label}], label? };  count: node/string.
export default function Toolbar({ search, filters, sort, count }) {
  return (
    <div className="ad-toolbar">
      {search && (
        <input
          type="search"
          className="ad-toolbar__search"
          aria-label={search.label || search.placeholder || 'ค้นหา'}
          placeholder={search.placeholder || 'ค้นหา...'}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
        />
      )}
      {filters}
      {sort && (
        <select className="ad-toolbar__sort" aria-label={sort.label || 'เรียงลำดับ'} value={sort.value} onChange={(e) => sort.onChange(e.target.value)}>
          {sort.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {count != null && <span className="ad-toolbar__count" aria-live="polite">{count}</span>}
    </div>
  )
}
