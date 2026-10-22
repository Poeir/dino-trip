// Talks directly to the local chatbot-service (FastAPI, see ../../../chatbot-service/)
// over plain HTTP -- this is a local dev process, not something deployed
// alongside Supabase, so no supabase-js/functions.invoke involved here.
// `??` not `||`: empty means "same origin" (/chat/ and /trip/ are proxied by Caddy).
const BASE_URL = import.meta.env.VITE_CHATBOT_SERVICE_URL ?? 'http://localhost:8000'

// The service streams Server-Sent Events: `token` chunks as the reply is
// generated, then one `done` event with the full reply + source places/events.
// `places`/`events` are only known once the whole reply is in (agent.py has
// to check for the fallback message first), so they always arrive on `done`,
// not progressively.
// How long the stream may stay silent before the request is given up on. The
// first token waits for rewrite + retrieval + the model (worst case ~40s with
// the server's own timeouts); a stalled reply must not leave the send button
// disabled forever.
const CHAT_IDLE_TIMEOUT_MS = 60_000

// onStatus(text): the step chatbot-service is on while the user waits for the
// first token ("กำลังค้นหาข้อมูล...", "กำลังค้นเพิ่มจาก Google...").
export async function sendChatMessage(message, { history = [], onToken, onStatus } = {}) {
  const controller = new AbortController()
  let idleTimer
  const armIdleTimer = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), CHAT_IDLE_TIMEOUT_MS)
  }
  armIdleTimer()
  try {
    return await readChatStream(message, history, onToken, onStatus, controller.signal, armIdleTimer)
  } finally {
    clearTimeout(idleTimer)
  }
}

async function readChatStream(message, history, onToken, onStatus, signal, armIdleTimer) {
  const res = await fetch(`${BASE_URL}/chat/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
    signal,
  })
  if (!res.ok) {
    // Carries the status so the caller can tell "slow down" (429) from a real failure.
    const err = new Error(`chatbot-service /chat failed (${res.status})`)
    err.status = res.status
    throw err
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let reply = ''
  let places = []
  let events = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    armIdleTimer()
    buffer += decoder.decode(value, { stream: true })
    const sseEvents = buffer.split('\n\n')
    buffer = sseEvents.pop() // last chunk may be incomplete, keep for next read
    for (const raw of sseEvents) {
      const line = raw.trim()
      if (!line.startsWith('data: ')) continue
      const payload = JSON.parse(line.slice(6))
      if (payload.type === 'token') {
        reply += payload.text
        onToken?.(payload.text)
      } else if (payload.type === 'status') {
        onStatus?.(payload.text, payload.step)
      } else if (payload.type === 'done') {
        reply = payload.reply
        places = payload.places
        events = payload.events
      }
    }
  }

  return { reply, places, events } // shape matches the old non-streaming response
}

export async function requestTripPlan(tripInput) {
  const res = await fetch(`${BASE_URL}/trip/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tripInput),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    // FastAPI validation errors (422) put an array in `detail`; only a string is user-facing.
    throw new Error(typeof body.detail === 'string' && body.detail ? body.detail : `chatbot-service /trip/llm failed (${res.status})`)
  }
  return res.json() // TripResponse
}
