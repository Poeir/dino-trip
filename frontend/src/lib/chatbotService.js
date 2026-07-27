// Talks directly to the local chatbot-service (FastAPI, see ../../../chatbot-service/)
// over plain HTTP -- this is a local dev process, not something deployed
// alongside Supabase, so no supabase-js/functions.invoke involved here.
const BASE_URL = import.meta.env.VITE_CHATBOT_SERVICE_URL || 'http://localhost:8000'

// The service streams Server-Sent Events: `token` chunks as the reply is
// generated, then one `done` event with the full reply + source places.
// `places` is only known once the whole reply is in (agent.py has to check
// for the fallback message first), so it always arrives on `done`, not
// progressively.
export async function sendChatMessage(message, history, { onToken } = {}) {
  const res = await fetch(`${BASE_URL}/chat/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  })
  if (!res.ok) throw new Error(`chatbot-service /chat failed (${res.status})`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let reply = ''
  let places = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() // last chunk may be incomplete, keep for next read
    for (const raw of events) {
      const line = raw.trim()
      if (!line.startsWith('data: ')) continue
      const payload = JSON.parse(line.slice(6))
      if (payload.type === 'token') {
        reply += payload.text
        onToken?.(payload.text)
      } else if (payload.type === 'done') {
        reply = payload.reply
        places = payload.places
      }
    }
  }

  return { reply, places } // shape matches the old non-streaming response
}

export async function requestTripPlan(tripInput) {
  const res = await fetch(`${BASE_URL}/trip/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tripInput),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `chatbot-service /trip/llm failed (${res.status})`)
  }
  return res.json() // TripResponse
}
