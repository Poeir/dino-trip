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
    throw Object.assign(new Error(body.error?.message || `API request failed: ${path} (${res.status})`), { status: res.status })
  }
  return res.status === 204 ? null : res.json()
}

// `params` values that are undefined/null/'' are dropped rather than sent as
// literal "undefined" strings -- callers pass e.g. `category: undefined` for
// "ทั้งหมด" (no category filter) rather than branching around the call.
const apiGet = (path, params) => {
  if (!params) return request(path)
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') qs.set(key, value)
  }
  const qsStr = qs.toString()
  return request(qsStr ? `${path}?${qsStr}` : path)
}
const apiPost = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) })
const apiPut = (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) })
const apiDelete = (path) => request(path, { method: 'DELETE' })

// Called with no `params`, these return the full unpaginated array
// (crudRouter.js's default GET / behavior). Passing `{ page, limit, ... }`
// switches the response to the paginated `{ data, total, page, pageSize,
// totalPages }` shape instead -- used by the admin tables and the public
// places/events list pages, each fetching their own page. `{ ids }` (comma-
// joined) instead returns exactly those rows, unpaginated -- see
// AppContext.jsx's post-trip-plan QR-points lookup.
export const fetchPlaces = (params) => apiGet('/api/places', params)
// Places with a live, scannable QR (active + unexpired), `qrPoints` being what
// scanning really awards -- see qrs.routes.js's `/meta/places`.
export const fetchScannablePlaces = () => apiGet('/api/qrs/meta/places')
// Single place by id -- PlaceDetailPage/EventDetailPage/TripResultPage's
// lookups and PlacePicker's "resolve the currently-selected value", all of
// which used to page through AppContext's full bulk `state.places` array
// before that was removed (see crudRouter.js's generic `GET /:id`).
export const fetchPlace = (id) => apiGet(`/api/places/${id}`)
// id+name only, for EventsTab's venue-name <datalist> -- see
// places.routes.js's `/meta/names`.
export const fetchPlaceNames = () => apiGet('/api/places/meta/names')
export const createPlace = (payload) => apiPost('/api/places', payload)
export const updatePlace = (id, payload) => apiPut(`/api/places/${id}`, payload)
export const deletePlace = (id) => apiDelete(`/api/places/${id}`)

export const fetchEvents = (params) => apiGet('/api/events', params)
export const createEvent = (payload) => apiPost('/api/events', payload)
export const updateEvent = (id, payload) => apiPut(`/api/events/${id}`, payload)
export const deleteEvent = (id) => apiDelete(`/api/events/${id}`)
// Admin-only: LLM-extracts event form fields from a pasted Facebook post.
// Goes through the backend (not chatbot-service directly) so requireAdmin
// actually gates it -- see backend/src/routes/events.routes.js.
export const extractEventFromText = (text) => apiPost('/api/events/extract', { text })

// Up to 5 photos per event (see MAX_PHOTOS_PER_EVENT in
// backend/src/routes/events.routes.js, matching places' own gallery cap).
export const fetchEventPhotos = (id) => apiGet(`/api/events/${id}/photos`)

// multipart/form-data, same reasoning as uploadPlacePhoto further down --
// bypasses request()'s forced JSON Content-Type. Returns the full updated
// event (mirrors createEvent/updateEvent's shape) so the caller can merge it
// straight into state without a separate refetch.
export const uploadEventPhoto = async (id, file) => {
  const form = new FormData()
  form.append('photoFile', file)
  const res = await fetch(`${BASE_URL}/api/events/${id}/photos`, { method: 'POST', body: form, credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error?.message || `API request failed: /api/events/${id}/photos (${res.status})`)
  }
  return res.json()
}
export const deleteEventPhoto = (id, photoId) => apiDelete(`/api/events/${id}/photos/${photoId}`)

