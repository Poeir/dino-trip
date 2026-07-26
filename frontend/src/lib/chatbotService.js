// Talks directly to the local chatbot-service (FastAPI, see ../../../chatbot-service/)
// over plain HTTP -- this is a local dev process, not something deployed
// alongside Supabase, so no supabase-js/functions.invoke involved here.
const BASE_URL = import.meta.env.VITE_CHATBOT_SERVICE_URL || 'http://localhost:8000'

export async function sendChatMessage(message, history) {
  const res = await fetch(`${BASE_URL}/chat/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  })
  if (!res.ok) throw new Error(`chatbot-service /chat failed (${res.status})`)
  return res.json() // { reply, places }
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
