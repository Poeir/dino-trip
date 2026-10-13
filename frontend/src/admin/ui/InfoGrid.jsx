export function InfoGrid({ children }) {
  return <dl className="ad-info">{children}</dl>
}

export function InfoRow({ label, children }) {
  return (
    <div className="ad-info__row">
      <dt className="ad-info__label">{label}</dt>
      <dd className="ad-info__value">{children ?? '-'}</dd>
    </div>
  )
}

export default InfoGrid
