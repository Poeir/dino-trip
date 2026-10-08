import { useLayoutEffect, useRef, useState } from 'react'

// Accessible in-page tabs (WAI-ARIA tabs pattern, automatic activation).
// tabs: [{ id, label, count? }];  value: active id.  Panels are rendered by the
// caller with role="tabpanel", id=`${idPrefix}-panel-${id}` and
// aria-labelledby=`${idPrefix}-tab-${id}`.
export default function SegmentedTabs({ tabs, value, onChange, label, idPrefix = 'tabs' }) {
  const refs = useRef({})
  const listRef = useRef(null)
  // Sliding pill behind the active tab. Until it has been measured (or if measuring is impossible)
  // the active tab keeps its own background, so nothing depends on this working.
  const [pill, setPill] = useState(null)

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[value]
      if (!el || el.offsetWidth === 0) return
      setPill((p) => (p && p.x === el.offsetLeft && p.w === el.offsetWidth ? p : { x: el.offsetLeft, w: el.offsetWidth }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined' || !listRef.current) return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(listRef.current)
    return () => ro.disconnect()
  }, [value, tabs])

  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.id === value)
    let next = null
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next == null) return
    e.preventDefault()
    const id = tabs[next].id
    onChange(id)
    refs.current[id]?.focus()
  }

  return (
    <div ref={listRef} className={`ad-seg${pill ? ' has-indicator' : ''}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {pill && <span className="ad-seg__indicator" aria-hidden="true" style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} />}
      {tabs.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            className={`ad-seg__tab${active ? ' is-active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
