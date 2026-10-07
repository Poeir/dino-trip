import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { GiftIcon, PinIcon } from '../components/Icons.jsx'
import QrScannerModal from '../components/QrScannerModal.jsx'
import ScanResultModal from '../components/ScanResultModal.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import PlaceCard from '../components/PlaceCard.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import { fetchScannablePlaces } from '../lib/apiClient.js'
import { REWARD_ICON, MASCOT } from '../data/categoryImages.js'

const STAMP_SLOTS = 6
const INTRO_STEPS = [
  { title: 'สมัครสมาชิกฟรี', desc: 'ใช้แค่อีเมล ไม่มีค่าใช้จ่าย' },
  { title: 'สแกน QR ที่สถานที่', desc: 'เล็งกล้องไปที่ป้าย QR แล้วรับพอยท์ทันที' },
  { title: 'แลกของรางวัลที่เคาน์เตอร์', desc: 'แจ้งชื่อหรือเบอร์โทรที่ใช้สมัครกับเจ้าหน้าที่ แล้วรับของรางวัลได้เลย' },
]

const POINTS_STEPS = [
  { title: 'สแกน QR ที่สถานที่', desc: 'ไปที่สถานที่ในรายการด้านล่าง แล้วสแกนป้าย QR' },
  { title: 'สะสมพอยท์', desc: 'ต้องเข้าสู่ระบบ เปิดตำแหน่ง และอยู่ในรัศมีที่กำหนด แต่ละจุดรับได้ครั้งเดียวต่อบัญชี และบางจุดมีวันหมดอายุ' },
  { title: 'แลกของรางวัล', desc: 'แจ้งชื่อหรือเบอร์โทรที่สมัครไว้กับเจ้าหน้าที่ที่เคาน์เตอร์' },
]

