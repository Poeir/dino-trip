import { CalendarDays, Database, MapPin, Phone, Search, Send, Sparkles, X } from 'lucide-react'
import { StarGlyph } from './Icons.jsx'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import AiNotice from './AiNotice.jsx'

// Google's four-colour "G", for the "searching Google" step.
function GoogleG({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

// The chat's thinking-state icon for chatbot-service's status `step`.
function StepIcon({ step }) {
  if (step === 'google') return <GoogleG />
  if (step === 'database') return <Database size={14} color="#1565C0" strokeWidth={2.2} />
  return <Sparkles size={14} color="#2E7D32" strokeWidth={2.2} />
}

// Google Search for a Google-fallback card: name + its อำเภอ + ขอนแก่น, so a
// same-named place in another province doesn't come up first.
function googleSearchUrl(place) {
  const district = /อำเภอ\s*([^\s,]+)/.exec(place.address || '')?.[1]
  const q = [place.name, district && `อำเภอ${district}`, 'ขอนแก่น'].filter(Boolean).join(' ')
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

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
    const numbered = line.match(/^(\d+)\.\s+(.*)/)
    const bulleted = !numbered && line.match(/^[*-]\s+(.*)/)
    const type = numbered ? 'ol' : bulleted ? 'ul' : 'p'
    const content = numbered ? numbered[2] : bulleted ? bulleted[1] : line
    const last = blocks[blocks.length - 1]
    if (last && last.type === type) last.items.push(content)
    // Keep the number the model wrote: detail lines between "1." and "2." split the <ol>, and each
    // fragment would otherwise restart at 1.
    else blocks.push({ type, items: [content], start: numbered ? Number(numbered[1]) : undefined })
  })
  return blocks.map((block, bi) => {
    if (block.type === 'ol') {
      return (
        <ol key={bi} start={block.start} style={{ margin: '4px 0', paddingLeft: 20 }}>
          {block.items.map((item, ii) => <li key={ii} style={{ marginBottom: 2 }}>{renderInline(item, `${bi}-${ii}`)}</li>)}
        </ol>
      )
    }
    if (block.type === 'ul') {
      // "ป้าย: ค่า" bullets (the bot's usual detail lines) become a tidy label/value list.
      const fields = block.items.map((item) => item.replace(/\*\*/g, '').match(/^([^:：]{1,24})[:：]\s*(.+)$/))
      if (fields.every(Boolean)) {
        return (
          <div key={bi} style={{ margin: '6px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {fields.map((f, ii) => (
              <div key={ii} style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E3EDDD', borderRadius: 10, padding: '6px 10px' }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#2E7D32', letterSpacing: 0.2 }}>{f[1]}</span>
                <span style={{ fontSize: 13, color: '#1f2a24' }}>{f[2]}</span>
              </div>
            ))}
          </div>
        )
      }
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

const bubbleMessages = [
  'อยากไปเที่ยวไหนดีครับ ถามน้องไดโนได้เลย!',
  'ให้น้องไดโนช่วยวางแผนทริปมั้ยครับ?',
  'มีคำถามเกี่ยวกับขอนแก่นมั้ยครับ ถามได้เลยนะ',
]

const BUBBLE_FIRST_MS = 8000
const BUBBLE_EVERY_MS = 60000
const BUBBLE_SHOW_MS = 7000
const BUBBLE_SNOOZE_MS = 6 * 60 * 60 * 1000
const SNOOZE_KEY = 'dino-chat-bubble-snooze-until'
const readSnoozeUntil = () => {
  try { return Number(localStorage.getItem(SNOOZE_KEY)) || 0 } catch { return 0 }
}

const sparkles = [
  { left: '10%', top: '20%', size: 4, duration: '2.6s', delay: '0s' },
  { left: '85%', top: '55%', size: 5, duration: '3s', delay: '0.5s' },
  { left: '50%', top: '75%', size: 4, duration: '2.8s', delay: '1s' },
]

export default function ChatWidget() {
  const { state, actions, derived } = useApp()
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [bubbleIndex, setBubbleIndex] = useState(0)
  const scrollRef = useRef(null)
  const stickToBottomRef = useRef(true)

  // Follow the newest message (and streaming text), unless the user scrolled up to read history.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const last = derived.chatMessagesView[derived.chatMessagesView.length - 1]
    if (last && last.from !== 'bot') stickToBottomRef.current = true // the user just sent something
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [derived.chatMessagesView, state.chatTyping, state.chatOpen])

  useEffect(() => {
    if (state.chatOpen) { setBubbleVisible(false); return }
    let hideTimer
    const show = () => {
      if (Date.now() < readSnoozeUntil()) return
      setBubbleIndex((i) => (i + 1) % bubbleMessages.length)
      setBubbleVisible(true)
      hideTimer = setTimeout(() => setBubbleVisible(false), BUBBLE_SHOW_MS)
    }
    const interval = setInterval(show, BUBBLE_EVERY_MS)
    const firstShow = setTimeout(show, BUBBLE_FIRST_MS)
    return () => { clearInterval(interval); clearTimeout(hideTimer); clearTimeout(firstShow) }
  }, [state.chatOpen])

  // Closing the bubble with x silences it for a good while (kept across reloads).
  const dismissBubble = () => {
    setBubbleVisible(false)
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + BUBBLE_SNOOZE_MS)) } catch { /* private mode: snooze only lasts until reload */ }
  }

  return (
    <div data-role="chat-widget" style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      {state.chatOpen && (
        <div style={{ width: 'min(390px, calc(100vw - 32px))', height: 'min(580px, calc(100dvh - 130px))', background: '#fff', borderRadius: 24, boxShadow: '0 24px 60px rgba(27,94,32,0.30), 0 0 0 1px rgba(46,125,50,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden', marginBottom: 14, animation: 'dc-pop 0.28s ease both' }}>
          <div style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg,#66BB6A,#2E7D32 60%,#1B5E20)', padding: '16px 16px 14px' }}>
            {sparkles.map((s, i) => (
              <span key={i} style={{ position: 'absolute', left: s.left, top: s.top, width: s.size, height: s.size, borderRadius: '50%', background: '#FBC02D', animation: `dc-particle-float ${s.duration} ease-in-out infinite`, animationDelay: s.delay, pointerEvents: 'none' }}></span>
            ))}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ position: 'relative', width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 2px rgba(255,255,255,0.35)' }}>
                  <img src="/assets/icon-chatbot.webp" alt="" style={{ width: '78%', height: '78%', objectFit: 'contain' }} />
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
              <button onClick={actions.toggleChat} style={{ background: 'rgba(255,255,255,0.16)', border: 'none', color: '#fff', fontSize: 16, width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={16} /></button>
            </div>
          </div>
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget
              stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            }}
            style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: 'linear-gradient(180deg,#F6F8F1,#FBFAF3 40%)' }}>
            <AiNotice variant="compact" />
            {derived.chatMessagesView.map((msg, i) => (
              // sendChat appends an empty bot message as the streaming target; the typing dots cover that gap.
              msg.from === 'bot' && !msg.text ? null : <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignSelf: msg.align, maxWidth: msg.from === 'bot' ? '94%' : '82%' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7 }}>
                  {msg.from === 'bot' && (
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#66BB6A,#2E7D32)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 3 }}>
                      <img src="/assets/icon-chatbot.webp" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </span>
                  )}
                  <div style={msg.from === 'bot'
                    ? { background: '#fff', color: '#1f2a24', border: '1px solid #E3EDDD', boxShadow: '0 2px 8px rgba(27,94,32,0.06)', padding: '10px 14px', borderRadius: '16px 16px 16px 4px', fontSize: 13.5, lineHeight: 1.6, animation: 'dc-pop 0.25s ease both', minWidth: 0 }
                    : { background: 'linear-gradient(135deg,#43A047,#2E7D32)', color: msg.color, boxShadow: '0 4px 12px rgba(46,125,50,0.25)', padding: '9px 14px', borderRadius: '16px 16px 4px 16px', fontSize: 13.5, lineHeight: 1.5, animation: 'dc-pop 0.25s ease both' }}>
                    {msg.from === 'bot' ? renderMarkdown(msg.text) : msg.text}
                  </div>
                </div>
                {msg.from === 'bot' && msg.places && msg.places.length > 0 && (
                  <div style={{ paddingLeft: 29, fontSize: 10.5, color: '#626863' }}>
                    อ้างอิงจาก {msg.places.length} สถานที่
                  </div>
                )}
                {msg.from === 'bot' && msg.places && msg.places.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingLeft: 29 }}>
                    {msg.places.map((p) => p.source === 'google' ? (
                      // Live Google result (chatbot's fallback for thin areas): no page of
                      // ours to open, so the card links out to Maps / the phone instead.
                      <div key={p.id} style={{ flexShrink: 0, width: 170, background: '#FFFDF5', border: '1px dashed #E0C97A', borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: '#1f2a24', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: '#5f6a63', marginBottom: 4 }}><StarGlyph size={11} /> {p.rating ?? '-'}</div>
                        <div style={{ fontSize: 10, color: '#8A6D1F', background: '#FFF4D6', borderRadius: 6, padding: '2px 6px', marginBottom: 6, display: 'inline-block' }}>แหล่งจาก Google</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 8, rowGap: 4 }}>
                          {p.mapsUrl && (
                            <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: '#1B5E20', textDecoration: 'none' }}>
                              <MapPin size={12} aria-hidden="true" /> แผนที่
                            </a>
                          )}
                          {p.phone && (
                            <a href={`tel:${p.phone.replace(/\s/g, '')}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: '#1B5E20', textDecoration: 'none' }}>
                              <Phone size={12} aria-hidden="true" /> โทร
                            </a>
                          )}
                          {/* A plain link: the user's browser runs the search, so no API cost. */}
                          <a href={googleSearchUrl(p)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: '#1B5E20', textDecoration: 'none' }}>
                            <Search size={12} aria-hidden="true" /> ค้นหา
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div key={p.id} onClick={() => actions.openPlace(p.id)} style={{ flexShrink: 0, width: 140, background: '#fff', border: '1px solid #E7E3D2', borderRadius: 12, padding: 10, cursor: 'pointer' }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: '#1f2a24', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: '#5f6a63', marginBottom: 3 }}><StarGlyph size={11} /> {p.rating ?? '-'}</div>
                        <div style={{ fontSize: 10.5, color: '#626863', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.address}</div>
                      </div>
                    ))}
                  </div>
                )}
                {msg.from === 'bot' && msg.events && msg.events.length > 0 && (
                  <div style={{ paddingLeft: 29, fontSize: 10.5, color: '#626863' }}>
                    อ้างอิงจาก {msg.events.length} อีเวนท์
                  </div>
                )}
                {msg.from === 'bot' && msg.events && msg.events.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingLeft: 29 }}>
                    {msg.events.map((e) => (
                      <div key={e.id} onClick={() => actions.openEvent(e.id)} style={{ flexShrink: 0, width: 190, background: '#fff', border: '1px solid #E3EDDD', borderLeft: '4px solid #FBC02D', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(27,94,32,0.06)' }}>
                        <div style={{ fontWeight: 800, fontSize: 12.5, color: '#1f2a24', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#5f6a63', marginBottom: 3, minWidth: 0 }}>
                          <MapPin size={12} color="#2E7D32" aria-hidden="true" style={{ flexShrink: 0 }} />
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.venueName || '-'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#5f6a63', minWidth: 0 }}>
                          <CalendarDays size={12} color="#2E7D32" aria-hidden="true" style={{ flexShrink: 0 }} />
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.events.find((x) => x.id === e.id)?.dateLabel || e.dateRange || 'ไม่มีข้อมูลวันที่'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {state.chatTyping && (
              // Gemini-style thinking state: logo in a spinning gradient ring and the
              // current step with a light sweeping across it (index.css .dc-thinking-*).
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, alignSelf: 'flex-start', padding: '4px 0' }}>
                <span className="dc-thinking-avatar" aria-hidden="true">
                  {/* key: the new step's icon pops in when the step changes */}
                  <span key={state.chatStatusStep} className="dc-thinking-avatar__icon">
                    <StepIcon step={state.chatStatusStep} />
                  </span>
                </span>
                {/* key: replays the fade-in each time the step changes */}
                <span key={state.chatStatus} className="dc-thinking-text" role="status" aria-live="polite">
                  {state.chatStatus || 'น้องไดโนกำลังคิด...'}
                </span>
              </div>
            )}
          </div>
          {derived.chatMessagesView.some((m) => m.from !== 'bot') && (
            <Link to="/survey" onClick={actions.toggleChat} style={{ display: 'block', padding: '7px 14px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#1B5E20', background: '#E8F5E9', borderTop: '1px solid #C8E6C9', textDecoration: 'none' }}>
              ใช้งานแล้วเป็นอย่างไร? ช่วยทำแบบประเมินความพึงพอใจ (3 นาที)
            </Link>
          )}
          <div style={{ display: 'flex', gap: 8, padding: '12px 14px', borderTop: '1px solid #E7E3D2', background: '#fff' }}>
            <input
              value={state.chatInput}
              maxLength={500}
              onChange={actions.onChatInputChange}
              onKeyDown={(e) => { if (e.key === 'Enter') actions.sendChat() }}
              placeholder="พิมพ์คำถามของคุณ..."
              style={{ flex: 1, minWidth: 0, border: '1px solid #DCD8C6', background: '#F8F9F4', borderRadius: 20, padding: '9px 16px', fontSize: 13.5, outline: 'none' }}
            />
            <button onClick={() => actions.sendChat()} disabled={state.chatBusy} className="dc-send-btn" style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', border: 'none', width: 36, height: 36, borderRadius: '50%', cursor: state.chatBusy ? 'default' : 'pointer', opacity: state.chatBusy ? 0.45 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px rgba(46,125,50,0.35)' }}>
              <Send size={16} color="#fff" aria-label="ส่ง" style={{ marginLeft: -1 }} />
            </button>
          </div>
        </div>
      )}

      {!state.chatOpen && bubbleVisible && (
        <div onClick={() => { actions.toggleChat(); setBubbleVisible(false) }} className="dc-chat-bubble" style={{ position: 'absolute', bottom: 76, right: 6, width: 216, background: '#fff', borderRadius: 16, padding: '12px 30px 12px 14px', boxShadow: '0 14px 32px rgba(0,0,0,0.18)', fontSize: 13, color: '#1f2a24', lineHeight: 1.45, cursor: 'pointer', animation: 'dc-pop 0.3s ease both' }}>
          {bubbleMessages[bubbleIndex]}
          <button onClick={(e) => { e.stopPropagation(); dismissBubble() }} aria-label="ปิด" style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', color: '#aaa', fontSize: 14, cursor: 'pointer', lineHeight: 1, display: 'flex' }}><X size={14} /></button>
          <div style={{ position: 'absolute', bottom: -6, right: 24, width: 12, height: 12, background: '#fff', transform: 'rotate(45deg)', boxShadow: '2px 2px 4px rgba(0,0,0,0.05)' }}></div>
        </div>
      )}

      <button onClick={() => { actions.toggleChat(); setBubbleVisible(false) }} className="dc-chat-fab" style={{ width: 64, height: 64, borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, animation: state.chatOpen ? 'none' : 'dc-pulse 2.4s infinite' }}>
        <img src="/assets/icon-chatbot.webp" alt="แชทกับน้องไดโน" style={{ width: '92%', height: '92%', objectFit: 'contain' }} />
      </button>
    </div>
  )
}
