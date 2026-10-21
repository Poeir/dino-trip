import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { MASCOT } from '../data/categoryImages.js'
import TripDayCard from '../components/TripDayCard.jsx'
import Modal from '../components/Modal.jsx'
import PlaceDetailView from '../components/PlaceDetailView.jsx'
import { CalendarIcon, RouteIcon, GiftIcon } from '../components/Icons.jsx'
import { fetchPlace, fetchPlaces } from '../lib/apiClient.js'
import { tripNotices } from '../utils/tripNotices.js'

const sparkles = [
  { left: '6%', top: '20%', size: 7, duration: '3.2s', delay: '0s' },
  { left: '20%', top: '70%', size: 5, duration: '2.6s', delay: '0.4s' },
  { left: '70%', top: '18%', size: 6, duration: '3.6s', delay: '0.8s' },
  { left: '85%', top: '60%', size: 8, duration: '3s', delay: '0.2s' },
  { left: '45%', top: '10%', size: 5, duration: '2.8s', delay: '1s' },
]

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: '#626863', flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#3c463f', fontWeight: 700, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function StatCard({ icon, value, label, accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 14, padding: '10px 12px' }}>
      <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: accent || '#fff', fontSize: 16, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
        <div style={{ color: '#E8F5E9', fontSize: 10.5, marginTop: 2 }}>{label}</div>
      </div>
    </div>
  )
}

