// Shared by the admin event form (admin/events/EventFormModal.jsx) and the user-side event
// request form (profile/EventRequestsTab.jsx) so both offer the same inputs.

// Not tied to any backend taxonomy (events.category has no CHECK constraint,
// unlike places) -- just a starting-point suggestion list so people aren't
// always typing from scratch. Lifted from the examples already baked into
// the AI-extraction prompt (chatbot-service/src/api/routes_events.py) so the
// two don't suggest different vocabularies.
export const EVENT_CATEGORY_OPTIONS = ['เทศกาล', 'งานวัด/งานบุญ', 'คอนเสิร์ต/ดนตรี', 'งานประเพณี', 'นิทรรศการ', 'งานกีฬา', 'ตลาดนัด']
export const SUITABLE_FOR_OPTIONS = ['ครอบครัว', 'เด็ก', 'วัยรุ่น', 'ผู้ใหญ่', 'ผู้สูงอายุ', 'คู่รัก', 'กลุ่มเพื่อน', 'นักท่องเที่ยวต่างชาติ']

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// input[type=date] gives 'YYYY-MM-DD' (Gregorian) -- format it the way this
// admin team already writes dates by hand (see EXTRACT_FIELDS' dateRange
// example: "1-3 ธ.ค. 2569"), Buddhist Era year included.
function thaiDateParts(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return { day: d, month: THAI_MONTHS[m - 1], year: y + 543 }
}

export function formatDateRange(startIso, endIso) {
  if (!startIso && !endIso) return ''
  if (!endIso || startIso === endIso) {
    const s = thaiDateParts(startIso || endIso)
    return `${s.day} ${s.month} ${s.year}`
  }
  if (!startIso) {
    const e = thaiDateParts(endIso)
    return `${e.day} ${e.month} ${e.year}`
  }
  const s = thaiDateParts(startIso)
  const e = thaiDateParts(endIso)
  if (s.month === e.month && s.year === e.year) return `${s.day}-${e.day} ${s.month} ${s.year}`
  if (s.year === e.year) return `${s.day} ${s.month} - ${e.day} ${e.month} ${s.year}`
  return `${s.day} ${s.month} ${s.year} - ${e.day} ${e.month} ${e.year}`
}

// Which of the 3 pickers to show when the form opens. Not itself stored --
// derived fresh each time from whatever dates/text are already on the event,
// so there's nothing to keep in sync if an admin edits the row from outside
// this form.
export function inferDateMode(f) {
  const start = f.eventStartDate || ''
  const end = f.eventEndDate || ''
  if (!start && !end) return f.dateRange ? 'custom' : 'range'
  if (start && end && start !== end) return 'range'
  return 'single'
}
