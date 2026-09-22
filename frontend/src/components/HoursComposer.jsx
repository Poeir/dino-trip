import { useEffect, useState } from 'react'

const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
const timeStyle = { border: '1px solid #DCD8C6', borderRadius: 8, padding: '6px 8px', fontSize: 13 }
const radioLabelStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }
const defaultRange = () => ({ start: '08:00', end: '18:00' })
const defaultPerDay = () => DAYS.map(() => ({ open: true, ranges: [defaultRange()] }))

// <input type="time">'s value attribute requires zero-padded "HH:MM" --
// data actually in the DB (checked directly) is often single-digit ("6:00",
// "0:00" for midnight), including from this exact composer's older/Google-
// imported values, so parsed times need re-padding before going into state.
const pad = (t) => t.replace(/^(\d):/, '0$1:')

// A day's text after "วัน<name>: " is either "ปิดทำการ" or one or more
// "H:MM–H:MM" ranges joined by ", " -- the comma-joined form covers the
// lunch-break pattern seen in real data (e.g. "9:30–11:30, 13:30–15:30").
function parseDayText(text) {
  if (text === 'ปิดทำการ') return { open: false, ranges: [defaultRange()] }
  const ranges = text.split(', ').map((part) => {
    const m = part.match(/^(\d{1,2}:\d{2})–(\d{1,2}:\d{2})$/)
    return m ? { start: pad(m[1]), end: pad(m[2]) } : null
  })
  return ranges.every(Boolean) ? { open: true, ranges } : null
}

// Reverses compose() below, for editing a place that already has `hours` set
// -- without this, opening an existing place always showed the "เปิดทุกวัน
// เวลาเดียวกัน" 08:00-18:00 default regardless of what was actually saved,
// even though the raw textarea underneath showed the real text. Returns null
// for anything that doesn't match one of the composed shapes exactly (e.g.
// hand-typed text) -- the composer then just stays on its own default
// state, same as before this existed, rather than guessing.
function parseHours(value) {
  if (!value) return null
  if (value === 'สอบถามเวลาทำการ') return { mode: 'unknown' }
  if (value === 'ทุกวัน เปิด 24 ชั่วโมง') return { mode: 'allDay' }

  // H:MM, not always zero-padded HH:MM -- see `pad` above.
  const sameMatch = value.match(/^ทุกวัน (\d{1,2}:\d{2})–(\d{1,2}:\d{2})$/)
  if (sameMatch) return { mode: 'same', sameHours: { start: pad(sameMatch[1]), end: pad(sameMatch[2]) } }

  const lines = value.split('\n')
  if (lines.length !== DAYS.length) return null
  const perDay = lines.map((line, i) => {
    const dayMatch = line.match(new RegExp(`^วัน${DAYS[i]}: (.+)$`))
    return dayMatch ? parseDayText(dayMatch[1]) : null
  })
  return perDay.every(Boolean) ? { mode: 'perDay', perDay } : null
}

