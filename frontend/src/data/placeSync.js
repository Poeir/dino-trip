// Labels for the Google-sync / report vocabulary (mirrors
// backend/src/lib/placeFields.js -- keep the keys in step).
export const SYNC_FIELD_LABEL = {
  name: 'ชื่อ',
  address: 'ที่อยู่',
  location: 'ตำแหน่งบนแผนที่',
  hours: 'เวลาทำการ',
  phone: 'เบอร์โทร',
  website: 'เว็บไซต์',
  business_status: 'สถานะกิจการ',
}
export const SYNC_FIELDS = Object.keys(SYNC_FIELD_LABEL)

// What a tourist can flag. `closed` is the report-side name for business_status.
export const REPORT_FIELD_LABEL = {
  name: 'ชื่อสถานที่',
  address: 'ที่อยู่',
  location: 'ตำแหน่งบนแผนที่',
  hours: 'เวลาทำการ',
  phone: 'เบอร์โทร',
  website: 'เว็บไซต์',
  closed: 'สถานที่ปิดแล้ว / ปิดชั่วคราว',
  photos: 'รูปภาพ',
  other: 'อื่นๆ',
}
export const REPORT_FIELDS = Object.keys(REPORT_FIELD_LABEL)

// Report field -> sync field an admin can re-pull from Google (none for photos/other).
export const REPORT_TO_SYNC_FIELD = {
  name: 'name', address: 'address', location: 'location', hours: 'hours',
  phone: 'phone', website: 'website', closed: 'business_status',
}

export const BUSINESS_STATUS_LABEL = {
  OPERATIONAL: 'เปิดให้บริการ',
  CLOSED_TEMPORARILY: 'ปิดชั่วคราว',
  CLOSED_PERMANENTLY: 'ปิดถาวร',
}

// Renders a column patch from google_diff ({ hours: '...', hours_periods: ... })
// as text an admin can compare at a glance.
export function describeFieldValue(field, patch) {
  if (!patch) return '-'
  if (field === 'location') return patch.lat != null ? `${Number(patch.lat).toFixed(6)}, ${Number(patch.lng).toFixed(6)}` : '-'
  if (field === 'hours') return patch.hours || '-'
  if (field === 'business_status') return BUSINESS_STATUS_LABEL[patch.business_status] || patch.business_status || '-'
  const v = patch[field]
  return v == null || v === '' ? '-' : String(v)
}
