import { ArrowRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from './ImageSlot.jsx'
import { fetchPlaces, fetchEvents } from '../lib/apiClient.js'
import { placeCategoryIcon, EVENT_ICON } from '../data/categoryImages.js'

const PLACE_LIMIT = 5
const EVENT_LIMIT = 3

// Home hero search: shows matching places/events as you type (debounced, one
// request each); submitting (button / Enter) opens the full /places list with
// the same term, which AppContext's searchQuery carries over.
export default function HeroSearch() {
  const { state, actions } = useApp()
  const query = state.searchQuery.trim()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState({ query: '', places: [], events: [] })
  const boxRef = useRef(null)

  useEffect(() => {
    if (!query) return undefined
    let cancelled = false
    const t = setTimeout(() => {
      Promise.all([
        fetchPlaces({ search: query, limit: PLACE_LIMIT, isActive: true }).then((r) => r.data).catch(() => []),
        fetchEvents({ search: query, limit: EVENT_LIMIT }).then((r) => r.data).catch(() => []),
      ]).then(([places, events]) => { if (!cancelled) setResult({ query, places, events }) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const loaded = result.query === query
  const rows = [
    ...result.places.map((p) => ({ key: `p${p.id}`, img: p.img, icon: placeCategoryIcon(p.category), title: p.name, sub: p.category, onPick: () => actions.openPlace(p.id) })),
    ...result.events.map((e) => ({ key: `e${e.id}`, img: e.img, icon: EVENT_ICON, title: e.name, sub: 'กิจกรรม', onPick: () => actions.openEvent(e.id) })),
  ]
  const showList = open && !!query

  return (
    <div ref={boxRef} style={{ position: 'relative', maxWidth: 480 }}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); setOpen(false); actions.goPlaces() }} style={{ display: 'flex', background: '#fff', borderRadius: 16, padding: '6px 6px 6px 18px', boxShadow: '0 14px 30px rgba(0,0,0,0.2)' }}>
        <input
          value={state.searchQuery}
          onChange={(e) => { actions.onSearchChange(e); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="ค้นหาสถานที่ กิจกรรม..."
          aria-label="ค้นหาสถานที่และกิจกรรม"
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 14.5, padding: '10px 0' }}
        />
        <button type="submit" style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', borderRadius: 11, padding: '10px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>ค้นหา</button>
      </form>
      {showList && (
        <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 20, background: '#fff', borderRadius: 16, boxShadow: '0 18px 40px rgba(0,0,0,0.25)', overflow: 'hidden', maxHeight: 360, overflowY: 'auto' }}>
          {!loaded && <div style={{ padding: '14px 18px', fontSize: 13.5, color: '#6d7a72' }}>กำลังค้นหา...</div>}
          {loaded && rows.length === 0 && <div style={{ padding: '14px 18px', fontSize: 13.5, color: '#6d7a72' }}>ไม่พบผลลัพธ์สำหรับ "{query}"</div>}
          {loaded && rows.map((r) => (
            <button key={r.key} type="button" role="option" onClick={() => { setOpen(false); r.onPick() }} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', borderBottom: '1px solid #F0EDDF', cursor: 'pointer' }}>
              <ImageSlot src={r.img} shape="rect" radius={10} style={{ width: 44, height: 44, flexShrink: 0 }} placeholder="" icon={r.icon} iconSize={28} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 14, color: '#1f2a24', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: '#6d7a72' }}>{r.sub}</span>
              </span>
            </button>
          ))}
          {loaded && rows.length > 0 && (
            <button type="button" onClick={() => { setOpen(false); actions.goPlaces() }} style={{ width: '100%', padding: '12px 14px', background: '#F4F9F4', border: 'none', color: '#1B5E20', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ดูผลลัพธ์ทั้งหมดในสถานที่ <ArrowRight size={14} strokeWidth={2.4} style={{ verticalAlign: '-2px' }} /></button>
          )}
        </div>
      )}
    </div>
  )
}
