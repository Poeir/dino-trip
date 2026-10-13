import { Eye, EyeOff, Lock } from 'lucide-react'
import { StarGlyph } from '../../components/Icons.jsx'
import ImageSlot from '../../components/ImageSlot.jsx'
import { placeCategoryIcon } from '../../data/categoryImages.js'
import { SYNC_FIELD_LABEL } from '../../data/placeSync.js'
import Badge from '../ui/Badge.jsx'
import Button from '../ui/Button.jsx'
import EntityCard from '../ui/EntityCard.jsx'

const CLOSED_LABEL = { CLOSED_PERMANENTLY: 'ปิดถาวร', CLOSED_TEMPORARILY: 'ปิดชั่วคราว' }

// One place in the admin grid. Edit is the primary action, hide/show sits beside it and delete lives
// in the "⋯" menu behind a confirmation.
export default function PlaceAdminCard({ place, onView, onEdit, onDelete, onToggleActive }) {
  const p = place
  return (
    <EntityCard
      dim={!p.isActive}
      media={<ImageSlot src={p.img} shape="rect" placeholder="ภาพสถานที่" icon={placeCategoryIcon(p.category)} />}
      mediaOverlay={!p.isActive && <span className="ad-entity__badge">ซ่อนอยู่</span>}
      title={p.name}
      subtitle={<>{p.category}{p.rating ? <> · <StarGlyph /> {p.rating}</> : ''}</>}
      itemName={p.name}
      deleteMessage={`“${p.name}” จะถูกลบถาวรและกู้คืนไม่ได้ ถ้าแค่ต้องการซ่อนจากหน้าเว็บ ให้ใช้ “ซ่อนจากหน้าเว็บ” แทน`}
      onView={onView}
      onEdit={onEdit}
      onDelete={onDelete}
      actions={(
        <Button variant="secondary" size="sm" onClick={onToggleActive}>
          {p.isActive ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          {p.isActive ? 'ซ่อนจากหน้าเว็บ' : 'เผยแพร่อีกครั้ง'}
        </Button>
      )}
    >
      {p.googlePlaceId && (
        <div className="ad-sync-line">
          {p.lockedFields.length > 0 && (
            <span title={p.lockedFields.map((x) => SYNC_FIELD_LABEL[x]).join(', ')}>
              <Badge icon={<Lock size={11} aria-hidden="true" />}>ล็อก {p.lockedFields.length}</Badge>
            </span>
          )}
          {p.hasGoogleDiff && <Badge tone="warning">Google มีค่าใหม่</Badge>}
          {CLOSED_LABEL[p.businessStatus] && <Badge tone="danger">{CLOSED_LABEL[p.businessStatus]}</Badge>}
          <span className="ad-sync-line__when">{p.lastSyncedAt ? `ซิงก์ ${new Date(p.lastSyncedAt).toLocaleDateString('th-TH', { dateStyle: 'medium' })}` : 'ยังไม่เคยซิงก์'}</span>
        </div>
      )}
    </EntityCard>
  )
}