export default function TripResultPage() {
  const { state, actions, derived } = useApp()
  const [selectedPlaceId, setSelectedPlaceId] = useState(null)
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  // /trip/:id opens a saved plan (refresh-safe, shareable within the same
  // browser/account); /trip/result is the unsaved fallback.
  const { id } = useParams()

  useEffect(() => {
    if (id && state.tripId !== id) actions.loadTrip(id)
    // Only re-run when the URL id or the loaded plan changes -- `actions` is a
    // fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, state.tripId])

  useEffect(() => {
    if (!selectedPlaceId) { setSelectedPlace(null); return }
    let cancelled = false
    fetchPlace(selectedPlaceId).then((p) => { if (!cancelled) setSelectedPlace(p) }).catch(() => { if (!cancelled) setSelectedPlace(null) })
    return () => { cancelled = true }
  }, [selectedPlaceId])

  // The plan's places carry no Google place id, but the "open in Google Maps"
  // links need it to land on the real Maps listing -- one batched lookup per plan.
  const [googleIds, setGoogleIds] = useState({})
  const planPlaceIds = [...new Set((state.tripPlan?.days || []).flatMap((d) => d.items.map((i) => i.place?.id)).filter((v) => v && !/^(hotel_dummy|trip_end|free_time_dummy|removed_)/.test(v)))]
  const planPlaceIdsKey = planPlaceIds.join(',')
  useEffect(() => {
    if (!planPlaceIdsKey) return undefined
    let cancelled = false
    fetchPlaces({ ids: planPlaceIdsKey })
      .then((r) => {
        if (cancelled) return
        const rows = Array.isArray(r) ? r : r.data || []
        setGoogleIds(Object.fromEntries(rows.filter((p) => p.googlePlaceId).map((p) => [p.id, p.googlePlaceId])))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [planPlaceIdsKey])

  if (id && state.tripId !== id) {
    if (state.tripLoadError) {
      return (
        <main style={{ maxWidth: 520, margin: '0 auto', padding: 'var(--page-pv-center) var(--page-gutter)', textAlign: 'center' }}>
          <p style={{ fontSize: 15, color: '#3c463f', marginBottom: 18 }}>{state.tripLoadError}</p>
          <Link to="/trip" style={{ fontWeight: 800, color: '#2E7D32' }}>สร้างแผนใหม่</Link>
        </main>
      )
    }
    return <LoadingSpinner size={36} label="กำลังโหลดแผนทริป..." />
  }
  if (!state.tripPlan) return <Navigate to="/trip" replace />
  const plan = derived.tripPlan
  const notices = tripNotices(state.tripPlanNote)
  const selectedPlaceView = selectedPlace
    ? { ...selectedPlace, isFavorite: state.favoriteIds.includes(selectedPlace.id), onToggleFavorite: () => actions.toggleFavorite(selectedPlace.id) }
    : null
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: 'var(--page-pt) var(--page-gutter) var(--page-pb)' }}>
      <div data-role="trip-result-grid" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 28, alignItems: 'start' }}>

        <div data-role="trip-result-summary" style={{ position: 'sticky', top: 88, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {!id && state.authChecked && !state.loggedIn && (
            <div style={{ background: '#FFF8E1', border: '1px solid #FBC02D', borderRadius: 14, padding: '11px 14px', fontSize: 12.5, color: '#6d5f2a', lineHeight: 1.5 }}>
              แผนนี้จะหายเมื่อปิดหน้านี้ <Link to="/login" style={{ fontWeight: 800, color: '#8a6d00' }}>เข้าสู่ระบบ</Link> ก่อนสร้างแผน เพื่อบันทึกไว้ในเมนู “ทริปของฉัน”
            </div>
          )}
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 26, background: 'linear-gradient(135deg,#66BB6A,#2E7D32 65%,#1B5E20)', padding: '30px 24px', boxShadow: '0 20px 48px rgba(27,94,32,0.28)', animation: 'dc-fade-up 0.45s ease both' }}>
            <div style={{ position: 'absolute', width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.10)', top: -80, right: -60, filter: 'blur(2px)' }}></div>
            <div style={{ position: 'absolute', width: 120, height: 120, borderRadius: '50%', background: 'rgba(251,192,45,0.18)', bottom: -50, left: -40, filter: 'blur(2px)' }}></div>
            {sparkles.map((s, i) => (
              <span key={i} style={{ position: 'absolute', left: s.left, top: s.top, width: s.size, height: s.size, borderRadius: '50%', background: '#FBC02D', animation: `dc-particle-float ${s.duration} ease-in-out infinite`, animationDelay: s.delay, pointerEvents: 'none' }}></span>
            ))}
            <div style={{ position: 'relative' }}>
              <img src={MASCOT.celebrate} alt="" width={96} height={96} style={{ width: 96, height: 'auto', animation: 'dc-float 3.4s ease-in-out infinite', filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.2))', marginBottom: 10 }} />
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(251,192,45,0.22)', border: '1px solid rgba(251,192,45,0.5)', color: '#FFF3C4', fontSize: 11, fontWeight: 800, padding: '4px 11px', borderRadius: 20, marginBottom: 10 }}>✦ AI จัดให้แบบเอ็กซ์คลูซีฟ</div>
              <h1 data-font="culture" style={{ color: '#fff', fontSize: 22, fontWeight: 900, margin: '0 0 6px' }}>ทริปของคุณพร้อมแล้ว!</h1>
              <p style={{ color: '#E8F5E9', fontSize: 13, margin: '0 0 20px' }}>น้องไดโนจัดเส้นทางตามความสนใจของคุณเรียบร้อย พร้อมออกเดินทางได้เลย</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                <StatCard icon={<CalendarIcon size={15} color="#fff" box={false} />} value={plan.days.length} label="วันเดินทาง" />
                <StatCard icon={<RouteIcon size={15} color="#fff" box={false} />} value={`${plan.totalDistance} กม.`} label="ระยะทางรวม" />
                <StatCard icon={<GiftIcon size={15} color="#FBC02D" box={false} />} value={`+${plan.totalPoints}`} label="พอยท์ที่จะได้" accent="#FBC02D" />
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, animation: 'dc-fade-up 0.45s ease 0.05s both' }}>
            <div onClick={() => setSummaryOpen((v) => !v)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px', cursor: 'pointer' }}>
              <span style={{ fontWeight: 800, fontSize: 13, color: '#1B5E20' }}>เงื่อนไขที่เลือกไว้</span>
              <span style={{ fontSize: 11, color: '#626863', fontWeight: 700 }}>{summaryOpen ? 'ซ่อน ▾' : 'ดู ▸'}</span>
            </div>
            {summaryOpen && (
              <div style={{ padding: '0 16px 16px', display: 'grid', gap: 8, fontSize: 12.5 }}>
                <SummaryRow label="วันที่" value={derived.tripFormSummaryView.dateRangeLabel} />
                <SummaryRow label="ช่วงเวลาต่อวัน" value={`${derived.tripFormSummaryView.dailyStart} - ${derived.tripFormSummaryView.dailyEnd}`} />
                <SummaryRow label={derived.tripFormSummaryView.accommodationTitle} value={derived.tripFormSummaryView.accommodationLabel || 'ไม่ได้ระบุ (ใช้ใจกลางเมือง)'} />
                {derived.tripFormSummaryView.tripEndLabel && (
                  <SummaryRow label="วันสุดท้ายจบที่" value={derived.tripFormSummaryView.tripEndLabel} />
                )}
                <SummaryRow label="ความสนใจ" value={derived.tripFormSummaryView.interests.length ? derived.tripFormSummaryView.interests.join(', ') : 'ไม่ได้เลือก'} />
                <SummaryRow label="อยากกิน" value={derived.tripFormSummaryView.foodPrefs.length ? derived.tripFormSummaryView.foodPrefs.join(', ') : 'ไม่ได้เลือก'} />
                <SummaryRow label="งบประมาณ" value={derived.tripFormSummaryView.budget} />
                <SummaryRow label="จังหวะการเที่ยว" value={derived.tripFormSummaryView.paceLabel} />
                <SummaryRow label="ขอบเขตพื้นที่" value={derived.tripFormSummaryView.areaScope} />
                {derived.tripFormSummaryView.mustGo.length > 0 && (
                  <SummaryRow label="ต้องไปแน่ๆ" value={derived.tripFormSummaryView.mustGo.join(', ')} />
                )}
              </div>
            )}
          </div>

          {/* A must-go place that is missing from the plan, or a public holiday
              on the trip dates: without this the place just wasn't there. */}
          {notices.length > 0 && (
            <div role="status" style={{ background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: 16, padding: '14px 16px' }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: '#A65B00', marginBottom: 6 }}>ข้อควรทราบเกี่ยวกับแผนนี้</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13, color: '#6b4a1e', lineHeight: 1.5 }}>
                {notices.map((text) => <li key={text}>{text}</li>)}
              </ul>
            </div>
          )}

          {state.tripPlanRationale && (
            <div style={{ background: '#FFF8E1', border: '1px solid #FBC02D', borderRadius: 16, padding: '14px 16px' }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: '#8a6d00', marginBottom: 4 }}>✦ ทำไมน้องไดโนจัดแบบนี้</div>
              <div style={{ fontSize: 13, color: '#6d5f2a', lineHeight: 1.5 }}>{state.tripPlanRationale}</div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); actions.goTripForm() }} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: '#5f6a63' }}><RouteIcon size={15} color="#5f6a63" box={false} />สร้างแผนใหม่</a>
          </div>
        </div>

        <div>
          {plan.days.map((day) => (
            <TripDayCard key={day.dayNum} day={day} googleIds={googleIds} onSelectPlace={setSelectedPlaceId} />
          ))}
        </div>

        <div style={{ marginTop: 28, padding: '18px 20px', borderRadius: 16, background: '#E8F5E9', border: '1px solid #C8E6C9', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#1B5E20' }}>แผนเที่ยวนี้เป็นอย่างไรบ้าง?</div>
            <div style={{ fontSize: 13, color: '#3d4a41', marginTop: 3 }}>ช่วยทำแบบประเมินความพึงพอใจสั้น ๆ ใช้เวลาประมาณ 3 นาที เพื่อนำไปพัฒนาระบบ</div>
          </div>
          <Link to="/survey" style={{ background: '#2E7D32', color: '#fff', fontWeight: 700, fontSize: 14, padding: '10px 20px', borderRadius: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}>ทำแบบประเมิน</Link>
        </div>

      </div>

      <Modal open={!!selectedPlaceView} onClose={() => setSelectedPlaceId(null)} title={selectedPlaceView ? selectedPlaceView.name : ''} maxWidth={1100}>
        {selectedPlaceView && <PlaceDetailView place={selectedPlaceView} imageHeight={320} />}
      </Modal>
    </main>
  )
}
