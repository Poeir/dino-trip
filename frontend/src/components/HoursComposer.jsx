import { useState } from 'react'

const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
const timeStyle = { border: '1px solid #DCD8C6', borderRadius: 8, padding: '6px 8px', fontSize: 13 }
const radioLabelStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }

// Matches the 3 shapes hours actually take in the DB (checked directly):
// ~72% "ทุกวัน H:MM–H:MM" (same every day), ~23% one line per day ("วันจันทร์:
// H:MM–H:MM" / "ปิดทำการ"), ~26% "สอบถามเวลาทำการ" (unset). Defaulting to
// "same every day" (the common case) with per-day as an expansion, instead
// of always showing all 7 rows, mirrors that real distribution.
export default function HoursComposer({ onCompose }) {
  const [mode, setMode] = useState('same') // 'same' | 'perDay' | 'unknown'
  const [sameHours, setSameHours] = useState({ start: '08:00', end: '18:00' })
  const [perDay, setPerDay] = useState(DAYS.map(() => ({ open: true, start: '08:00', end: '18:00' })))

  const compose = (nextMode, nextSame, nextPerDay) => {
    if (nextMode === 'unknown') return onCompose('สอบถามเวลาทำการ')
    if (nextMode === 'same') return onCompose(`ทุกวัน ${nextSame.start}–${nextSame.end}`)
    onCompose(nextPerDay.map((d, i) => `วัน${DAYS[i]}: ${d.open ? `${d.start}–${d.end}` : 'ปิดทำการ'}`).join('\n'))
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

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={radioLabelStyle}><input type="radio" checked={mode === 'same'} onChange={() => switchMode('same')} /> เปิดทุกวัน เวลาเดียวกัน</label>
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
          {DAYS.map((day, i) => (
            <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ width: 78, fontSize: 12.5, color: '#3c463f' }}>วัน{day}</span>
              <label style={{ ...radioLabelStyle, fontSize: 12.5 }}>
                <input type="checkbox" checked={perDay[i].open} onChange={(e) => updateDay(i, { open: e.target.checked })} /> เปิด
              </label>
              {perDay[i].open && (
                <>
                  <input type="time" value={perDay[i].start} onChange={(e) => updateDay(i, { start: e.target.value })} style={timeStyle} />
                  <span style={{ color: '#8a938c' }}>ถึง</span>
                  <input type="time" value={perDay[i].end} onChange={(e) => updateDay(i, { end: e.target.value })} style={timeStyle} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
