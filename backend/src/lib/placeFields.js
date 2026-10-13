// Shared vocabulary for the Google-sync / lock / report system. A "sync field"
// is the unit an admin locks and the sync service compares; each maps to one
// or more places columns. Mirrors the CHECK constraints in
// 20260929000002_place_sync_and_reports.sql -- keep the two in step.
export const SYNC_FIELDS = ['name', 'address', 'location', 'hours', 'phone', 'website', 'business_status']

// What a user can point at in a report. `closed` is about business_status;
// `photos` and `other` have no Google-syncable counterpart.
export const REPORT_FIELDS = ['name', 'address', 'location', 'hours', 'phone', 'website', 'closed', 'photos', 'other']
export const REPORT_TO_SYNC_FIELD = {
  name: 'name', address: 'address', location: 'location', hours: 'hours',
  phone: 'phone', website: 'website', closed: 'business_status',
}

export const FIELD_COLUMNS = {
  name: ['name'],
  address: ['address'],
  location: ['lat', 'lng'],
  hours: ['hours', 'hours_periods'],
  phone: ['phone'],
  website: ['website'],
  business_status: ['business_status'],
}

const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

// null / '' / undefined are all "no value"; numbers compare with a tolerance
// so a coordinate that round-trips through a form doesn't look edited;
// objects (jsonb) compare structurally.
export function sameValue(a, b) {
  if (isBlank(a) && isBlank(b)) return true
  if (isBlank(a) || isBlank(b)) return false
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 1e-7
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return String(a).trim() === String(b).trim()
}

// Sync fields whose columns an admin edit actually changes. Only columns
// present in `payload` are compared, so an edit path that doesn't touch a
// column (placePayload never sends website/hours_periods) can't lock it.
export function changedSyncFields(current, payload) {
  const changed = []
  for (const field of SYNC_FIELDS) {
    const cols = FIELD_COLUMNS[field].filter((c) => c in payload)
    if (cols.some((c) => !sameValue(current[c], payload[c]))) changed.push(field)
  }
  return changed
}
