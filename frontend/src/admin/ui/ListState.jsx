import Button from './Button.jsx'

// Renders loading / error / empty feedback; returns null when there is nothing to show
// so callers can write <ListState .../> followed by the list.
export default function ListState({ loading, error, empty, emptyText = 'ยังไม่มีข้อมูล', onRetry }) {
  if (loading) {
    return (
      <div className="ad-skel" role="status" aria-busy="true">
        <span className="ad-sr">กำลังโหลด...</span>
        <div className="ad-skel__row" aria-hidden="true" />
        <div className="ad-skel__row" aria-hidden="true" />
        <div className="ad-skel__row" aria-hidden="true" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="ad-state ad-state--error" role="alert">
        <span>{typeof error === 'string' ? error : 'โหลดข้อมูลไม่สำเร็จ'}</span>
        {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>ลองอีกครั้ง</Button>}
      </div>
    )
  }
  if (empty) return <div className="ad-state">{emptyText}</div>
  return null
}