export const fetchKnowledgeBase = (params) => apiGet('/api/knowledge-base', params)
export const createKnowledgeBase = (payload) => apiPost('/api/knowledge-base', payload)
export const updateKnowledgeBase = (id, payload) => apiPut(`/api/knowledge-base/${id}`, payload)
export const deleteKnowledgeBase = (id) => apiDelete(`/api/knowledge-base/${id}`)

export const fetchQrs = (params) => apiGet('/api/qrs', params)
export const createQr = (payload) => apiPost('/api/qrs', payload)
export const updateQr = (id, payload) => apiPut(`/api/qrs/${id}`, payload)
export const deleteQr = (id) => apiDelete(`/api/qrs/${id}`)
// Admin-only: [{ qrId, scans, pointsTotal }] and the latest redemptions.
// Admin user management (backend/src/routes/adminUsers.routes.js). Every
// change returns the updated list row.
export const fetchAdminStats = () => apiGet('/api/admin/stats')
// Trip-planning statistics for the last `days` (7 / 30 / 90 / 365).
export const fetchAdminTripStats = (days) => apiGet('/api/admin/stats/trips', { days })
// Every recorded trip plan (owned by a user, or `owner: null` = recorded for
// statistics when the visitor wasn't logged in). Params: page, limit, search,
// owner ('user' | 'anonymous'), issue ('1' = has a closed/removed place).
export const fetchAdminTrips = (params) => apiGet('/api/admin/trips', params)
export const fetchAdminTrip = (id) => apiGet(`/api/admin/trips/${id}`)
export const deleteAdminTrip = (id, reason) => apiPost(`/api/admin/trips/${id}/delete`, { reason })
export const fetchAdminUsers = (params) => apiGet('/api/admin/users', params)
export const fetchAdminUser = (id) => apiGet(`/api/admin/users/${id}`)
export const suspendUser = (id, reason) => apiPost(`/api/admin/users/${id}/suspend`, { reason })
export const unsuspendUser = (id) => apiPost(`/api/admin/users/${id}/unsuspend`, {})
export const deleteUser = (id, reason) => apiPost(`/api/admin/users/${id}/delete`, { reason })
export const restoreUser = (id) => apiPost(`/api/admin/users/${id}/restore`, {})
export const adjustUserPoints = (id, delta, reason) => apiPost(`/api/admin/users/${id}/points`, { delta, reason })
export const revokeUserSessions = (id) => apiPost(`/api/admin/users/${id}/revoke-sessions`, {})
export const resendUserVerification = (id) => apiPost(`/api/admin/users/${id}/resend-verification`, {})

export const fetchQrStats = () => apiGet('/api/qrs/meta/stats')
// Counter redemption (admin): history, redeem on a tourist's behalf, undo.
export const fetchRedemptionHistory = (params) => apiGet('/api/admin/redemptions', params)
export const redeemForUser = (userId, rewardId) => apiPost('/api/admin/redemptions', { userId, rewardId })
export const cancelRedemption = (id, reason) => apiPost(`/api/admin/redemptions/${id}/cancel`, { reason })

export const fetchRewards = (params) => apiGet('/api/rewards', params)
export const createReward = (payload) => apiPost('/api/rewards', payload)
export const updateReward = (id, payload) => apiPut(`/api/rewards/${id}`, payload)
export const deleteReward = (id) => apiDelete(`/api/rewards/${id}`)
// One image per reward; both return the full updated reward. multipart, so
// bypasses request()'s forced JSON Content-Type (same as uploadPlacePhoto).
export const uploadRewardImage = async (id, file) => {
  const form = new FormData()
  form.append('imageFile', file)
  const res = await fetch(`${BASE_URL}/api/rewards/${id}/image`, { method: 'POST', body: form, credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error?.message || `API request failed: /api/rewards/${id}/image (${res.status})`)
  }
  return res.json()
}
export const deleteRewardImage = (id) => apiDelete(`/api/rewards/${id}/image`)

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
// `position` ({ lat, lng }) is optional -- only places with coordinates need it.
export const scanQr = (qrId, position) => apiPost(`/api/qrs/${qrId}/scan`, position ? { lat: position.lat, lng: position.lng } : {})

