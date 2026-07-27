import { Fragment, useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'

function renderInline(text, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '')
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
  })
}

function renderMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  lines.forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) return
    const numbered = line.match(/^\d+\.\s+(.*)/)
    const bulleted = !numbered && line.match(/^[*-]\s+(.*)/)
    const type = numbered ? 'ol' : bulleted ? 'ul' : 'p'
    const content = numbered ? numbered[1] : bulleted ? bulleted[1] : line
    const last = blocks[blocks.length - 1]
    if (last && last.type === type) last.items.push(content)
    else blocks.push({ type, items: [content] })
  })
  return blocks.map((block, bi) => {
    if (block.type === 'ol') {
      return (
        <ol key={bi} style={{ margin: '4px 0', paddingLeft: 20 }}>
          {block.items.map((item, ii) => <li key={ii} style={{ marginBottom: 2 }}>{renderInline(item, `${bi}-${ii}`)}</li>)}
        </ol>
      )
    }
    if (block.type === 'ul') {
      return (
        <ul key={bi} style={{ margin: '4px 0', paddingLeft: 20 }}>
          {block.items.map((item, ii) => <li key={ii} style={{ marginBottom: 2 }}>{renderInline(item, `${bi}-${ii}`)}</li>)}
        </ul>
      )
    }
    return (
      <p key={bi} style={{ margin: bi === 0 ? '0 0 6px' : '6px 0' }}>
        {block.items.map((item, ii) => <Fragment key={ii}>{renderInline(item, `${bi}-${ii}`)}</Fragment>)}
      </p>
    )
  })
}

// Templated (not LLM-generated) follow-up suggestions -- derived purely from
// which categories showed up in the attached place cards, no extra network
// call. Category-specific ones are added on top of a generic base set.
function getFollowUpChips(places) {
  if (!places || places.length === 0) return []
  const categories = new Set(places.map((p) => p.category).filter(Boolean))
  const chips = ['มีสาขาอื่นมั้ย', 'ราคาเท่าไหร่', 'เปิดกี่โมง']
  if (categories.has('ร้านอาหาร') || categories.has('คาเฟ่')) {
    chips.push('มีเมนูมังสวิรัติมั้ย')
  }
  if (categories.has('สถานที่ท่องเที่ยว') || categories.has('วัด') || categories.has('สวนสาธารณะ')) {
    chips.push('ใกล้ๆ มีที่เที่ยวอะไรอีก')
  }
  return chips.slice(0, 3)
}

const bubbleMessages = [
  'อยากไปเที่ยวไหนดีครับ ถามน้องไดโนได้เลย!',
  'ให้น้องไดโนช่วยวางแผนทริปมั้ยครับ?',
  'มีคำถามเกี่ยวกับขอนแก่นมั้ยครับ ถามได้เลยนะ',
]

const sparkles = [
  { left: '10%', top: '20%', size: 4, duration: '2.6s', delay: '0s' },
  { left: '85%', top: '55%', size: 5, duration: '3s', delay: '0.5s' },
  { left: '50%', top: '75%', size: 4, duration: '2.8s', delay: '1s' },
]

