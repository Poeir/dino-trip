import ImageSlot from './ImageSlot.jsx'
import { ChecklistIcon, StarIcon, PinIcon, ClockIcon, PhoneIcon, RouteIcon, PencilIcon, ShareArrowIcon, AmenityIcon } from './Icons.jsx'

const mockReviews = [
  { stars: 5, name: 'นักท่องเที่ยว', text: 'บริการดี บรรยากาศน่ามาเยือน แนะนำมาก' },
  { stars: 5, name: 'คนขอนแก่น', text: 'มาบ่อยมาก ทุกครั้งประทับใจ พนักงานยิ้มแย้มเป็นกันเอง' },
  { stars: 4, name: 'สายเที่ยวไทย', text: 'โดยรวมดีมาก ที่จอดรถสะดวก แต่ช่วงเย็นคนค่อนข้างเยอะ' },
  { stars: 5, name: 'ผู้มาเยือน', text: 'ถ่ายรูปสวย เหมาะกับครอบครัว เด็กๆ ชอบมาก' },
  { stars: 4, name: 'นักชิม', text: 'คุ้มค่ากับราคา จะกลับมาใช้บริการอีกแน่นอน' },
]

export default function PlaceDetailView({ place: p, imageHeight = 460 }) {
  if (!p || !p.id) return null
  const reviewsToShow = p.reviewsList && p.reviewsList.length ? p.reviewsList : mockReviews
  const mapQuery = p.location ? `${p.location.lat},${p.location.lng}` : p.address
  const mapEmbedSrc = mapQuery ? `https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=15&output=embed` : null
  return (
    <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 22, padding: 32, boxShadow: '0 14px 34px rgba(46,125,50,0.08)' }}>
      <div data-role="place-detail-grid" style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 32, alignItems: 'start' }}>
        <div data-role="place-detail-media" style={{ position: 'sticky', top: 88 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#2E7D32', background: '#E8F5E9', padding: '4px 11px', borderRadius: 10 }}>{p.category}</span>
            {p.hasQR && <span style={{ fontSize: 12, fontWeight: 700, color: '#7A5205', background: '#FFF8E1', padding: '4px 11px', borderRadius: 10 }}>มี QR รับพอยท์ +{p.qrPoints}</span>}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1B5E20', margin: '0 0 8px', lineHeight: 1.25 }}>{p.name}</h1>
          <div style={{ fontWeight: 300, fontSize: 14, color: '#6d7a72', marginBottom: 16 }}>★ {p.rating} ({p.reviews} รีวิว) · {p.price}</div>
          <div style={{ borderRadius: 16, overflow: 'hidden' }}>
            <ImageSlot src={p.img} shape="rect" style={{ width: '100%', height: imageHeight }} placeholder="แกลเลอรีภาพสถานที่" />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            {p.mapsUrl && <a href={p.mapsUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><RouteIcon size={16} color="#fff" box={false} />เปิดเส้นทาง Google Maps</a>}
            {p.phone && <a href={`tel:${p.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', color: '#1f2a24', border: '1px solid #DCD8C6', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><PhoneIcon size={16} color="#1f2a24" box={false} />โทรติดต่อ</a>}
            <button style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', color: '#1f2a24', border: '1px solid #DCD8C6', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><PencilIcon size={16} color="#1f2a24" box={false} />เขียนรีวิว</button>
            <button style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', color: '#1f2a24', border: '1px solid #DCD8C6', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><ShareArrowIcon size={16} color="#1f2a24" box={false} />แชร์</button>
          </div>
        </div>
        <div>
          <p style={{ fontSize: 15, lineHeight: 1.75, color: '#3c463f', margin: '0 0 24px' }}>{p.desc}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <ChecklistIcon />
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1B5E20', margin: 0 }}>สิ่งอำนวยความสะดวก</h3>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>
            {(p.amenities || []).map((am, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, background: '#F1F8E9', border: '1px solid #C8E6C9', padding: '6px 13px', borderRadius: 14, color: '#2E7D32' }}>
                <AmenityIcon label={am} />
                {am}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <StarIcon />
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1B5E20', margin: 0 }}>รีวิวจากผู้เยี่ยมชม</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {reviewsToShow.map((r, i) => (
              <div key={i} style={{ border: '1px solid #E7E3D2', borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 400, fontSize: 14, color: '#1f2a24' }}>{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)} {r.name}</div>
                <div style={{ fontWeight: 300, fontSize: 13.5, color: '#6d7a72', marginTop: 6 }}>{r.text}</div>
              </div>
            ))}
          </div>
          <button style={{ width: '100%', background: '#fff', color: '#2E7D32', border: '1px solid #C8E6C9', padding: 11, borderRadius: 14, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', marginBottom: 20 }}>ดูรีวิวเพิ่มเติม</button>
          <div data-role="place-detail-info-grid" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ border: '1px solid #E7E3D2', borderRadius: 14, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ transform: 'scale(0.65)', transformOrigin: 'left center', display: 'flex' }}><PinIcon /></span>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#1B5E20' }}>ที่อยู่ &amp; แผนที่</span>
              </div>
              <div style={{ fontWeight: 300, fontSize: 13.5, color: '#3c463f', marginBottom: 12 }}>{p.address}</div>
              {mapEmbedSrc ? (
                <iframe
                  title={`แผนที่ ${p.name}`}
                  src={mapEmbedSrc}
                  width="100%"
                  height={360}
                  style={{ border: 0, borderRadius: 10, display: 'block' }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              ) : (
                <ImageSlot shape="rounded" radius={10} style={{ width: '100%', height: 360 }} placeholder="แผนที่ Google Maps" />
              )}
            </div>
            <div style={{ border: '1px solid #E7E3D2', borderRadius: 14, padding: 18, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ transform: 'scale(0.65)', transformOrigin: 'left center', display: 'flex' }}><ClockIcon /></span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#1B5E20' }}>เวลาทำการ</span>
                </div>
                <div style={{ fontWeight: 300, fontSize: 13.5, color: '#3c463f', whiteSpace: 'pre-line' }}>{p.hours}</div>
              </div>
              <div style={{ flex: 1, minWidth: 180, borderLeft: '1px solid #E7E3D2', paddingLeft: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ transform: 'scale(0.65)', transformOrigin: 'left center', display: 'flex' }}><PhoneIcon /></span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#1B5E20' }}>ข้อมูลติดต่อ</span>
                </div>
                <div style={{ fontWeight: 300, fontSize: 13.5, color: '#3c463f' }}>โทร: {p.phone || 'ไม่มีข้อมูล'}</div>
                {p.website && <div style={{ fontSize: 13.5, marginTop: 4 }}><a href={p.website} target="_blank" rel="noreferrer" style={{ color: '#2E7D32', fontWeight: 700 }}>เว็บไซต์ / เพจร้าน ↗</a></div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