// Saved trip plans (backend/src/routes/trips.routes.js). Everything except
// createTrip needs a logged-in session; createTrip also accepts a visitor who
// isn't logged in, but then it only records the plan for admin statistics and
// returns `{ id: null }`.
export const createTrip = (payload) => apiPost('/api/trips', payload)
export const fetchTrip = (id) => apiGet(`/api/trips/${id}`)
// The visitor's own trips, `{ data, total, ... }` like the other paginated lists
// (usePagedList-compatible; `favorite: '1'` keeps only starred ones).
export const fetchTrips = (params) => apiGet('/api/trips', params)
// `fields` is { title } and/or { isFavorite }.
export const updateTrip = (id, fields) => request(`/api/trips/${id}`, { method: 'PATCH', body: JSON.stringify(fields) })
// `liked` is true (like), false (dislike) or null (clear).
export const setTripItemLike = (tripId, itemId, liked) => request(`/api/trips/${tripId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ liked }) })
export const deleteTrip = (id) => apiDelete(`/api/trips/${id}`)
export const duplicateTrip = (id) => apiPost(`/api/trips/${id}/duplicate`)

// Admin: manually (re)builds RAG embeddings for places/knowledge_base rows
// created or edited since the last run -- see backend/src/routes/reindex.routes.js.
export const triggerReindex = () => apiPost('/api/reindex', {})
export const fetchReindexStatus = () => apiGet('/api/reindex/status')
// { places: [{id,name}], knowledgeBase: [{id,name}], events: [{id,name}] } -- fetched
// on demand (see DashboardTab's ReindexCard) rather than polled, since it's only
// needed when the admin expands the pending list.
export const fetchReindexPending = () => apiGet('/api/reindex/pending')

// Up to 5 photos per place (see MAX_PHOTOS_PER_PLACE in
// backend/src/routes/places.routes.js, matching fetch-places.js's own
// Google-photo gallery size).
export const fetchPlacePhotos = (id) => apiGet(`/api/places/${id}/photos`)

// multipart/form-data, same reasoning as signup()'s avatarFile above --
// bypasses request()'s forced JSON Content-Type. Returns the full updated
// place (mirrors createPlace/updatePlace's shape) so the caller can merge it
// straight into state without a separate refetch.
export const uploadPlacePhoto = async (id, file) => {
  const form = new FormData()
  form.append('photoFile', file)
  const res = await fetch(`${BASE_URL}/api/places/${id}/photos`, { method: 'POST', body: form, credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error?.message || `API request failed: /api/places/${id}/photos (${res.status})`)
  }
  return res.json()
}
export const deletePlacePhoto = (id, photoId) => apiDelete(`/api/places/${id}/photos/${photoId}`)

// Tourist: point at the fields that look wrong (login required). `fields` is a
// list of name/address/location/hours/phone/website/closed/photos/other; `other`
// needs a note. Never changes the place -- an admin resolves it.
export const reportPlace = (id, fields, note) => apiPost(`/api/places/${id}/reports`, { fields, note })
// Fields this user already has an open report for on the place.
export const fetchMyPlaceReports = (id) => apiGet(`/api/places/${id}/reports/mine`)

// Events: same idea, with the event field vocabulary (name/date/venue/admission/
// status/organizer/photos/other). Admin side mirrors the place-report calls.
export const fetchEvent = (id) => apiGet(`/api/events/${id}`)
export const reportEvent = (id, fields, note) => apiPost(`/api/events/${id}/reports`, { fields, note })
export const fetchMyEventReports = (id) => apiGet(`/api/events/${id}/reports/mine`)
export const fetchAdminEventReports = (params) => apiGet('/api/admin/event-reports', params)
export const fetchAdminEventReportCount = () => apiGet('/api/admin/event-reports/count')
// body: { eventId, field, status: 'resolved' (+ resolution: edited|no_change) | 'rejected' }
export const resolveAdminEventReports = (body) => apiPost('/api/admin/event-reports/resolve', body)

// Admin: reports grouped per place. Params: status (pending|resolved|rejected|
// superseded), page, limit.
export const fetchAdminPlaceReports = (params) => apiGet('/api/admin/place-reports', params)
export const fetchAdminPlaceReportCount = () => apiGet('/api/admin/place-reports/count')
// Closes every pending report for one place + field. `status` is 'resolved'
// (with `resolution`: edited|synced|no_change) or 'rejected'.
export const resolveAdminPlaceReports = (body) => apiPost('/api/admin/place-reports/resolve', body)

// Admin: Google sync (backend/src/routes/adminPlaceSync.routes.js). Selection
// input is { scope: single|selected|filter|all, ids, filters, maxItems }.
export const previewPlaceSync = (selection) => apiPost('/api/admin/place-sync/preview', selection)
// Starts a background job; rejects with `err.needsConfirm`-style 409 when the
// run is large (retry with confirm: true after showing the count).
export const startPlaceSyncJob = (body) => apiPost('/api/admin/place-sync/jobs', body)
export const fetchPlaceSyncJobs = () => apiGet('/api/admin/place-sync/jobs')
export const fetchPlaceSyncJob = (id) => apiGet(`/api/admin/place-sync/jobs/${id}`)
export const cancelPlaceSyncJob = (id) => apiPost(`/api/admin/place-sync/jobs/${id}/cancel`, {})
export const syncOnePlace = (id, body = {}) => apiPost(`/api/admin/place-sync/places/${id}/sync`, body)
export const fetchPlaceSyncInfo = (id) => apiGet(`/api/admin/place-sync/places/${id}`)
export const resolvePlaceGoogleDiff = (id, field, action) => apiPost(`/api/admin/place-sync/places/${id}/diff/${field}`, { action })
export const setPlaceLockedFields = (id, lockedFields) => apiPut(`/api/admin/place-sync/places/${id}/locked-fields`, { lockedFields })

// The signed-in user's own account (backend/src/routes/profile.routes.js).
// multipart helper for the avatar upload -- bypasses request()'s forced JSON
// Content-Type so the browser can set the multipart boundary itself.
async function sendForm(method, path, form) {
  const res = await fetch(`${BASE_URL}${path}`, { method, body: form, credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body.error?.message || `API request failed: ${path} (${res.status})`), { status: res.status })
  }
  return res.json()
}
export const fetchProfile = () => apiGet('/api/profile')
export const updateProfile = (fields) => request('/api/profile', { method: 'PATCH', body: JSON.stringify(fields) })
// `avatar` is { preset } or { file, position: "X% Y%", scale }.
export const updateProfileAvatar = (avatar) => {
  const form = new FormData()
  if (avatar.file) {
    form.append('avatarFile', avatar.file)
    form.append('avatarPosition', avatar.position)
    form.append('avatarScale', String(avatar.scale))
  } else {
    form.append('avatarUrl', `preset:${avatar.preset}`)
  }
  return sendForm('PUT', '/api/profile/avatar', form)
}
export const removeProfileAvatar = () => request('/api/profile/avatar', { method: 'DELETE' })
// `type` is 'scan' | 'redeem' | 'adjust' (omit for everything).
export const fetchProfileHistory = (params) => apiGet('/api/profile/history', params)
export const changePassword = (currentPassword, newPassword) => apiPost('/api/profile/password', { currentPassword, newPassword })
export const requestEmailChange = (email, password) => apiPost('/api/profile/email', { email, password })
export const cancelEmailChangeRequest = () => apiDelete('/api/profile/email')
export const confirmEmailChange = (token) => apiPost('/api/profile/email/confirm', { token })
export const deleteMyAccount = (password) => request('/api/profile', { method: 'DELETE', body: JSON.stringify({ password }) })
