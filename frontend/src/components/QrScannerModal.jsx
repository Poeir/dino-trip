import { useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import Modal from './Modal.jsx'

const SCANNER_ELEMENT_ID = 'qr-scanner-view'

// Opens the device camera and decodes QR codes in-frame. Unmounts (via
// Modal's `if (!open) return null`) the instant a code is detected or the
// user cancels -- the cleanup effect below is what actually releases the
// camera in either case, since React doesn't call it until the component
// (or its `open` dependency) changes.
export default function QrScannerModal({ open, onDetected, onError }) {
  const detectedRef = useRef(false)

  useEffect(() => {
    if (!open) return
    detectedRef.current = false
    const html5QrCode = new Html5Qrcode(SCANNER_ELEMENT_ID)
    let cancelled = false

    html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 240 },
      (decodedText) => {
        if (cancelled || detectedRef.current) return
        detectedRef.current = true
        onDetected(decodedText)
      },
      () => {} // per-frame "no code found yet" -- not an error, ignore
    ).catch((err) => {
      if (!cancelled) onError(err?.message || 'ไม่สามารถเปิดกล้องได้')
    })

    return () => {
      cancelled = true
      html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {})
    }
  }, [open])

  return (
    <Modal open={open} onClose={() => onError(null)} title="สแกน QR Code" maxWidth={380}>
      <div id={SCANNER_ELEMENT_ID} style={{ width: '100%', borderRadius: 12, overflow: 'hidden' }} />
      <p style={{ fontSize: 12.5, color: '#6d7a72', marginTop: 12, textAlign: 'center' }}>
        เล็งกล้องไปที่ QR Code ที่ติดอยู่ ณ สถานที่ท่องเที่ยว
      </p>
    </Modal>
  )
}
