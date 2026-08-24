import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'

const PENDING_SCAN_KEY = 'dino-pending-scan-qr-id'

// Landing page for a QR's own URL (see QrTab.jsx's qrValue) -- reached when
// someone scans a place's physical QR with their phone's regular camera
// app instead of the in-app scanner on PointsPage. Not logged in yet? Park
// the qrId and send them to /login; AppContext's redirectAfterAuth() picks
// this back up and returns them here once they're signed in.
export default function ScanLandingPage() {
  const { qrId } = useParams()
  const { state, actions, derived } = useApp()
  const claimedRef = useRef(false)

  useEffect(() => {
    if (!state.authChecked || claimedRef.current) return
    claimedRef.current = true
    if (!state.loggedIn) {
      sessionStorage.setItem(PENDING_SCAN_KEY, qrId)
      actions.goLogin()
      return
    }
    actions.claimScan(qrId)
  }, [state.authChecked, state.loggedIn, qrId])

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '60px 32px' }}>
      {(!state.authChecked || derived.isScanProcessing || !state.loggedIn) && (
        <div style={{ textAlign: 'center', padding: 28, border: '1px dashed #C8E6C9', borderRadius: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', border: '4px solid #C8E6C9', borderTopColor: '#2E7D32', margin: '0 auto 14px', animation: 'dc-spin 0.8s linear infinite' }}></div>
          <div style={{ color: '#6d7a72', fontSize: 14 }}>กำลังตรวจสอบ QR Code...</div>
        </div>
      )}
      {derived.isScanSuccess && (
        <div style={{ textAlign: 'center', padding: 24, background: '#E8F5E9', borderRadius: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#1B5E20', marginBottom: 4 }}>สแกนสำเร็จที่ {state.scanResultPlace}!</div>
          <div style={{ color: '#2E7D32', fontSize: 14, marginBottom: 16 }}>คุณได้รับ +{state.scanResultPoints} พอยท์</div>
          <button onClick={actions.goPoints} style={{ background: '#2E7D32', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 16, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>ดูพอยท์ของฉัน</button>
        </div>
      )}
      {derived.isScanError && (
        <div style={{ textAlign: 'center', padding: 24, background: '#fdecec', borderRadius: 14 }}>
          <div style={{ color: '#a33232', fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{state.scanError || 'สแกนไม่สำเร็จ'}</div>
          <button onClick={actions.goPoints} style={{ background: '#fff', border: '1px solid #a33232', color: '#a33232', padding: '9px 20px', borderRadius: 16, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>ไปหน้าพอยท์</button>
        </div>
      )}
    </main>
  )
}
