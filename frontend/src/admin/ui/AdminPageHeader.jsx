export default function AdminPageHeader({ title, subtitle, actions }) {
  return (
    <div className="ad-page-header">
      <div className="ad-page-header__text">
        <h1 className="ad-page-header__title">{title}</h1>
        {subtitle && <p className="ad-page-header__sub">{subtitle}</p>}
      </div>
      {actions && <div className="ad-page-header__actions">{actions}</div>}
    </div>
  )
}
