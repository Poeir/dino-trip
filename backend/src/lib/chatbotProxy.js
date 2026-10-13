import { httpError } from '../middleware/errorHandler.js'

// Shared by every Node route that forwards a request to chatbot-service
// (FastAPI). That service has no auth of its own -- whatever `mutateAuth`/
// middleware guards the Node route calling this is what actually gates
// access, so the browser must never be pointed at chatbot-service directly
// for these endpoints.
const CHATBOT_SERVICE_URL = process.env.CHATBOT_SERVICE_URL || 'http://localhost:8000'

export async function forwardToChatbotService(path, options) {
  let res
  try {
    res = await fetch(`${CHATBOT_SERVICE_URL}${path}`, options)
  } catch {
    throw httpError(502, 'ติดต่อ chatbot-service ไม่ได้')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw httpError(res.status, body.detail || 'เรียก chatbot-service ไม่สำเร็จ')
  return body
}
