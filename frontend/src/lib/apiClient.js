// Talks to the backend API (backend/src/) for all Places/Events/KnowledgeBase/
// QRs/Rewards data -- replaces the old direct-to-Supabase calls that used to
// live in AppContext.jsx via supabaseClient.js.
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

async function request(path, options) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    // Sends/accepts the httpOnly session cookies /api/auth sets -- needed
    // for every call, not just auth ones, since it's also what makes /me
    // and (eventually) any login-gated endpoint recognize the session.
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error?.message || `API request failed: ${path} (${res.status})`)
  }
  return res.status === 204 ? null : res.json()
}

const apiGet = (path) => request(path)
const apiPost = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) })
const apiPut = (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) })
const apiDelete = (path) => request(path, { method: 'DELETE' })

export const fetchPlaces = () => apiGet('/api/places')
export const createPlace = (payload) => apiPost('/api/places', payload)
export const updatePlace = (id, payload) => apiPut(`/api/places/${id}`, payload)
export const deletePlace = (id) => apiDelete(`/api/places/${id}`)

export const fetchEvents = () => apiGet('/api/events')
export const createEvent = (payload) => apiPost('/api/events', payload)
export const updateEvent = (id, payload) => apiPut(`/api/events/${id}`, payload)
export const deleteEvent = (id) => apiDelete(`/api/events/${id}`)

export const fetchKnowledgeBase = () => apiGet('/api/knowledge-base')
export const createKnowledgeBase = (payload) => apiPost('/api/knowledge-base', payload)
export const updateKnowledgeBase = (id, payload) => apiPut(`/api/knowledge-base/${id}`, payload)
export const deleteKnowledgeBase = (id) => apiDelete(`/api/knowledge-base/${id}`)

export const fetchQrs = () => apiGet('/api/qrs')
export const createQr = (payload) => apiPost('/api/qrs', payload)
export const updateQr = (id, payload) => apiPut(`/api/qrs/${id}`, payload)
export const deleteQr = (id) => apiDelete(`/api/qrs/${id}`)

export const fetchRewards = () => apiGet('/api/rewards')
export const createReward = (payload) => apiPost('/api/rewards', payload)
export const updateReward = (id, payload) => apiPut(`/api/rewards/${id}`, payload)
export const deleteReward = (id) => apiDelete(`/api/rewards/${id}`)

// Tourist auth -- session lives in httpOnly cookies the backend sets, never
// in anything this client reads or stores itself. See auth.routes.js.
export const login = (email, password) => apiPost('/api/auth/login', { email, password })
// multipart/form-data -- the picked avatar file (if any) rides in the same
// request as the rest of the form, since there's no account row to attach
// an uploaded image to until this request creates one. Bypasses request()'s
// JSON Content-Type: the browser must set the multipart boundary itself
// from the FormData body.
export const signup = async (fields, avatarFile) => {
  const form = new FormData()
  Object.entries(fields).forEach(([key, value]) => { if (value != null) form.append(key, value) })
  if (avatarFile) form.append('avatarFile', avatarFile)
  const res = await fetch(`${BASE_URL}/api/auth/signup`, { method: 'POST', body: form, credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error?.message || `API request failed: /api/auth/signup (${res.status})`)
  }
  return res.json()
}
export const confirmEmail = (token) => apiPost('/api/auth/confirm', { token })
export const forgotPassword = (email) => apiPost('/api/auth/forgot-password', { email })
export const resetPassword = (token, password) => apiPost('/api/auth/reset-password', { token, password })
export const logout = () => apiPost('/api/auth/logout')
export const fetchMe = () => apiGet('/api/auth/me')

// Points: requires a logged-in tourist session (cookie), same as the auth
// calls above. scanQr takes the qrId decoded from the QR's URL content --
// the backend looks the points/place up itself, see qrs.routes.js.
export const fetchPointsBalance = () => apiGet('/api/points/me')
export const scanQr = (qrId) => apiPost(`/api/qrs/${qrId}/scan`, {})
export const redeemReward = (rewardId) => apiPost('/api/points/redeem', { rewardId })
