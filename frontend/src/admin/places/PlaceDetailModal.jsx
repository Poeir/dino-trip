import { ExternalLink, Lock } from 'lucide-react'
import ImageSlot from '../../components/ImageSlot.jsx'
import Modal from '../../components/Modal.jsx'
import { placeCategoryIcon } from '../../data/categoryImages.js'
import { SYNC_FIELD_LABEL } from '../../data/placeSync.js'
import { fmtDateTime } from '../../lib/format.js'
import Badge from '../ui/Badge.jsx'
import Button from '../ui/Button.jsx'
import FormSection from '../ui/FormSection.jsx'
import { InfoGrid, InfoRow } from '../ui/InfoGrid.jsx'

const CLOSED_LABEL = { CLOSED_PERMANENTLY: 'ปิดถาวร', CLOSED_TEMPORARILY: 'ปิดชั่วคราว' }

const linkRow = (label, url, text) => url && (
  <InfoRow label={label}><a href={url} target="_blank" rel="noopener noreferrer">{text || url}</a></InfoRow>
)

// Read-only view of one place for the admin grid. `place` is the list row (rowToPlace shape).
export default function PlaceDetailModal({ place, onClose, onEdit }) {
  const p = place
  const images = p?.images?.length ? p.images : (p?.img ? [p.img] : [])
  const rows = p ? [
    ['ที่อยู่', p.address], ['อำเภอ/เขต', p.district], ['เบอร์โทร', p.phone],
    ['เวลาเปิด-ปิด', typeof p.hours === 'string' ? p.hours : null],
    ['ระดับราคา', p.price],
    ['คะแนน', p.rating ? `${p.rating}${p.reviews ? ` (${p.reviews} รีวิว)` : ''}` : null],
    ['พิกัด', p.location ? `${p.location.lat}, ${p.location.lng}` : null],
    ['สิ่งอำนวยความสะดวก', p.amenities?.length ? p.amenities.join(', ') : null],
    ['QR สะสมแต้ม', p.hasQR ? `มี${p.qrPoints ? ` · ${p.qrPoints} แต้ม` : ''}` : null],
  ].filter(([, v]) => v) : []

  return (
    <Modal
      open={!!p}
      onClose={onClose}
      title={p?.name || 'รายละเอียดสถานที่'}
      size="lg"
      footer={p && (
        <>
          <Button variant="secondary" onClick={onClose}>ปิด</Button>
          <Button onClick={() => { onClose(); onEdit(p) }}>แก้ไข</Button>
        </>
      )}
    >
      {p && (
        <>
          <div className="ad-detail__head">
            <div className="ad-detail__hero">
              <ImageSlot src={images[0]} shape="rect" placeholder="ภาพสถานที่" icon={placeCategoryIcon(p.category)} />
            </div>
            <div className="ad-chips">
              <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'เผยแพร่' : 'ซ่อนอยู่'}</Badge>
              {p.category && <Badge>{p.category}</Badge>}
              {CLOSED_LABEL[p.businessStatus] && <Badge tone="danger">{CLOSED_LABEL[p.businessStatus]}</Badge>}
            </div>
            {p.isActive && (
              <a className="ad-detail__weblink" href={`/places/${p.id}`} target="_blank" rel="noopener noreferrer">
                เปิดในหน้าเว็บ <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
          </div>

          {images.length > 1 && (
            <div className="ad-detail__thumbs">
              {images.slice(1, 9).map((src) => (
                <div key={src} className="ad-detail__thumb"><ImageSlot src={src} shape="rect" imgWidth={160} /></div>
              ))}
            </div>
          )}

          <FormSection title="ข้อมูลทั่วไป" first>
            <InfoGrid>
              {rows.map(([label, v]) => <InfoRow key={label} label={label}>{v}</InfoRow>)}
              {linkRow('เว็บไซต์', p.website)}
              {linkRow('Google Maps', p.mapsUrl, 'เปิดแผนที่')}
            </InfoGrid>
          </FormSection>

          {(p.desc || p.tags?.length > 0) && (
            <FormSection title="รายละเอียด">
              {p.desc && <p className="ad-detail__text">{p.desc}</p>}
              {p.tags?.length > 0 && <div className="ad-chips">{p.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
            </FormSection>
          )}

          {p.googlePlaceId && (
            <FormSection title="การซิงก์ Google">
              <div className="ad-chips">
                {p.hasGoogleDiff && <Badge tone="warning">Google มีค่าใหม่</Badge>}
                {p.lockedFields?.map((x) => <Badge key={x} icon={<Lock size={11} aria-hidden="true" />}>{SYNC_FIELD_LABEL[x] || x}</Badge>)}
              </div>
              <InfoGrid>
                <InfoRow label="Google Place ID">{p.googlePlaceId}</InfoRow>
                <InfoRow label="ซิงก์ล่าสุด">{p.lastSyncedAt ? fmtDateTime(p.lastSyncedAt) : 'ยังไม่เคยซิงก์'}</InfoRow>
                {p.businessStatus && <InfoRow label="สถานะธุรกิจ">{CLOSED_LABEL[p.businessStatus] || p.businessStatus}</InfoRow>}
              </InfoGrid>
            </FormSection>
          )}
        </>
      )}
    </Modal>
  )
}
