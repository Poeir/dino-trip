// Dense definition-list of secondary numbers: label left, value right,
// 1 column on phones and up to 3 on wide screens. items: [{ label, value, tone? }]
export default function Facts({ items, title }) {
  return (
    <section className="ad-facts" aria-label={title}>
      {title && <h3 className="ad-facts__title">{title}</h3>}
      <dl className="ad-facts__list">
        {items.map((it) => (
          <div key={it.label} className="ad-facts__row">
            <dt className="ad-facts__label" title={it.label}>{it.label}</dt>
            <dd className={`ad-facts__value${it.tone === 'danger' ? ' is-danger' : ''}`}>{it.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
