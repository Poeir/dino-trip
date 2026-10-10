import { StarGlyph } from './Icons.jsx'
import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from './ImageSlot.jsx'
import ImageGallery from './ImageGallery.jsx'
import ReportPlaceModal from './ReportPlaceModal.jsx'
import { MASCOT, MAP_ICON } from '../data/categoryImages.js'
import { ChecklistIcon, StarIcon, PinIcon, ClockIcon, PhoneIcon, RouteIcon, PencilIcon, ShareArrowIcon, HeartIcon, AmenityIcon, SparkleAIIcon, groupAmenities } from './Icons.jsx'

export default function PlaceDetailView({ place: p, imageHeight = 460 }) {
  const { state, actions } = useApp()
  const [reportOpen, setReportOpen] = useState(false)
  if (!p || !p.id) return null
  const reviewsToShow = p.reviewsList || []
  const mapQuery = p.location ? `${p.location.lat},${p.location.lng}` : p.address
  const mapEmbedSrc = mapQuery ? `https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=15&output=embed` : null

  // Reviews live on Google, not on our site: "write" opens Google's review form
  // for this place and "more" opens its Maps listing. Without a Google place id
  // we can only search Maps by name + address.
  const mapsListingUrl = p.googlePlaceId
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&query_place_id=${encodeURIComponent(p.googlePlaceId)}`
    : p.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.address].filter(Boolean).join(' '))}`
  const writeReviewUrl = p.googlePlaceId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(p.googlePlaceId)}` : mapsListingUrl

  // Reports need an account (spam is attributable); send visitors to log in.
  const handleReport = () => {
    if (!state.loggedIn) { actions.showToast('กรุณาเข้าสู่ระบบก่อนแจ้งข้อมูลไม่ถูกต้อง'); actions.goLogin(); return }
    setReportOpen(true)
  }

  const handleShare = async () => {
    const url = window.location.href
    if (navigator.share) {
      try { await navigator.share({ title: p.name, text: p.desc, url }) } catch { /* user cancelled */ }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      actions.showToast('คัดลอกลิงก์แล้ว')
    } catch {
      actions.showToast('คัดลอกลิงก์ไม่สำเร็จ')
    }
  }
  return (
    <div data-role="detail-card" style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 22, padding: 32, boxShadow: '0 14px 34px rgba(46,125,50,0.08)' }}>
      {/* Rendered at the root, not inside the sticky media column: a sticky
          element makes its own stacking context, which trapped the modal's
          z-index and let the transformed icons in the info cards paint over it. */}
      <ReportPlaceModal open={reportOpen} onClose={() => setReportOpen(false)} place={p} />
      <div data-role="place-detail-grid" style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 32, alignItems: 'start' }}>
        <div data-role="place-detail-media" style={{ position: 'sticky', top: 88 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#2E7D32', background: '#E8F5E9', padding: '4px 11px', borderRadius: 10 }}>{p.category}</span>
            {p.hasQR && <span style={{ fontSize: 12, fontWeight: 700, color: '#7A5205', background: '#FFF8E1', padding: '4px 11px', borderRadius: 10 }}>มี QR รับพอยท์ +{p.qrPoints}</span>}
            {p.businessStatus === 'CLOSED_TEMPORARILY' && <span style={{ fontSize: 12, fontWeight: 700, color: '#B45309', background: '#FEF3C7', padding: '4px 11px', borderRadius: 10 }}>ปิดชั่วคราว</span>}
            {p.businessStatus === 'CLOSED_PERMANENTLY' && <span style={{ fontSize: 12, fontWeight: 700, color: '#B91C1C', background: '#FEE2E2', padding: '4px 11px', borderRadius: 10 }}>ปิดถาวรแล้ว</span>}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1B5E20', margin: '0 0 8px', lineHeight: 1.25 }}>{p.name}</h1>
          <div style={{ fontWeight: 300, fontSize: 14, color: '#5f6a63', marginBottom: 16 }}><StarGlyph size={14} /> {p.rating} ({p.reviews} รีวิว) · {p.price}</div>
          {(p.tags || []).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {p.tags.map((tag, i) => (
                <span key={i} style={{ fontSize: 11.5, fontWeight: 600, color: '#5f6a63', background: '#F4F2E8', border: '1px solid #E7E3D2', padding: '3px 10px', borderRadius: 12 }}>#{tag}</span>
              ))}
            </div>
          )}
          <ImageGallery
            images={p.images && p.images.length ? p.images : (p.img ? [p.img] : [])}
            height={imageHeight}
            placeholder="แกลเลอรีภาพสถานที่"
            icon={MASCOT.camera}
            iconSize={220}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            {p.mapsUrl && <a href={p.mapsUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><RouteIcon size={16} color="#fff" box={false} />เปิดเส้นทาง Google Maps</a>}
            {p.phone && <a href={`tel:${p.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', color: '#1f2a24', border: '1px solid #DCD8C6', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><PhoneIcon size={16} color="#1f2a24" box={false} />โทรติดต่อ</a>}
            {p.onToggleFavorite && (
              <button onClick={p.onToggleFavorite} style={{ display: 'flex', alignItems: 'center', gap: 7, background: p.isFavorite ? '#FEECEC' : '#fff', color: p.isFavorite ? '#E53935' : '#1f2a24', border: p.isFavorite ? '1px solid #F5C2C2' : '1px solid #DCD8C6', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                <HeartIcon size={16} color={p.isFavorite ? '#E53935' : '#1f2a24'} box={false} />
                {p.isFavorite ? 'บันทึกแล้ว' : 'บันทึกรายการโปรด'}
              </button>
            )}
            <a href={writeReviewUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', color: '#1f2a24', border: '1px solid #DCD8C6', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><PencilIcon size={16} color="#1f2a24" box={false} />เขียนรีวิวบน Google</a>
            <button onClick={handleShare} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', color: '#1f2a24', border: '1px solid #DCD8C6', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><ShareArrowIcon size={16} color="#1f2a24" box={false} />แชร์</button>
            <button onClick={handleReport} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', color: '#5f6a63', border: '1px solid #DCD8C6', padding: '10px 18px', borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>⚑ แจ้งข้อมูลไม่ถูกต้อง</button>
          </div>
        </div>
        <div>
          <div className="dc-ai-summary">
            <div className="dc-ai-summary-inner">
              <div className="dc-ai-summary-badge">
                <SparkleAIIcon size={14} color="#2E7D32" />
                <span className="dc-ai-summary-badge-text">สรุปโดย Dino AI</span>
              </div>
              <p style={{ fontSize: 15, lineHeight: 1.75, color: '#3c463f', margin: 0 }}>{p.desc}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <ChecklistIcon />
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1B5E20', margin: 0 }}>สิ่งอำนวยความสะดวก</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px 20px', marginBottom: 28 }}>
            {groupAmenities(p.amenities || []).map(({ group, items }) => (
              <div key={group}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#5f6a63', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 7 }}>{group}</div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {items.map((am, i) => (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, background: '#F1F8E9', border: '1px solid #C8E6C9', padding: '5px 10px', borderRadius: 12, color: '#2E7D32' }}>
                      <AmenityIcon label={am} size={13} />
                      {am}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <StarIcon />
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1B5E20', margin: 0 }}>รีวิวจากผู้เยี่ยมชม</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {reviewsToShow.length === 0 && (
              <div style={{ border: '1px solid #E7E3D2', borderRadius: 12, padding: 16, fontWeight: 300, fontSize: 13.5, color: '#5f6a63', textAlign: 'center' }}>ยังไม่มีรีวิวสำหรับสถานที่นี้</div>
            )}
            {reviewsToShow.map((r, i) => (
              <div key={i} style={{ border: '1px solid #E7E3D2', borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 400, fontSize: 14, color: '#1f2a24' }}>{Array.from({ length: 5 }, (_, i) => <StarGlyph key={i} size={14} filled={i < r.stars} />)} {r.name}</div>
                <div style={{ fontWeight: 300, fontSize: 13.5, color: '#5f6a63', marginTop: 6 }}>{r.text}</div>
              </div>
            ))}
          </div>
          {reviewsToShow.length > 0 && (
            <a href={mapsListingUrl} target="_blank" rel="noreferrer" style={{ display: 'block', boxSizing: 'border-box', textAlign: 'center', width: '100%', background: '#fff', color: '#2E7D32', border: '1px solid #C8E6C9', padding: 11, borderRadius: 14, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', marginBottom: 20 }}>ดูรีวิวเพิ่มเติมบน Google Maps</a>
          )}
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
                <ImageSlot shape="rounded" radius={10} style={{ width: '100%', height: 360 }} placeholder="แผนที่ Google Maps" icon={MAP_ICON} />
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
          {(p.createdAt || p.updatedAt) && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: '#a3ab9e', marginTop: 14 }}>
              {p.createdAt && <span>เพิ่มข้อมูลเมื่อ {formatPlaceDate(p.createdAt)}</span>}
              {p.updatedAt && <span>อัปเดตล่าสุด {formatPlaceDate(p.updatedAt)}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatPlaceDate(iso) {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
}
