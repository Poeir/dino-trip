import PageControls from '../components/PageControls.jsx'
import AdminPageHeader from './ui/AdminPageHeader.jsx'
import FilterChips from './ui/FilterChips.jsx'
import ListState from './ui/ListState.jsx'
import { fmtDateTime } from '../lib/format.js'

// Shared shell for the admin review queues (place reports, event reports, event
// requests): header with count, status filter chips, loading/error/empty states,
// the list and the pager.
//
//   paged        - usePagedList() result
//   filters      - [{ key, label }];  status / onStatus - selected key + setter
//   countText    - e.g. "12 สถานที่" (shown instead while loading: "กำลังโหลด...")
export function ReportQueue({ title, subtitle, countText, filters, status, onStatus, paged, errorText, emptyText, filterLabel = 'กรองตามสถานะ', children }) {
  const noRows = paged.rows.length === 0
  return (
    <>
      <AdminPageHeader
        title={title}
        subtitle={subtitle}
        actions={<span className="ad-fs-sm ad-text-muted" aria-live="polite">{paged.loading ? 'กำลังโหลด...' : countText}</span>}
      />
      <div className="ad-toolbar">
        <FilterChips label={filterLabel} options={filters.map((f) => ({ value: f.key, label: f.label }))} value={status} onChange={onStatus} />
      </div>
      <ListState
        loading={!paged.error && noRows && paged.loading}
        error={paged.error ? errorText : false}
        empty={!paged.error && noRows && !paged.loading}
        emptyText={emptyText}
        onRetry={paged.refetch}
      />
      {!paged.error && !noRows && (
        <div className={`ad-stack ad-fade${paged.loading ? ' is-loading' : ''}`}>{children}</div>
      )}
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </>
  )
}

// One record in a queue: a header row (name, badges, meta, optional action) and
// sections underneath. `actions` renders at the right end of the header.
export default function ReportQueueCard({ title, meta, badges, actions, children }) {
  return (
    <div className="ad-card">
      <div className="ad-card__head">
        <div className="ad-card__title">{title}</div>
        {meta}
        {badges}
        {actions && <span className="ad-card__push">{actions}</span>}
      </div>
      {children}
    </div>
  )
}

// One reported field of a record: label + report count, the individual notes and
// the action buttons (rendered by the caller, usually only for pending reports).
export function ReportFieldSection({ label, badges, reports, resolutionLabel = {}, extra, actions }) {
  return (
    <div className="ad-card__section">
      <div className="ad-card__head ad-card__head--bare">
        <span className="ad-field-label">{label}</span>
        {badges}
      </div>
      <ul className="ad-note-list">
        {reports.map((r) => (
          <li key={r.id}>
            {r.note ? `“${r.note}”` : <span className="ad-text-muted">(ไม่มีหมายเหตุ)</span>}
            <span className="ad-text-muted"> — {r.reporter}, {fmtDateTime(r.createdAt)}{r.resolution ? ` · ${resolutionLabel[r.resolution]}` : ''}</span>
          </li>
        ))}
      </ul>
      {extra}
      {actions && <div className="ad-actions">{actions}</div>}
    </div>
  )
}
