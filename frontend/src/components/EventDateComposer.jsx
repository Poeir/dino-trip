import { useEffect, useRef, useState } from 'react'

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

const MODE_OPTIONS = [
  { key: 'single', label: 'วันเดียว' },
  { key: 'range', label: 'ช่วงต่อเนื่องหลายวัน' },
  { key: 'custom', label: 'ไม่ต่อเนื่อง / กำหนดเอง' },
]

const pad2 = (n) => String(n).padStart(2, '0')
const toIso = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`
const parseIso = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m: m - 1, d } }
const todayIso = () => new Date().toISOString().slice(0, 10)

const navBtnStyle = { border: '1px solid #DCD8C6', background: '#fff', borderRadius: 8, width: 28, height: 28, fontSize: 15, fontWeight: 700, color: '#3c463f', cursor: 'pointer' }

// A closed-by-default popup (not a permanently-open card -- keeps the form
// from getting cluttered) that opens into a month-grid calendar. Pick a day
// by pressing down on it and dragging to another day before releasing --
// mode="single" ignores the drag and just takes wherever you release;
// mode="range"/"custom" use the press point as one end and the release
// point as the other (in whichever order), live-previewing the span while
// the mouse is still down. A plain click (press+release, no movement) is
// just a zero-length drag, so it still works as "pick one day".
export default function EventDateComposer({ mode, onModeChange, start, end, onChange, displayText }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const [hoverEnd, setHoverEnd] = useState(null)
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef(null)

  const seed = start || end || todayIso()
  const seedParts = parseIso(seed)
  const [viewYear, setViewYear] = useState(seedParts.y)
  const [viewMonth, setViewMonth] = useState(seedParts.m)

  // Closes on any click outside the trigger+popup -- standard popover
  // behaviour, and lets month-nav/mode-toggle/day-cell clicks (all inside
  // containerRef) pass through without closing.
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // Commits the drag on mouseup wherever it happens, even outside the grid
  // (letting go past the calendar's edge shouldn't strand a pending drag).
  useEffect(() => {
    if (!dragging) return
    const commit = () => {
      setDragging(false)
      if (anchor) {
        const other = hoverEnd || anchor
        onChange(anchor < other ? anchor : other, anchor < other ? other : anchor)
      }
      setAnchor(null)
      setHoverEnd(null)
      setOpen(false)
    }
    window.addEventListener('mouseup', commit)
    return () => window.removeEventListener('mouseup', commit)
  }, [dragging, anchor, hoverEnd, onChange])

  const changeMonth = (delta) => {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) { m = 11; y -= 1 }
    else if (m > 11) { m = 0; y += 1 }
    setViewMonth(m)
    setViewYear(y)
  }

  const handleDown = (iso) => {
    if (mode === 'single') { onChange(iso, iso); setOpen(false); return }
    setAnchor(iso)
    setHoverEnd(iso)
    setDragging(true)
  }

  const handleEnter = (iso) => { if (dragging) setHoverEnd(iso) }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const leadingBlanks = new Date(viewYear, viewMonth, 1).getDay()
  const today = todayIso()
  const cells = Array(leadingBlanks).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1))

  // While dragging, preview the span between anchor and the currently
  // hovered cell instead of the last committed start/end.
  const previewA = dragging && anchor ? anchor : start
  const previewB = dragging && anchor ? (hoverEnd || anchor) : end
  const rangeStart = previewA && previewB && previewA < previewB ? previewA : previewB
  const rangeEnd = previewA && previewB && previewA < previewB ? previewB : previewA

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', textAlign: 'left', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14,
          background: '#fff', color: displayText ? '#1B1F1C' : '#8a938c', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        }}
      >
        <span>{displayText || 'เลือกวันที่จัดงาน...'}</span>
        <span style={{ color: '#8a938c', fontSize: 12 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20, width: 300,
          border: '1px solid #DCD8C6', borderRadius: 12, padding: 12, background: '#fff',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => onModeChange(opt.key)}
                style={{
                  border: mode === opt.key ? 'none' : '1px solid #DCD8C6',
                  background: mode === opt.key ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff',
                  color: mode === opt.key ? '#fff' : '#3c463f',
                  padding: '5px 10px', borderRadius: 14, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" onClick={() => changeMonth(-1)} aria-label="เดือนก่อนหน้า" style={navBtnStyle}>‹</button>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1B5E20' }}>{MONTHS_FULL[viewMonth]} {viewYear + 543}</div>
            <button type="button" onClick={() => changeMonth(1)} aria-label="เดือนถัดไป" style={navBtnStyle}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
            {WEEKDAYS.map((w) => <div key={w} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#8a938c', padding: '2px 0' }}>{w}</div>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, userSelect: 'none' }}>
            {cells.map((d, i) => {
              if (d === null) return <div key={`b${i}`} />
              const iso = toIso(viewYear, viewMonth, d)
              const isEdge = mode === 'single' ? iso === start : (iso === rangeStart || iso === rangeEnd)
              const inRange = mode !== 'single' && rangeStart && rangeEnd && iso > rangeStart && iso < rangeEnd
              const isToday = iso === today
              return (
                <button
                  key={iso}
                  type="button"
                  onMouseDown={() => handleDown(iso)}
                  onMouseEnter={() => handleEnter(iso)}
                  style={{
                    aspectRatio: '1', border: 'none', borderRadius: inRange ? 4 : 8,
                    background: isEdge ? '#2E7D32' : inRange ? '#DCEDC8' : 'transparent',
                    color: isEdge ? '#fff' : '#3c463f',
                    fontWeight: isEdge || isToday ? 700 : 400,
                    fontSize: 13, cursor: 'pointer',
                    boxShadow: isToday && !isEdge ? 'inset 0 0 0 1.5px #66BB6A' : 'none',
                  }}
                >
                  {d}
                </button>
              )
            })}
          </div>

          {mode === 'custom' && (
            <div style={{ fontSize: 11, color: '#8a938c', marginTop: 10 }}>ลากเลือกช่วงครอบคลุมทั้งหมด (ไม่บังคับ) -- ใช้บอกระบบว่างานนี้ผ่านไปหรือยัง ส่วนวันที่จริงที่จัดงาน พิมพ์เองในช่องข้อความด้านล่าง</div>
          )}
          {(start || end) && (
            <button
              type="button"
              onClick={() => { onChange('', ''); setOpen(false) }}
              style={{ marginTop: 10, background: 'none', border: 'none', color: '#a33232', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}
            >
              ล้างวันที่ที่เลือก
            </button>
          )}
        </div>
      )}
    </div>
  )
}