function PointsIntro({ places, placesLoading, rewards, onSignup, onLogin }) {
  const stamps = places.slice(0, STAMP_SLOTS)
  const previewRewards = rewards.slice(0, 4)
  const primaryBtn = { background: 'linear-gradient(135deg,#f9a825,#FBC02D)', color: '#1B5E20', border: 'none', padding: '13px 26px', borderRadius: 22, fontWeight: 800, fontSize: 15, cursor: 'pointer' }
  const ghostBtn = { background: 'transparent', color: '#1B5E20', border: '2px solid #2E7D32', padding: '11px 24px', borderRadius: 22, fontWeight: 700, fontSize: 15, cursor: 'pointer' }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 'var(--page-pt) var(--page-gutter) var(--page-pb)' }}>
      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 40, alignItems: 'center', marginBottom: 56 }}>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}>
          <h1 data-font="culture" style={{ fontSize: 34, lineHeight: 1.25, fontWeight: 900, color: '#1B5E20', margin: '0 0 14px' }}>
            เที่ยวไป สแกนไป<br />พอยท์กลายเป็นของรางวัล
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: '#4a564e', margin: '0 0 24px', maxWidth: 440 }}>
            ป้าย QR ติดอยู่ตามสถานที่ท่องเที่ยวที่ร่วมรายการ สแกนแล้วได้พอยท์เข้าบัญชีทันที สะสมให้พอแล้วนำไปแลกของรางวัลได้ที่เคาน์เตอร์
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
            <button onClick={onSignup} style={primaryBtn}>สมัครสมาชิกฟรี</button>
            <button onClick={onLogin} style={ghostBtn}>เข้าสู่ระบบ</button>
          </div>
          <div style={{ fontSize: 13, color: '#5f6a63' }}>QR แต่ละจุดรับพอยท์ได้ครั้งเดียวต่อบัญชี</div>
        </div>

        <div style={{ flex: '1 1 320px', minWidth: 0, position: 'relative', paddingTop: 72 }}>
          <img src={MASCOT.treasure} alt="" style={{ position: 'absolute', top: 0, right: 12, width: 88, height: 88, objectFit: 'contain', zIndex: 1, animation: 'dc-float 3.6s ease-in-out infinite', pointerEvents: 'none' }} />
          <div style={{ background: '#FFFCF0', border: '2px dashed #E0B94A', borderRadius: 18, padding: '20px 20px 22px', boxShadow: '0 10px 28px rgba(122,82,5,0.10)', minHeight: 310 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
              <span data-font="culture" style={{ fontSize: 18, fontWeight: 800, color: '#7A5205' }}>บัตรสะสมพอยท์</span>
              <span style={{ fontSize: 12.5, color: '#626863' }}>{placesLoading ? '' : `${places.length} สถานที่ร่วมรายการ`}</span>
            </div>
            {placesLoading ? (
              <LoadingSpinner size={28} label="กำลังโหลดสถานที่..." />
            ) : stamps.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#626863', fontSize: 13.5, padding: '24px 0' }}>เร็วๆ นี้จะมีสถานที่ให้สะสมพอยท์</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px 10px' }}>
                {stamps.map((p, i) => (
                  <div key={p.id} style={{ textAlign: 'center', minWidth: 0 }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: '50%', margin: '0 auto 7px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800, fontSize: 15,
                      ...(i === 0
                        ? { background: '#FBC02D', color: '#1B5E20', border: '3px double #7A5205', transform: 'rotate(-8deg)', animation: 'dc-pop 0.5s ease both' }
                        : { background: 'transparent', color: '#B08A2E', border: '2px dashed #D8C58A' }),
                    }}>
                      +{p.qrPoints}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#3c463f', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 56 }}>
        <h2 data-font="culture" style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: '0 0 20px' }}>เริ่มสะสมใน 3 ขั้นตอน</h2>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          {INTRO_STEPS.map((s, i) => (
            <li key={s.title} style={{ flex: '1 1 240px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', background: '#2E7D32', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15.5, color: '#1f2a24', marginBottom: 3 }}>{s.title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.55, color: '#5f6a63' }}>{s.desc}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {previewRewards.length > 0 && (
        <section style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <GiftIcon />
            <h2 data-font="culture" style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>ของรางวัลที่แลกได้</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 14 }}>
            {previewRewards.map((r) => (
              <div key={r.id} style={{ border: '1px solid #E7E3D2', borderRadius: 14, padding: '14px 16px', background: '#fff' }}>
                {r.imageUrl && <ImageSlot src={r.imageUrl} radius={10} placeholder={r.name} icon={REWARD_ICON} style={{ width: '100%', height: 110, marginBottom: 10 }} />}
                <div style={{ fontWeight: 700, fontSize: 14.5, color: '#1f2a24', marginBottom: 6 }}>{r.name}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#7A5205' }}>{r.cost} พอยท์{r.stock === 0 && <span style={{ color: '#a33232', marginLeft: 8 }}>ของหมด</span>}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ background: 'linear-gradient(135deg,#388E3C,#2E7D32)', borderRadius: 18, padding: '28px 28px', display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ color: '#fff', minWidth: 0 }}>
          <div data-font="culture" style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>พร้อมสะสมพอยท์แล้วหรือยัง</div>
          <div style={{ fontSize: 14, color: '#C8E6C9' }}>สมัครฟรี แล้วสแกน QR ใบแรกได้เลย</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <button onClick={onSignup} style={primaryBtn}>สมัครสมาชิกฟรี</button>
          <button onClick={onLogin} style={{ background: 'transparent', color: '#fff', border: '2px solid rgba(255,255,255,0.6)', padding: '11px 24px', borderRadius: 22, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>มีบัญชีแล้ว เข้าสู่ระบบ</button>
        </div>
      </section>
    </main>
  )
}

export default function PointsPage() {
  const { state, actions, derived } = useApp()
  const [qrPlaces, setQrPlaces] = useState([])
  const [qrPlacesLoading, setQrPlacesLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchScannablePlaces()
      .then((data) => { if (!cancelled) setQrPlaces(data) })
      .catch(() => { if (!cancelled) setQrPlaces([]) })
      .finally(() => { if (!cancelled) setQrPlacesLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (!state.authChecked) return <LoadingSpinner size={32} label="กำลังโหลด..." />

  if (!state.loggedIn) {
    return (
      <PointsIntro
        places={qrPlaces}
        placesLoading={qrPlacesLoading}
        rewards={state.rewards}
        onSignup={actions.goSignup}
        onLogin={actions.goLogin}
      />
    )
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 'var(--page-pt) var(--page-gutter) var(--page-pb)' }}>
      <h1 data-font="culture" style={{ fontSize: 24, fontWeight: 800, color: '#1B5E20', margin: '0 0 20px' }}>พอยท์สะสมของคุณ</h1>

      <div style={{ background: 'linear-gradient(135deg,#388E3C,#2E7D32)', borderRadius: 16, padding: 24, color: '#fff', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: '#C8E6C9' }}>พอยท์ที่คุณมีตอนนี้</div>
            <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.2 }}>{state.userPoints} <span style={{ fontSize: 16, fontWeight: 700 }}>พอยท์</span></div>
          </div>
          <button onClick={actions.startScan} style={{ background: 'linear-gradient(135deg,#f9a825,#FBC02D)', color: '#1B5E20', border: 'none', padding: '12px 24px', borderRadius: 22, fontWeight: 800, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 18, height: 13, border: '2px solid #1B5E20', borderRadius: 3, position: 'relative', display: 'inline-block', flexShrink: 0 }}><span style={{ position: 'absolute', top: 2, left: 5, width: 7, height: 7, borderRadius: '50%', border: '2px solid #1B5E20' }}></span></span>สแกน QR รับพอยท์
          </button>
        </div>
      </div>

      <ol style={{ listStyle: 'none', margin: '0 0 28px', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {POINTS_STEPS.map((st, i) => (
          <li key={st.title} style={{ flex: '1 1 200px', display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FFFCF0', border: '1px solid #EFE3B8', borderRadius: 12, padding: '12px 14px' }}>
            <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: '#2E7D32', color: '#fff', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#1f2a24' }}>{st.title}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#5f6a63' }}>{st.desc}</div>
            </div>
          </li>
        ))}
      </ol>

      <QrScannerModal open={derived.isScanning} onDetected={actions.handleQrDetected} onError={actions.handleScanCancelled} />

      <ScanResultModal
        processing={derived.isScanProcessing}
        success={derived.isScanSuccess}
        error={derived.isScanError}
        place={state.scanResultPlace}
        points={state.scanResultPoints}
        message={state.scanError}
        onClose={actions.resetScan}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <PinIcon />
        <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1B5E20', margin: 0 }}>สถานที่ที่มี QR รับพอยท์</h2>
      </div>
      <p style={{ fontSize: 13.5, color: '#5f6a63', margin: '0 0 14px' }}>ไปที่สถานที่เหล่านี้แล้วสแกน QR เพื่อรับพอยท์</p>
      {qrPlacesLoading && <LoadingSpinner size={32} label="กำลังโหลดสถานที่..." />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 16, marginBottom: 28 }}>
        {!qrPlacesLoading && qrPlaces.map((p) => (
          <PlaceCard key={p.id} place={p} badge={`+${p.qrPoints} พอยท์`} onClick={() => actions.openPlace(p.id)} />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <GiftIcon />
        <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1B5E20', margin: 0 }}>ของรางวัล</h2>
      </div>
      <p style={{ fontSize: 13.5, color: '#5f6a63', margin: '0 0 14px' }}>แลกของรางวัลได้ที่เคาน์เตอร์ แจ้งชื่อหรือเบอร์โทรที่ใช้สมัครกับเจ้าหน้าที่ แล้วเจ้าหน้าที่จะหักพอยท์และมอบของให้</p>
      {state.dataLoading && <LoadingSpinner size={32} label="กำลังโหลดของรางวัล..." />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 16, marginBottom: 28 }}>
        {!state.dataLoading && derived.rewardsView.map((r) => (
          <PlaceCard
            key={r.id}
            place={{ img: r.imageUrl, name: r.name, category: r.stock != null && r.stock > 0 ? `เหลือ ${r.stock} ชิ้น` : 'ของรางวัล' }}
            badge={`${r.cost} พอยท์`}
            dim={r.status === 'soldOut'}
          >
            <div style={{
              textAlign: 'center', padding: '7px 10px', borderRadius: 16, fontSize: 12.5, fontWeight: 700,
              background: r.status === 'ready' ? '#E8F5E9' : r.status === 'soldOut' ? '#fdecec' : '#F3F1E7',
              color: r.status === 'ready' ? '#2E7D32' : r.status === 'soldOut' ? '#a33232' : '#5f6a63',
            }}>
              {r.status === 'ready' ? 'แลกได้ที่เคาน์เตอร์' : r.status === 'soldOut' ? 'ของหมด' : `อีก ${r.shortBy} พอยท์`}
            </div>
            {r.status === 'needMore' && (
              <div style={{ height: 6, borderRadius: 3, background: '#F3F1E7', marginTop: 8, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Math.round((state.userPoints / r.cost) * 100))}%`, height: '100%', background: '#FBC02D' }}></div>
              </div>
            )}
          </PlaceCard>
        ))}
      </div>
    </main>
  )
}
