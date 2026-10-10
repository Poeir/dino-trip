import { useEffect, useRef, useState } from 'react'
import { Eye, MoreHorizontal, Trash2 } from 'lucide-react'
import Button from './Button.jsx'
import { useConfirm } from './ConfirmDialog.jsx'

// "⋯" overflow menu: a real <button> trigger with aria-haspopup, arrow-key navigation, Esc to close
// (focus returns to the trigger) and click-outside to close.
function ActionMenu({ label, items }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    rootRef.current?.querySelector('[role="menuitem"]')?.focus()
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onMenuKeyDown = (e) => {
    const els = [...rootRef.current.querySelectorAll('[role="menuitem"]')]
    const i = els.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus() }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); triggerRef.current?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div className="ad-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ad-menu__btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="ad-menu__list" role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`ad-menu__item${it.danger ? ' is-danger' : ''}`}
              onClick={() => { setOpen(false); triggerRef.current?.focus(); it.onClick() }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Shared card for places / events / knowledge / QR / rewards.
//
//   media       node at the top (an ImageSlot or icon tile)
//   title / subtitle / children  body content
//   onView      renders a secondary "ดู" button (read-only details) before "แก้ไข"
//   onEdit      renders the primary "แก้ไข" button
//   actions     extra buttons shown beside it
//   menuItems   extra "⋯" items [{ label, onClick, danger?, icon? }]
//   onDelete    async () => void -- runs only after the user confirms in a ConfirmDialog that names
//               `itemName`. Delete is always inside the "⋯" menu, never a top-level button.
//   deleteMessage / deleteLabel  override the confirmation copy
export default function EntityCard({
  media, title, subtitle, children, onEdit, editLabel = 'แก้ไข', actions, menuItems = [],
  onDelete, itemName, deleteMessage, deleteLabel = 'ลบ', dim = false, mediaOverlay, tile = false, onView,
}) {
  const { confirm, confirmDialog } = useConfirm()
  const name = itemName || (typeof title === 'string' ? title : 'รายการนี้')

  const handleDelete = async () => {
    const res = await confirm({
      title: `ลบ “${name}”?`,
      message: deleteMessage || `“${name}” จะถูกลบถาวร และกู้คืนไม่ได้`,
      confirmLabel: `${deleteLabel} “${name.length > 24 ? `${name.slice(0, 24)}…` : name}”`,
      danger: true,
    })
    if (res) await onDelete()
  }

  const items = [
    ...menuItems,
    ...(onDelete ? [{ label: deleteLabel, danger: true, icon: <Trash2 size={15} aria-hidden="true" />, onClick: handleDelete }] : []),
  ]

  // The dialog is a sibling of the card, not a child: the card gets `transform` on hover, which would
  // turn it into the containing block of the modal's `position: fixed` overlay (clipped + flickering).
  return (
    <>
    <article className={`ad-card ad-entity${dim ? ' is-dim' : ''}`}>
      {media && (
        <div className={`ad-entity__media${tile ? ' ad-entity__media--tile' : ''}`}>
          {media}
          {mediaOverlay}
        </div>
      )}
      <div className="ad-entity__body">
        <div className="ad-entity__title">{title}</div>
        {subtitle && <div className="ad-entity__sub">{subtitle}</div>}
        {children}
      </div>
      <div className="ad-entity__actions">
        {onView && (
          <Button variant="secondary" size="sm" onClick={onView} aria-label={`ดูรายละเอียด ${name}`}>
            <Eye size={14} aria-hidden="true" />
            ดู
          </Button>
        )}
        {onEdit && <Button variant="soft" size="sm" onClick={onEdit}>{editLabel}</Button>}
        {actions}
        {items.length > 0 && <ActionMenu label={`ตัวเลือกเพิ่มเติมของ ${name}`} items={items} />}
      </div>
    </article>
    {confirmDialog}
    </>
  )
}
