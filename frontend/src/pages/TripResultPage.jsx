import { Navigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import { CalendarIcon, WalletIcon, RouteIcon, GiftIcon, PencilIcon, PinIcon } from '../components/Icons.jsx'

const sparkles = [
  { left: '6%', top: '20%', size: 7, duration: '3.2s', delay: '0s' },
  { left: '20%', top: '70%', size: 5, duration: '2.6s', delay: '0.4s' },
  { left: '70%', top: '18%', size: 6, duration: '3.6s', delay: '0.8s' },
  { left: '85%', top: '60%', size: 8, duration: '3s', delay: '0.2s' },
  { left: '45%', top: '10%', size: 5, duration: '2.8s', delay: '1s' },
]

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
  if (!state.tripPlan) return <Navigate to="/trip" replace />
  const plan = derived.tripPlan
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px 70px' }}>
      <div data-role="trip-result-grid" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 28, alignItems: 'start' }}>

        <div data-role="trip-result-summary" style={{ position: 'sticky', top: 88, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 26, background: 'linear-gradient(135deg,#66BB6A,#2E7D32 65%,#1B5E20)', padding: '30px 24px', boxShadow: '0 20px 48px rgba(27,94,32,0.28)', animation: 'dc-fade-up 0.45s ease both' }}>
            <div style={{ position: 'absolute', width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.10)', top: -80, right: -60, filter: 'blur(2px)' }}></div>
            <div style={{ position: 'absolute', width: 120, height: 120, borderRadius: '50%', background: 'rgba(251,192,45,0.18)', bottom: -50, left: -40, filter: 'blur(2px)' }}></div>
            {sparkles.map((s, i) => (
              <span key={i} style={{ position: 'absolute', left: s.left, top: s.top, width: s.size, height: s.size, borderRadius: '50%', background: '#FBC02D', animation: `dc-particle-float ${s.duration} ease-in-out infinite`, animationDelay: s.delay, pointerEvents: 'none' }}></span>
            ))}
            <div style={{ position: 'relative' }}>
              <img src="./assets/dino-mascot-front.png" alt="" style={{ width: 64, height: 'auto', animation: 'dc-float 3.4s ease-in-out infinite', filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.2))', marginBottom: 10 }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(251,192,45,0.22)', border: '1px solid rgba(251,192,45,0.5)', color: '#FFF3C4', fontSize: 11, fontWeight: 800, padding: '4px 11px', borderRadius: 20, marginBottom: 10 }}>✦ AI จัดให้แบบเอ็กซ์คลูซีฟ</div>
              <h1 data-font="culture" style={{ color: '#fff', fontSize: 22, fontWeight: 900, margin: '0 0 6px' }}>ทริปของคุณพร้อมแล้ว!</h1>
              <p style={{ color: '#E8F5E9', fontSize: 13, margin: '0 0 20px' }}>น้องไดโนจัดเส้นทางตามความสนใจของคุณเรียบร้อย พร้อมออกเดินทางได้เลย</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <StatCard icon={<CalendarIcon size={15} color="#fff" box={false} />} value={plan.days.length} label="วันเดินทาง" />
                <StatCard icon={<WalletIcon size={15} color="#fff" box={false} />} value={`฿${plan.totalBudget}`} label="งบประมาณ" />
                <StatCard icon={<RouteIcon size={15} color="#fff" box={false} />} value={`${plan.totalDistance} กม.`} label="ระยะทางรวม" />
                <StatCard icon={<GiftIcon size={15} color="#FBC02D" box={false} />} value={`+${plan.totalPoints}`} label="พอยท์ที่จะได้" accent="#FBC02D" />
              </div>
            </div>
          </div>

          {state.tripPlanRationale && (
            <div style={{ background: '#FFF8E1', border: '1px solid #FBC02D', borderRadius: 16, padding: '14px 16px' }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: '#8a6d00', marginBottom: 4 }}>✦ ทำไมน้องไดโนจัดแบบนี้</div>
              <div style={{ fontSize: 13, color: '#6d5f2a', lineHeight: 1.5 }}>{state.tripPlanRationale}</div>
            </div>
          )}

          <div style={{ background: 'linear-gradient(135deg,#F1F8E9,#E8F5E9)', border: '1px solid #C8E6C9', borderRadius: 20, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <PencilIcon size={17} />
              <span style={{ fontWeight: 800, fontSize: 14, color: '#1B5E20' }}>อยากปรับตรงไหนของแผนไหมครับ</span>
            </div>
            <textarea value={state.feedbackText} onChange={actions.onFeedbackChange} placeholder="เช่น ตารางแน่นเกินไป อยากได้เวลาพักมากกว่านี้..." style={{ width: '100%', minHeight: 70, border: '1px solid #DCD8C6', borderRadius: 12, padding: 11, fontSize: 13.5, resize: 'vertical', marginBottom: 12, background: '#fff' }}></textarea>
            <button onClick={actions.regeneratePlan} style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#2E7D32)', color: '#fff', border: 'none', padding: 13, borderRadius: 20, fontWeight: 800, fontSize: 13.5, cursor: 'pointer', boxShadow: '0 10px 22px rgba(46,125,50,0.25)' }}>ปรับแผนการเดินทางอีกครั้ง</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: '#6d7a72' }}><PinIcon box={false} color="#6d7a72" />เปิดใน Google Maps</a>
            <a href="#" onClick={(e) => { e.preventDefault(); actions.goTripForm() }} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: '#6d7a72' }}><RouteIcon size={15} color="#6d7a72" box={false} />สร้างแผนใหม่</a>
          </div>
        </div>

        <div>
          {plan.days.map((day) => (
            <div key={day.dayNum} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 22, padding: 26, marginBottom: 20, boxShadow: '0 10px 26px rgba(46,125,50,0.07)', animation: 'dc-fade-up 0.4s ease both' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg,#66BB6A,#2E7D32)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0, boxShadow: '0 8px 16px rgba(46,125,50,0.3)' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>DAY</span>
                  <span style={{ fontSize: 17, fontWeight: 800 }}>{day.dayNum}</span>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#1B5E20' }}>วันที่ {day.dayNum}</div>
                  <div style={{ fontSize: 12.5, color: '#8a938c' }}>{day.date}</div>
                </div>
              </div>
              <div style={{ position: 'relative', paddingLeft: 22 }}>
                <div style={{ position: 'absolute', left: 21, top: 8, bottom: 30, width: 2, background: 'linear-gradient(180deg,#66BB6A,#C8E6C9)', transformOrigin: 'top', animation: 'dc-grow 0.6s ease both' }}></div>
                {day.items.map((item) => (
                  <div key={item.placeId + item.time} style={{ position: 'relative', marginBottom: 14, animation: 'dc-slide-in 0.45s ease both' }}>
                    {item.distanceFromPrev != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8a938c', marginLeft: 26, marginBottom: 8 }}>
                        <RouteIcon size={12} color="#8a938c" box={false} />เดินทางต่อ {item.distanceFromPrev} กม.
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', border: '1px solid #EFEBDB', borderRadius: 16, padding: 12, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}>
                      <div style={{ position: 'absolute', left: -6, top: '50%', marginTop: -7, width: 14, height: 14, borderRadius: '50%', background: '#fff', border: '3px solid #2E7D32' }}></div>
                      <div style={{ width: 54, flexShrink: 0, textAlign: 'center' }}>
                        <div style={{ fontWeight: 800, fontSize: 14, color: '#2E7D32' }}>{item.time}</div>
                      </div>
                      <ImageSlot src={item.place.img} shape="rounded" radius={12} style={{ width: 84, height: 84, flexShrink: 0 }} placeholder="ภาพ" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#2E7D32', background: '#E8F5E9', padding: '2px 9px', borderRadius: 10 }}>{item.place.category}</span>
                        <div style={{ fontWeight: 700, fontSize: 15.5, color: '#1f2a24', margin: '5px 0 3px' }}>{item.place.name}</div>
                        <div style={{ fontSize: 12.5, color: '#6d7a72', marginBottom: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>★ {item.place.rating} · {item.place.address}</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={item.onLike} style={{ display: 'flex', alignItems: 'center', gap: 5, border: `1px solid ${item.likeBorder}`, background: item.likeBg, color: item.likeColor, borderRadius: 12, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            <span style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: `7px solid ${item.likeColor}` }}></span>ถูกใจ
                          </button>
                          <button onClick={item.onDislike} style={{ display: 'flex', alignItems: 'center', gap: 5, border: `1px solid ${item.dislikeBorder}`, background: item.dislikeBg, color: item.dislikeColor, borderRadius: 12, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            <span style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `7px solid ${item.dislikeColor}` }}></span>ไม่ถูกใจ
                          </button>
                          <button onClick={item.onSwap} style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid #DCD8C6', background: '#fff', color: '#6d7a72', borderRadius: 12, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            <RouteIcon size={12} color="#6d7a72" box={false} />สลับที่นี่
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

      </div>
    </main>
  )
}
