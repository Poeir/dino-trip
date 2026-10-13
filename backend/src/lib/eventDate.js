// Event date text. `events.date_range` is free text (typed by hand, picked from the date pickers,
// or written by the AI extractor), so the same dates show up as "4-8 พ.ย. 2569" or
// "4-8 พฤศจิกายน 2569". eventDateLabel() gives every display surface one canonical form.
// Mirrors frontend/src/data/eventForm.js -- keep the two in sync.

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const FULL_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

const thaiParts = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { d, m: THAI_MONTHS[m - 1], y: y + 543 } }

// Display text for date_range when only dates are known ("1-3 ธ.ค. 2569").
export function formatDateRange(startIso, endIso) {
  if (!startIso && !endIso) return ''
  if (!startIso || !endIso || startIso === endIso) { const s = thaiParts(startIso || endIso); return `${s.d} ${s.m} ${s.y}` }
  const s = thaiParts(startIso)
  const e = thaiParts(endIso)
  if (s.m === e.m && s.y === e.y) return `${s.d}-${e.d} ${s.m} ${s.y}`
  if (s.y === e.y) return `${s.d} ${s.m} - ${e.d} ${e.m} ${s.y}`
  return `${s.d} ${s.m} ${s.y} - ${e.d} ${e.m} ${e.y}`
}

// Lower-level normalisation so "4-8 พฤศจิกายน 2569" and "4 – 8 พ.ย. 2569" compare equal.
function normalize(text) {
  let s = String(text)
  FULL_MONTHS.forEach((full, i) => { s = s.split(full).join(THAI_MONTHS[i]) })
  return s.replace(/[–—]/g, '-').replace(/\./g, '').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim()
}

// True when `text` just spells out start..end (in any month spelling / spacing), i.e. it carries
// nothing the dates don't. False for schedules like "ทุกวันเสาร์-อาทิตย์เดือน ธ.ค.".
export function isPlainDateText(text, startIso, endIso) {
  if (!text || !String(text).trim()) return true
  if (!startIso) return false
  const expected = normalize(formatDateRange(startIso, endIso || startIso))
  const actual = normalize(text)
  if (actual === expected) return true
  // Year left off ("4-8 พ.ย.").
  if (!/\d{4}/.test(actual)) return actual === expected.replace(/ \d{4}$/, '').replace(/ \d{4}(?=-)/, '')
  return false
}

// What to show for an event row: canonical text when the dates are known and date_range is just a
// spelling of them; otherwise the hand-written text unchanged.
export function eventDateLabel(row) {
  const start = row.event_start_date ? String(row.event_start_date).slice(0, 10) : ''
  const end = row.event_end_date ? String(row.event_end_date).slice(0, 10) : ''
  if (start && isPlainDateText(row.date_range, start, end)) return formatDateRange(start, end)
  return row.date_range || ''
}
