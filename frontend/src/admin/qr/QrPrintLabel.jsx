import { useEffect } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { qrValue } from './qrValue.js'

const PRINT_CANVAS_ID = 'qr-canvas-print'

// Renders (hidden) the label that @media print shows alone, then opens the print dialog.
// window.print() already offers "Save as PDF", so no PDF library is needed. `onDone` fires after
// printing (or cancelling) so the parent can unmount the label.
export default function QrPrintLabel({ qr, onDone }) {
  useEffect(() => {
    const handleAfterPrint = () => onDone()
    window.addEventListener('afterprint', handleAfterPrint)
    const t = setTimeout(() => window.print(), 50)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', handleAfterPrint) }
  }, [qr, onDone])

  return (
    <div id="qr-print-label" className="ad-print-label">
      <QRCodeCanvas id={PRINT_CANVAS_ID} value={qrValue(qr)} size={280} includeMargin />
      <div className="ad-print-label__name">{qr.placeName}</div>
      <div className="ad-print-label__points">สแกนรับ {qr.points} พอยท์</div>
    </div>
  )
}
