import { useState } from 'react'
import { MASCOT } from '../data/categoryImages.js'
import Modal from './Modal.jsx'

// Flip to false (or delete the <AiNotice /> usages) once the AI trip planner
// and chatbot are stable again.
export const SHOW_AI_NOTICE = true

export const AI_NOTICE_TEXT = 'น้องไดโนกำลังพัฒนาระบบวางแผนด้วย AI กับ Chatbot อยู่ อาจจะใช้ได้บ้างใช้ไม่ได้บ้าง ขอโทษด้วยน้าาาาา'

// A sad-dino notice. variant "card" is the roomy one (trip planner page);
// "compact" fits inside the welcome popup and the chat window.
export default function AiNotice({ variant = 'card' }) {
  const [open, setOpen] = useState(true)
  if (!SHOW_AI_NOTICE) return null
  if (variant === 'popup') {
    return (
      <Modal open={open} onClose={() => setOpen(false)} maxWidth={400}>
        <div role="note" style={{ textAlign: 'center' }}>
          <img src={MASCOT.sad} alt="" width={110} height={110} style={{ width: 110, height: 'auto', margin: '0 auto 8px' }} />
          <div style={{ fontWeight: 800, fontSize: 17, color: '#7A5205', marginBottom: 6 }}>ประกาศจากน้องไดโน</div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#7A5205', margin: '0 0 18px' }}>{AI_NOTICE_TEXT}</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{ border: 'none', background: '#2E7D32', color: '#fff', borderRadius: 20, padding: '9px 28px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            รับทราบ
          </button>
        </div>
      </Modal>
    )
  }
  const compact = variant === 'compact'
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 10 : 14,
        background: '#FFF8E1',
        border: '1px solid #FFE082',
        borderRadius: compact ? 14 : 18,
        padding: compact ? '6px 12px' : '10px 18px',
        margin: compact ? 0 : '0 auto 22px',
        maxWidth: compact ? undefined : 520,
      }}
    >
      <img src={MASCOT.sad} alt="" width={compact ? 64 : 88} height={compact ? 64 : 88} style={{ width: compact ? 64 : 88, height: 'auto', flexShrink: 0 }} />
      <div style={{ fontSize: compact ? 12 : 13.5, lineHeight: 1.5, color: '#7A5205' }}>
        {!compact && <div style={{ fontWeight: 800, marginBottom: 2 }}>ประกาศจากน้องไดโน</div>}
        {AI_NOTICE_TEXT}
      </div>
    </div>
  )
}
