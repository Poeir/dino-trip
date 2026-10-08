import { QRCodeCanvas } from 'qrcode.react'
import { Download, Printer } from 'lucide-react'
import Modal from '../../components/Modal.jsx'
import Button from '../ui/Button.jsx'
import { qrValue } from './qrValue.js'

const PREVIEW_CANVAS_ID = 'qr-canvas-preview'

function downloadQrPng(canvasId, filename) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export default function QrPreviewModal({ qr, onClose, onPrint }) {
  return (
    <Modal open={!!qr} onClose={onClose} title={qr ? `QR Code: ${qr.placeName}` : ''} size="sm">
      {qr && (
        <div className="ad-qr-preview">
          <QRCodeCanvas id={PREVIEW_CANVAS_ID} value={qrValue(qr)} size={200} includeMargin />
          <div className="ad-qr-preview__points">สแกนรับ {qr.points} พอยท์</div>
          <div className="ad-qr-preview__actions">
            <Button variant="soft" onClick={() => downloadQrPng(PREVIEW_CANVAS_ID, `qr-${qr.placeName}.png`)}><Download size={15} aria-hidden="true" />ดาวน์โหลด PNG</Button>
            <Button variant="secondary" onClick={() => onPrint(qr)}><Printer size={15} aria-hidden="true" />พิมพ์ป้าย</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