export default function ChatWidget() {
  const { state, actions, derived } = useApp()
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [bubbleIndex, setBubbleIndex] = useState(0)

  useEffect(() => {
    if (state.chatOpen) { setBubbleVisible(false); return }
    let hideTimer
    const interval = setInterval(() => {
      setBubbleIndex((i) => (i + 1) % bubbleMessages.length)
      setBubbleVisible(true)
      hideTimer = setTimeout(() => setBubbleVisible(false), 6000)
    }, 15000)
    const firstShow = setTimeout(() => setBubbleVisible(true), 4000)
    const firstHide = setTimeout(() => setBubbleVisible(false), 10000)
    return () => { clearInterval(interval); clearTimeout(hideTimer); clearTimeout(firstShow); clearTimeout(firstHide) }
  }, [state.chatOpen])

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      {state.chatOpen && (
        <div style={{ width: 340, height: 460, background: '#fff', borderRadius: 22, boxShadow: '0 20px 48px rgba(27,94,32,0.28)', display: 'flex', flexDirection: 'column', overflow: 'hidden', marginBottom: 14, animation: 'dc-pop 0.28s ease both' }}>
          <div style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg,#66BB6A,#2E7D32 60%,#1B5E20)', padding: '16px 16px 14px' }}>
            {sparkles.map((s, i) => (
              <span key={i} style={{ position: 'absolute', left: s.left, top: s.top, width: s.size, height: s.size, borderRadius: '50%', background: '#FBC02D', animation: `dc-particle-float ${s.duration} ease-in-out infinite`, animationDelay: s.delay, pointerEvents: 'none' }}></span>
            ))}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ position: 'relative', width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 2px rgba(255,255,255,0.35)' }}>
                  <img src="./assets/icon-chatbot.svg" alt="" style={{ width: '78%', height: '78%', objectFit: 'contain' }} />
                  <span style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: '#8BC34A', border: '2px solid #2E7D32', animation: 'dc-pulse 2s infinite' }}></span>
                </span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#fff', fontWeight: 800, fontSize: 14.5 }}>น้องไดโน</span>
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: '#1B5E20', background: '#FBC02D', padding: '1.5px 7px', borderRadius: 8, letterSpacing: 0.3 }}>AI</span>
                  </div>
                  <div style={{ color: '#E8F5E9', fontSize: 11 }}>ผู้ช่วยนำเที่ยวขอนแก่น · ออนไลน์</div>
                </div>
              </div>
              <button onClick={actions.toggleChat} style={{ background: 'rgba(255,255,255,0.16)', border: 'none', color: '#fff', fontSize: 16, width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: 'linear-gradient(180deg,#FBFAF3,#fff 40%)' }}>
            {derived.chatMessagesView.map((msg, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignSelf: msg.align, maxWidth: '85%' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7 }}>
                  {msg.from === 'bot' && (
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#66BB6A,#2E7D32)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 3 }}>
                      <img src="./assets/icon-chatbot.svg" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </span>
                  )}
                  <div style={{ background: msg.from === 'bot' ? 'linear-gradient(135deg,#F1F8E9,#E8F5E9)' : '#2E7D32', color: msg.color, padding: '9px 13px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, animation: 'dc-pop 0.25s ease both' }}>
                    {msg.from === 'bot' ? renderMarkdown(msg.text) : msg.text}
                  </div>
                </div>
                {msg.from === 'bot' && msg.places && msg.places.length > 0 && (
                  <div style={{ paddingLeft: 29, fontSize: 10.5, color: '#8a938c' }}>
                    อ้างอิงจาก {msg.places.length} สถานที่
                  </div>
                )}
                {msg.from === 'bot' && msg.places && msg.places.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingLeft: 29 }}>
                    {msg.places.map((p) => (
                      <div key={p.id} onClick={() => actions.openPlace(p.id)} style={{ flexShrink: 0, width: 140, background: '#fff', border: '1px solid #E7E3D2', borderRadius: 12, padding: 10, cursor: 'pointer' }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: '#1f2a24', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: '#6d7a72', marginBottom: 3 }}>★ {p.rating ?? '-'}</div>
                        <div style={{ fontSize: 10.5, color: '#8a938c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.address}</div>
                      </div>
                    ))}
                  </div>
                )}
                {msg.from === 'bot' && msg.places && msg.places.length > 0 && i === derived.chatMessagesView.length - 1 && !state.chatTyping && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 29 }}>
                    {getFollowUpChips(msg.places).map((chip) => (
                      <button
                        key={chip}
                        onClick={() => actions.sendChat(chip)}
                        style={{ background: '#fff', border: '1px solid #C8E6C9', color: '#2E7D32', borderRadius: 14, padding: '5px 11px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {state.chatTyping && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#66BB6A,#2E7D32)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 3 }}>
                  <img src="./assets/icon-chatbot.svg" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </span>
                <div style={{ display: 'flex', gap: 4, background: '#F1F8E9', padding: '10px 14px', borderRadius: 14 }}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#2E7D32', animation: 'dc-typing-dot 1.1s ease-in-out infinite', animationDelay: `${i * 0.15}s` }}></span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #E7E3D2' }}>
            <input
              value={state.chatInput}
              onChange={actions.onChatInputChange}
              onKeyDown={(e) => { if (e.key === 'Enter') actions.sendChat() }}
              placeholder="พิมพ์คำถามของคุณ..."
              style={{ flex: 1, border: '1px solid #DCD8C6', borderRadius: 16, padding: '8px 14px', fontSize: 13.5, outline: 'none' }}
            />
            <button onClick={() => actions.sendChat()} className="dc-send-btn" style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', border: 'none', width: 36, height: 36, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px rgba(46,125,50,0.35)' }}>
              <span style={{ width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: '9px solid #fff', marginLeft: 2 }}></span>
            </button>
          </div>
        </div>
      )}

      {!state.chatOpen && bubbleVisible && (
        <div onClick={() => { actions.toggleChat(); setBubbleVisible(false) }} className="dc-chat-bubble" style={{ position: 'absolute', bottom: 76, right: 6, width: 216, background: '#fff', borderRadius: 16, padding: '12px 30px 12px 14px', boxShadow: '0 14px 32px rgba(0,0,0,0.18)', fontSize: 13, color: '#1f2a24', lineHeight: 1.45, cursor: 'pointer', animation: 'dc-pop 0.3s ease both' }}>
          {bubbleMessages[bubbleIndex]}
          <button onClick={(e) => { e.stopPropagation(); setBubbleVisible(false) }} style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', color: '#aaa', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}>×</button>
          <div style={{ position: 'absolute', bottom: -6, right: 24, width: 12, height: 12, background: '#fff', transform: 'rotate(45deg)', boxShadow: '2px 2px 4px rgba(0,0,0,0.05)' }}></div>
        </div>
      )}

      <button onClick={() => { actions.toggleChat(); setBubbleVisible(false) }} className="dc-chat-fab" style={{ width: 64, height: 64, borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, animation: state.chatOpen ? 'none' : 'dc-pulse 2.4s infinite' }}>
        <img src="./assets/icon-chatbot.svg" alt="แชทกับน้องไดโน" style={{ width: '92%', height: '92%', objectFit: 'contain' }} />
      </button>
    </div>
  )
}
