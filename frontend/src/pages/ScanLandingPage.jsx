import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { MASCOT } from '../data/categoryImages.js'
import ScanResultModal from '../components/ScanResultModal.jsx'

const heroIcon = { width: 130, height: 130, objectFit: 'contain', display: 'block', margin: '0 auto 10px' }

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
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 'var(--page-pv-center) var(--page-gutter)' }}>
      {(!state.authChecked || !state.loggedIn) && (
        <div style={{ textAlign: 'center', padding: 28, border: '1px dashed #C8E6C9', borderRadius: 14 }}>
          <img src={MASCOT.map} alt="" width={130} height={130} style={heroIcon} />
          <div style={{ width: 40, height: 40, borderRadius: '50%', border: '4px solid #C8E6C9', borderTopColor: '#2E7D32', margin: '0 auto 14px', animation: 'dc-spin 0.8s linear infinite' }}></div>
          <div style={{ color: '#5f6a63', fontSize: 14 }}>กำลังตรวจสอบ QR Code...</div>
        </div>
      )}
      <ScanResultModal
        processing={derived.isScanProcessing}
        success={derived.isScanSuccess}
        error={derived.isScanError}
        place={state.scanResultPlace}
        points={state.scanResultPoints}
        message={state.scanError}
        onClose={actions.goPoints}
        closeLabel="ไปหน้าพอยท์"
      />
    </main>
  )
}
