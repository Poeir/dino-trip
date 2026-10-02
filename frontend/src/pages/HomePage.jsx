import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { CalendarIcon, PinIcon } from '../components/Icons.jsx'
import { fetchPlaces } from '../lib/apiClient.js'
import { haversineKm } from '../utils/geo.js'
import { placeCategoryIcon, EVENT_ICON, MASCOT } from '../data/categoryImages.js'

// `places` arrives rating-ranked from the API (?limit=20 still takes
// crudRouter's weighted-sort path -- see places.routes.js). When we know the
// user's location, re-rank that top-20 quality floor by distance instead of
// showing the single best-rated places regardless of how far away they are.
const NEARBY_QUALITY_POOL = 20

const heroParticles = [
  { left: '6%', top: '20%', size: 6, duration: 6.5, delay: 0 },
  { left: '16%', top: '72%', size: 4, duration: 8, delay: 1.4 },
  { left: '30%', top: '38%', size: 5, duration: 5.5, delay: 0.6 },
  { left: '46%', top: '82%', size: 3.5, duration: 7, delay: 2.1 },
  { left: '52%', top: '14%', size: 6, duration: 9, delay: 0.9 },
  { left: '64%', top: '55%', size: 4.5, duration: 6, delay: 1.8 },
  { left: '76%', top: '22%', size: 5, duration: 7.5, delay: 0.3 },
  { left: '88%', top: '64%', size: 6, duration: 8.5, delay: 2.6 },
  { left: '95%', top: '30%', size: 3.5, duration: 5, delay: 1.1 },
]