// Matches the shapes hours actually take in the DB (checked directly): ~72%
// "ทุกวัน H:MM–H:MM" (same every day), ~23% one line per day ("วันจันทร์:
// H:MM–H:MM", "ปิดทำการ", or comma-joined ranges for a lunch break), ~26%
// "สอบถามเวลาทำการ" (unset) -- plus "ทุกวัน เปิด 24 ชั่วโมง", common enough
// in practice (mostly hospitals/gas stations/24hr convenience stores) that
// it gets its own mode rather than forcing an 00:00–23:59 workaround through
// "same". Defaulting to "same every day" (the common case) with per-day as
// an expansion, instead of always showing all 7 rows, mirrors that real
// distribution.
export default function HoursComposer({ value, onCompose }) {
  const [mode, setMode] = useState('same') // 'same' | 'allDay' | 'perDay' | 'unknown'
  const [sameHours, setSameHours] = useState(defaultRange())
  const [perDay, setPerDay] = useState(defaultPerDay())

  const compose = (nextMode, nextSame, nextPerDay) => {
    if (nextMode === 'unknown') return onCompose('สอบถามเวลาทำการ')
    if (nextMode === 'allDay') return onCompose('ทุกวัน เปิด 24 ชั่วโมง')
    if (nextMode === 'same') return onCompose(`ทุกวัน ${nextSame.start}–${nextSame.end}`)
    onCompose(
      nextPerDay
        .map((d, i) => `วัน${DAYS[i]}: ${d.open ? d.ranges.map((r) => `${r.start}–${r.end}`).join(', ') : 'ปิดทำการ'}`)
        .join('\n')
    )
  }

  const switchMode = (next) => {
    setMode(next)
    compose(next, sameHours, perDay)
  }

  const updateSame = (patch) => {
    const next = { ...sameHours, ...patch }
    setSameHours(next)
    compose(mode, next, perDay)
  }

  const updateDay = (index, patch) => {
    const next = perDay.map((d, i) => (i === index ? { ...d, ...patch } : d))
    setPerDay(next)
    compose(mode, sameHours, next)
  }

  const updateDayRange = (dayIndex, rangeIndex, patch) => {
    const nextRanges = perDay[dayIndex].ranges.map((r, i) => (i === rangeIndex ? { ...r, ...patch } : r))
    updateDay(dayIndex, { ranges: nextRanges })
  }

  // Second (or later) range on a day is for a lunch-break-style gap, e.g.
  // "9:30–11:30, 13:30–15:30" -- seen often enough in real data (restaurants
  // closing between lunch and dinner service) to support directly instead
  // of forcing that day into free-text edits of the composed textarea.
  const addDayRange = (dayIndex) => updateDay(dayIndex, { ranges: [...perDay[dayIndex].ranges, defaultRange()] })
  const removeDayRange = (dayIndex, rangeIndex) =>
    updateDay(dayIndex, { ranges: perDay[dayIndex].ranges.filter((_, i) => i !== rangeIndex) })

  // onCompose only ever fires from an onChange handler above -- so a new
  // place left on this section's default selection ("เปิดทุกวัน เวลาเดียวกัน"
  // 08:00-18:00, already checked/shown on screen) never actually pushed that
  // value up to the parent form. It saved with an empty `hours` string, so
  // nothing showed on the place detail page despite the composer visually
  // showing a selection. A brand-new place (`!value`) auto-composes that
  // default up immediately. An existing place instead gets parsed back into
  // this component's own state (see parseHours) so the radio/time inputs
  // reflect what's actually saved -- and, since the parsed value already
  // matches `value`, does NOT call onCompose (that would be a no-op write,
  // not a fix). An unparseable existing value (hand-typed text) just leaves
  // the composer on its default state, same as before this existed --
  // untouched until the admin actually interacts with it.
  useEffect(() => {
    if (!value) {
      compose(mode, sameHours, perDay)
      return
    }
    const parsed = parseHours(value)
    if (!parsed) return
    setMode(parsed.mode)
    if (parsed.sameHours) setSameHours(parsed.sameHours)
    if (parsed.perDay) setPerDay(parsed.perDay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={radioLabelStyle}><input type="radio" checked={mode === 'same'} onChange={() => switchMode('same')} /> เปิดทุกวัน เวลาเดียวกัน</label>
        <label style={radioLabelStyle}><input type="radio" checked={mode === 'allDay'} onChange={() => switchMode('allDay')} /> เปิดทุกวัน 24 ชั่วโมง</label>
        <label style={radioLabelStyle}><input type="radio" checked={mode === 'perDay'} onChange={() => switchMode('perDay')} /> ตั้งเวลาแยกแต่ละวัน</label>
        <label style={radioLabelStyle}><input type="radio" checked={mode === 'unknown'} onChange={() => switchMode('unknown')} /> ยังไม่ระบุ / สอบถามหน้าร้าน</label>
      </div>

      {mode === 'same' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="time" value={sameHours.start} onChange={(e) => updateSame({ start: e.target.value })} style={timeStyle} />
          <span style={{ color: '#8a938c' }}>ถึง</span>
          <input type="time" value={sameHours.end} onChange={(e) => updateSame({ end: e.target.value })} style={timeStyle} />
        </div>
      )}

      {mode === 'perDay' && (
        <div>
          {DAYS.map((day, di) => (
            <div key={day} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
              <span style={{ width: 78, fontSize: 12.5, color: '#3c463f', paddingTop: 6 }}>วัน{day}</span>
              <div>
                <label style={{ ...radioLabelStyle, fontSize: 12.5, marginBottom: perDay[di].open ? 4 : 0 }}>
                  <input type="checkbox" checked={perDay[di].open} onChange={(e) => updateDay(di, { open: e.target.checked })} /> เปิด
                </label>
                {perDay[di].open && (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {perDay[di].ranges.map((r, ri) => (
                      <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="time" value={r.start} onChange={(e) => updateDayRange(di, ri, { start: e.target.value })} style={timeStyle} />
                        <span style={{ color: '#8a938c' }}>ถึง</span>
                        <input type="time" value={r.end} onChange={(e) => updateDayRange(di, ri, { end: e.target.value })} style={timeStyle} />
                        {perDay[di].ranges.length > 1 && (
                          <button type="button" onClick={() => removeDayRange(di, ri)} style={{ background: 'none', border: 'none', color: '#a33232', fontSize: 12, cursor: 'pointer', padding: '2px 4px' }}>
                            ลบ
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => addDayRange(di)} style={{ background: 'none', border: 'none', color: '#2E7D32', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '2px 0', textAlign: 'left', width: 'fit-content' }}>
                      + เพิ่มช่วงเวลา (เช่น พักเที่ยง)
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
