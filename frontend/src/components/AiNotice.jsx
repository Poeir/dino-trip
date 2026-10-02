import { MASCOT } from '../data/categoryImages.js'

// Flip to false (or delete the <AiNotice /> usages) once the AI trip planner
// and chatbot are stable again.
export const SHOW_AI_NOTICE = true

export const AI_NOTICE_TEXT = 'น้องไดโนกำลังพัฒนาระบบวางแผนด้วย AI กับ Chatbot อยู่ อาจจะใช้ได้บ้างใช้ไม่ได้บ้าง ขอโทษด้วยน้าาาาา'

// A sad-dino notice. variant "card" is the roomy one (trip planner page);
// "compact" fits inside the welcome popup and the chat window.
export default function AiNotice({ variant = 'card' }) {
  if (!SHOW_AI_NOTICE) return null
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
