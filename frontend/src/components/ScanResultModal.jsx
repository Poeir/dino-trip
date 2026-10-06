import Modal from './Modal.jsx'
import LoadingSpinner from './LoadingSpinner.jsx'
import { MASCOT } from '../data/categoryImages.js'

const heroIcon = { width: 120, height: 120, objectFit: 'contain', display: 'block', margin: '0 auto 10px' }
const noop = () => {}

// Pop-up for the outcome of a QR scan (processing / success / error), shared
// by PointsPage (in-app scanner) and ScanLandingPage (physical QR opened in
// a camera app). While processing it can't be dismissed -- the claim is
// already in flight -- otherwise `onClose` resets the scan state.
export default function ScanResultModal({ processing, success, error, place, points, message, onClose, closeLabel = 'ปิด' }) {
  const open = processing || success || error
  return (
    <Modal open={open} onClose={processing ? noop : onClose} maxWidth={360}>
      <div style={{ textAlign: 'center', animation: 'dc-pop 0.3s ease both' }}>
        {processing && <LoadingSpinner size={40} label="กำลังตรวจสอบ QR Code..." />}
        {success && (
          <>
            <img src={MASCOT.celebrate} alt="" width={120} height={120} style={heroIcon} />
            <div style={{ fontWeight: 800, fontSize: 17, color: '#1B5E20', marginBottom: 4 }}>สแกนสำเร็จที่ {place}!</div>
            <div style={{ color: '#2E7D32', fontSize: 14.5, marginBottom: 18 }}>คุณได้รับ +{points} พอยท์</div>
            <button onClick={onClose} style={{ background: '#2E7D32', color: '#fff', border: 'none', padding: '9px 24px', borderRadius: 16, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>{closeLabel}</button>
          </>
        )}
        {error && (
          <>
            <img src={MASCOT.sad} alt="" width={120} height={120} style={heroIcon} />
            <div style={{ color: '#a33232', fontSize: 14, fontWeight: 700, marginBottom: 18 }}>{message || 'สแกนไม่สำเร็จ'}</div>
            <button onClick={onClose} style={{ background: '#fff', border: '1px solid #a33232', color: '#a33232', padding: '9px 24px', borderRadius: 16, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>{closeLabel}</button>
          </>
        )}
      </div>
    </Modal>
  )
}