export default function HomePage() {
  const { state, actions, derived } = useApp()
  const [places, setPlaces] = useState([])
  const [placesLoading, setPlacesLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchPlaces({ limit: NEARBY_QUALITY_POOL, isActive: true })
      .then(({ data }) => { if (!cancelled) setPlaces(data) })
      .catch(() => { if (!cancelled) setPlaces([]) })
      .finally(() => { if (!cancelled) setPlacesLoading(false) })
    return () => { cancelled = true }
  }, [])

  const homePlacesRanked = state.userLocation
    ? places
        .map((p) => ({ ...p, distanceKm: p.location ? haversineKm(state.userLocation, p.location) : null }))
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    : places
  const homePlaces = homePlacesRanked.slice(0, 4).map((p) => ({
    ...p, onOpen: () => actions.openPlace(p.id), isFavorite: state.favoriteIds.includes(p.id), onToggleFavorite: () => actions.toggleFavorite(p.id),
  }))

  return (
    <>
      <main>
        <section data-role="hero-section" style={{ background: 'linear-gradient(135deg,#1B5E20,#2E7D32)', padding: '52px 32px 76px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'url(/assets/hero-pattern-bg.webp)', backgroundSize: 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: 'center 30%', opacity: 0.25, zIndex: 0, pointerEvents: 'none' }} />
          {heroParticles.map((p, i) => (
            <span
              key={i}
              style={{
                position: 'absolute', left: p.left, top: p.top, width: p.size, height: p.size,
                borderRadius: '50%', background: '#FBC02D', boxShadow: '0 0 8px 2px rgba(251,192,45,0.5)',
                animation: `dc-particle-float ${p.duration}s ease-in-out ${p.delay}s infinite`,
                pointerEvents: 'none', zIndex: 0,
              }}
            />
          ))}
          <div data-role="hero-grid" style={{ maxWidth: 1360, margin: '0 auto', display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 48, alignItems: 'center', animation: 'dc-fade-up 0.5s ease both', position: 'relative', zIndex: 1 }}>
            <div>
              <p data-font="culture" style={{ color: '#fff', fontSize: 19, fontWeight: 700, margin: '0 0 2px' }}>ยินดีต้อนรับสู่</p>
              <h1 data-role="hero-heading" data-font="culture" style={{ color: '#FBC02D', fontSize: 76, fontWeight: 900, margin: 0, lineHeight: 1.05, letterSpacing: 0.5 }}>ขอนแก่น</h1>
              <p data-font="culture" style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: '4px 0 18px' }}>ดินแดนอีสานสร้างสรรค์</p>
              <p style={{ color: '#C8E6C9', fontSize: 15.5, margin: '0 0 26px', maxWidth: 440 }}>ค้นหาสถานที่ที่เกี่ยวข้อง กิจกรรม เทศกาล และประสบการณ์สุดประทับใจ <br />สุดประทับใจในจังหวัดขอนแก่น จังหวัดแห่งผ้าไหมมัดหมี่และวัฒนธรรมอีสาน</p>
              <div style={{ display: 'flex', background: '#fff', borderRadius: 16, padding: '6px 6px 6px 18px', maxWidth: 480, boxShadow: '0 14px 30px rgba(0,0,0,0.2)' }}>
                <input value={state.searchQuery} onChange={actions.onSearchChange} placeholder="ค้นหาสถานที่ กิจกรรม..." style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14.5, padding: '10px 0' }} />
                <button style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', borderRadius: 11, padding: '10px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>ค้นหา</button>
              </div>
              <div data-role="hero-actions" style={{ display: 'flex', gap: 12, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <img src={MASCOT.point} alt="" style={{ width: 84, height: 84, objectFit: 'contain', flexShrink: 0, marginRight: -4, pointerEvents: 'none' }} />
                <div data-role="hero-chips" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div onClick={actions.goTripForm} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 14, padding: '10px 16px', cursor: 'pointer' }}>
                  <span style={{ width: 16, height: 16, background: '#FBC02D', flexShrink: 0, transform: 'rotate(45deg)', borderRadius: 3, position: 'relative' }}><span style={{ position: 'absolute', inset: 4, background: '#1B5E20', transform: 'rotate(0deg)', borderRadius: 2 }}></span></span>
                  <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>วางแผนทริป AI</span>
                </div>
                <div onClick={actions.goPoints} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 14, padding: '10px 16px', cursor: 'pointer' }}>
                  <span style={{ width: 16, height: 12, border: '2px solid #FBC02D', borderRadius: 3, position: 'relative', display: 'inline-block', flexShrink: 0 }}><span style={{ position: 'absolute', top: 1.5, left: 3, width: 6, height: 6, borderRadius: '50%', border: '1.5px solid #FBC02D' }}></span></span>
                  <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>สแกน QR สะสมพอยท์</span>
                </div>
                </div>
              </div>
            </div>
            <div data-role="hero-media" style={{ position: 'relative' }}>
              <ImageSlot src="/assets/hero-picture.webp" priority imgWidth={640} shape="rounded" radius={20} style={{ width: '100%', height: 340, boxShadow: '0 24px 50px rgba(0,0,0,0.28)' }} placeholder="ภาพจุดเด่นขอนแก่น" />
              <div style={{ position: 'absolute', bottom: -18, left: -18, background: '#fff', borderRadius: 14, padding: '12px 18px', boxShadow: '0 14px 30px rgba(0,0,0,0.18)', display: 'flex', alignItems: 'center', gap: 10, animation: 'dc-float 3.8s ease-in-out infinite' }}>
                <img src="/assets/dino-logo-mark.png" alt="" style={{ width: 28, height: 28 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#1B5E20', lineHeight: 1.2 }}>Khon Kaen</div>
                  <div style={{ fontSize: 11, color: '#5f6a63' }}>ประเทศไทย</div>
                </div>
              </div>
            </div>
          </div>
          <svg style={{ position: 'absolute', left: 0, right: 0, bottom: -1, width: '100%', height: 64, display: 'block' }} viewBox="0 0 1440 64" preserveAspectRatio="none">
            <path d="M0,34 C240,64 480,4 720,20 C960,38 1200,60 1440,28 L1440,64 L0,64 Z" fill="#FBF7E8" />
          </svg>
        </section>

        <section data-role="home-section" style={{ maxWidth: 1360, margin: '0 auto', padding: '44px 32px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CalendarIcon />
              <h2 data-font="culture" style={{ fontSize: 23, fontWeight: 800, color: '#1B5E20', margin: 0 }}>กิจกรรมและเทศกาลที่กำลังจะมาถึง</h2>
            </div>
            <a href="#" onClick={(e) => { e.preventDefault(); actions.goEvents() }} style={{ fontSize: 13.5, fontWeight: 700, color: '#2E7D32' }}>ดูทั้งหมด →</a>
          </div>
          {state.dataLoading && <LoadingSpinner size={32} label="กำลังโหลดกิจกรรม..." />}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 22 }}>
            {!state.dataLoading && derived.homeEvents.map((event) => (
              <div key={event.id} onClick={event.onOpen} style={{ display: 'flex', gap: 16, background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.22s ease,box-shadow 0.22s ease', animation: 'dc-fade-up 0.45s ease both' }}>
                <ImageSlot src={event.img} shape="rect" style={{ width: 130, alignSelf: 'stretch', flexShrink: 0 }} placeholder="ภาพงาน" icon={EVENT_ICON} />
                <div style={{ padding: '14px 14px 14px 0', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#9b5527', marginBottom: 12 }}>{event.category}</span>
                  <div style={{ fontWeight: 400, fontSize: 15, color: '#1f2a24', marginBottom: 6, lineHeight: 1.35 }}>{event.name}</div>
                  <div style={{ fontWeight: 300, fontSize: 12.5, color: '#5f6a63' }}>{event.dateRange} · {event.venueName}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section data-role="home-section" style={{ maxWidth: 1360, margin: '0 auto', padding: '44px 32px 56px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <PinIcon />
              <h2 data-font="culture" style={{ fontSize: 23, fontWeight: 800, color: '#1B5E20', margin: 0 }}>สถานที่แนะนำ</h2>
              {state.userLocation
                ? <span style={{ fontSize: 12.5, fontWeight: 700, color: '#2E7D32', background: '#E8F5E9', padding: '4px 11px', borderRadius: 20 }}>เรียงตามที่ใกล้คุณ</span>
                : (
                  <button
                    type="button" onClick={actions.enableNearbyPlaces}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #C8E6C9', background: '#F1F8E9', color: '#2E7D32', borderRadius: 20, padding: '4px 12px 4px 8px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    <span style={{ transform: 'scale(0.6)', display: 'flex' }}><PinIcon box={false} /></span>
                    ดูที่ใกล้ฉัน
                  </button>
                )}
            </div>
            <a href="#" onClick={(e) => { e.preventDefault(); actions.goPlaces() }} style={{ fontSize: 13.5, fontWeight: 700, color: '#2E7D32' }}>ดูสถานที่ทั้งหมด →</a>
          </div>
          {placesLoading && <LoadingSpinner size={32} label="กำลังโหลดสถานที่แนะนำ..." />}
          <div data-role="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 24 }}>
            {!placesLoading && homePlaces.map((place) => (
              <div key={place.id} onClick={place.onOpen} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.22s ease,box-shadow 0.22s ease', animation: 'dc-fade-up 0.45s ease both' }}>
                <ImageSlot src={place.img} shape="rect" style={{ width: '100%', height: 160 }} placeholder="ภาพสถานที่" icon={placeCategoryIcon(place.category)} />
                <div style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#2E7D32', background: '#E8F5E9', padding: '3px 9px', borderRadius: 10 }}>{place.category}</span>
                    {place.hasQR && <span style={{ fontSize: 11, fontWeight: 700, color: '#7A5205', background: '#FFF8E1', padding: '3px 9px', borderRadius: 10 }}>+{place.qrPoints} พอยท์</span>}
                  </div>
                  <div style={{ fontWeight: 400, fontSize: 16, color: '#1f2a24', marginBottom: 4 }}>{place.name}</div>
                  <div style={{ fontWeight: 300, fontSize: 13, color: '#5f6a63', marginBottom: 8 }}>★ {place.rating} ({place.reviews}) · {place.price}{place.distanceKm != null && ` · ${place.distanceKm} กม.`}</div>
                  <div style={{ fontWeight: 300, fontSize: 12.5, color: '#626863', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{place.address}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  )
}
