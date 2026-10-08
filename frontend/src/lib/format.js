// Shared date formatters (Thai locale). Both return '-' for empty input.
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-')

// Accepts a plain YYYY-MM-DD string (pg DATE columns are plain strings) or an ISO timestamp.
// `dateStyle` is Intl's 'long' (default) | 'medium' | 'short'.
export const fmtDate = (d, dateStyle = 'long') => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('th-TH', { dateStyle }) : '-')
