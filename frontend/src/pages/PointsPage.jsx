import { useApp } from '../context/AppContext.jsx'
import { GiftIcon, PinIcon } from '../components/Icons.jsx'

export default function PointsPage() {
  const { state, actions, derived } = useApp()
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '36px 32px 60px' }}>
      <h1 data-font="culture" style={{ fontSize: 24, fontWeight: 800, color: '#1B5E20', margin: '0 0 6px' }}>พอยท์สะสมของคุณ</h1>
      <p style={{ color: '#6d7a72', fontSize: 14, margin: '0 0 24px' }}>สแกน QR Code ที่ติดอยู่ ณ สถานที่ท่องเที่ยวเพื่อสะสมพอยท์ แลกเป็นของรางวัลได้ทันที</p>

      <div style={{ background: 'linear-gradient(135deg,#388E3C,#2E7D32)', borderRadius: 16, padding: 24, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 13, color: '#C8E6C9' }}>พอยท์คงเหลือ</div>
          <div style={{ fontSize: 32, fontWeight: 800 }}>{state.userPoints}</div>
        </div>
        <button onClick={actions.startScan} style={{ background: 'linear-gradient(135deg,#f9a825,#FBC02D)', color: '#1B5E20', border: 'none', padding: '11px 22px', borderRadius: 20, fontWeight: 800, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 18, height: 13, border: '2px solid #1B5E20', borderRadius: 3, position: 'relative', display: 'inline-block', flexShrink: 0 }}><span style={{ position: 'absolute', top: 2, left: 5, width: 7, height: 7, borderRadius: '50%', border: '2px solid #1B5E20' }}></span></span>สแกน QR
        </button>
      </div>

      {derived.isScanning && (
        <div style={{ textAlign: 'center', padding: 28, border: '1px dashed #C8E6C9', borderRadius: 14, marginBottom: 28 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', border: '4px solid #C8E6C9', borderTopColor: '#2E7D32', margin: '0 auto 14px', animation: 'dc-spin 0.8s linear infinite' }}></div>
          <div style={{ color: '#6d7a72', fontSize: 14 }}>กำลังทำการสแกน QR Code...</div>
        </div>
      )}
      {derived.isScanSuccess && (
        <div style={{ textAlign: 'center', padding: 24, background: '#E8F5E9', borderRadius: 14, marginBottom: 28, animation: 'dc-pop 0.4s ease both' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 800, fontSize: 16, color: '#1B5E20', marginBottom: 4 }}>
            <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#2E7D32', position: 'relative', flexShrink: 0 }}>
              <span style={{ position: 'absolute', left: 5, top: 9, width: 6, height: 2.5, background: '#fff', transform: 'rotate(45deg)' }}></span>
              <span style={{ position: 'absolute', left: 8, top: 6, width: 10, height: 2.5, background: '#fff', transform: 'rotate(-45deg)' }}></span>
            </span>
            สแกนสำเร็จที่ {state.scanResultPlace}!
          </div>
          <div style={{ color: '#2E7D32', fontSize: 14, marginBottom: 12 }}>คุณได้รับ +{state.scanResultPoints} พอยท์</div>
          <button onClick={actions.resetScan} style={{ background: '#fff', border: '1px solid #2E7D32', color: '#2E7D32', padding: '8px 18px', borderRadius: 16, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>ปิด</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <GiftIcon />
        <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1B5E20', margin: 0 }}>แลกของรางวัล</h2>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16, marginBottom: 28 }}>
        {derived.rewardsView.map((r) => (
          <div key={r.id} style={{ border: '1px solid #E7E3D2', borderRadius: 14, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: '#1f2a24', marginBottom: 10 }}>{r.name}</div>
            <div style={{ fontSize: 13, color: '#7A5205', fontWeight: 700, marginBottom: 12 }}>{r.cost} พอยท์</div>
            <button onClick={r.onRedeem} disabled={r.disabled} style={{ width: '100%', background: r.btnBg, color: r.btnColor, border: 'none', padding: 9, borderRadius: 16, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>แลกของรางวัล</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <PinIcon />
        <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1B5E20', margin: 0 }}>สถานที่ที่มี QR รับพอยท์</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {derived.qrPlacesList.map((p) => (
          <div key={p.id} onClick={p.onOpen} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #E7E3D2', borderRadius: 12, padding: '12px 16px', cursor: 'pointer' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1f2a24' }}>{p.name}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#7A5205' }}>+{p.qrPoints} พอยท์</span>
          </div>
        ))}
      </div>
    </main>
  )
}
