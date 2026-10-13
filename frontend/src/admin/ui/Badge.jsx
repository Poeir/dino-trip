// tone: neutral | success | warning | danger | info
export default function Badge({ tone = 'neutral', icon, children }) {
  return (
    <span className={`ad-badge ad-badge--${tone}`}>
      {icon}
      {children}
    </span>
  )
}
