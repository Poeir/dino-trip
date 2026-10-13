import { ExternalLink } from 'lucide-react'
import ImageSlot from '../../components/ImageSlot.jsx'
import Modal from '../../components/Modal.jsx'
import { EVENT_ICON } from '../../data/categoryImages.js'
import Badge from '../ui/Badge.jsx'
import Button from '../ui/Button.jsx'
import FormSection from '../ui/FormSection.jsx'
import { InfoGrid, InfoRow } from '../ui/InfoGrid.jsx'

export const TIME_STATUS_LABEL = { ongoing: 'กำลังจัดอยู่', upcoming: 'เร็วๆ นี้', ended: 'จบแล้ว', cancelled: 'ยกเลิก' }

const todayIso = new Date().toISOString().slice(0, 10)

// Mirrors chatbot-service/src/services/rag/embedder.py's expiry rule: an event whose end date (or
// start date, if no end was given) is in the past gets its embedding cleared on the next reindex,
// so it drops out of chatbot search even before that run has actually happened.
export function IndexStatusBadge({ event: e }) {
  const end = e.eventEndDate || e.eventStartDate
  if (end && end < todayIso) return <Badge>หมดงานแล้ว · ไม่อยู่ในดัชนีค้นหา</Badge>
  if (e.isEmbedded) return <Badge tone="success">อยู่ในดัชนีค้นหาแชทบอทแล้ว</Badge>
  return <Badge tone="warning">ยังไม่ได้ทำดัชนีค้นหา</Badge>
}

// Read-only view of one event for the admin grid. `event` is the list row (rowToEvent shape).
export default function EventDetailModal({ event, onClose, onEdit }) {
  const e = event
  const images = e?.images?.length ? e.images : (e?.img ? [e.img] : [])
  const rows = e ? [
    ['ช่วงวันจัดงาน', e.dateRange], ['สถานที่จัดงาน', e.venueName],
    ['ค่าเข้างาน', e.admission], ['ผู้จัดงาน', e.organizer],
    ['เหมาะสำหรับ', e.suitableFor?.length ? e.suitableFor.join(', ') : null],
  ].filter(([, v]) => v) : []

  return (
    <Modal
      open={!!e}
      onClose={onClose}
      title={e?.name || 'รายละเอียดกิจกรรม'}
      size="lg"
      footer={e && (
        <>
          <Button variant="secondary" onClick={onClose}>ปิด</Button>
          <Button onClick={() => { onClose(); onEdit(e) }}>แก้ไข</Button>
        </>
      )}
    >
      {e && (
        <>
          <div className="ad-detail__head">
            <div className="ad-detail__hero">
              <ImageSlot src={images[0]} shape="rect" placeholder="ภาพงาน" icon={EVENT_ICON} />
            </div>
            <div className="ad-chips">
              <Badge tone={e.status === 'cancelled' ? 'danger' : 'info'}>{TIME_STATUS_LABEL[e.timeStatus] || 'ยังไม่ระบุวันที่'}</Badge>
              {e.category && <Badge>{e.category}</Badge>}
              <IndexStatusBadge event={e} />
            </div>
            <a className="ad-detail__weblink" href={`/events/${e.id}`} target="_blank" rel="noopener noreferrer">
              เปิดในหน้าเว็บ <ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>

          {images.length > 1 && (
            <div className="ad-detail__thumbs">
              {images.slice(1, 9).map((src) => (
                <div key={src} className="ad-detail__thumb"><ImageSlot src={src} shape="rect" imgWidth={160} /></div>
              ))}
            </div>
          )}

          <FormSection title="ข้อมูลกิจกรรม" first>
            <InfoGrid>
              {rows.map(([label, v]) => <InfoRow key={label} label={label}>{v}</InfoRow>)}
              {e.placeId && (
                <InfoRow label="สถานที่ในระบบ"><a href={`/places/${e.placeId}`} target="_blank" rel="noopener noreferrer">เปิดหน้าสถานที่</a></InfoRow>
              )}
            </InfoGrid>
          </FormSection>

          {e.desc && (
            <FormSection title="รายละเอียดงาน"><p className="ad-detail__text">{e.desc}</p></FormSection>
          )}
        </>
      )}
    </Modal>
  )
}
