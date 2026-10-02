import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  categories, categoryIcons, interestList, budgetList, budgetMeta, areaScopeList, areaScopeMeta
} from '../data/seed.js'
import thaiAddress from '../data/thaiAddress.json'
import {
  fetchPlaces, createPlace, updatePlace, deletePlace,
  fetchEvents, createEvent, updateEvent, deleteEvent,
  fetchKnowledgeBase, createKnowledgeBase, updateKnowledgeBase, deleteKnowledgeBase,
  fetchQrs, createQr, updateQr, deleteQr,
  fetchRewards, createReward, updateReward, deleteReward,
  login as apiLogin, signup as apiSignup, confirmEmail as apiConfirmEmail,
  forgotPassword as apiForgotPassword, resetPassword as apiResetPassword,
  logout as apiLogout, fetchMe,
  fetchPointsBalance, scanQr,
  createTrip, fetchTrip, setTripItemLike,
} from '../lib/apiClient.js'
import { sendChatMessage, requestTripPlan } from '../lib/chatbotService.js'
import { getCurrentPosition, LOCATION_ERROR_MESSAGE, GENERIC_LOCATION_ERROR } from '../lib/geolocation.js'
import { isWelcomeSnoozed, snoozeWelcome } from '../lib/welcomeSnooze.js'

const AppContext = createContext(null)

// Built-in avatar choices for the signup persona card -- no illustration
// assets exist yet for a full character set, so these are simple emoji on a
// brand-pastel swatch rather than custom art. Stored as "preset:<key>".
const PERSONA_AVATARS = [
  { key: 'dino', emoji: '🦕', bg: '#E8F5E9' },
  { key: 'turtle', emoji: '🐢', bg: '#E0F2F1' },
  { key: 'leaf', emoji: '🌿', bg: '#F1F8E9' },
  { key: 'backpack', emoji: '🎒', bg: '#FFF3E0' },
  { key: 'map', emoji: '🗺️', bg: '#E3F2FD' },
  { key: 'mountain', emoji: '⛰️', bg: '#EFEBE9' },
  { key: 'temple', emoji: '⛩️', bg: '#FCE4EC' },
  { key: 'sun', emoji: '☀️', bg: '#FFFDE7' },
]
const MAX_AVATAR_FILE_BYTES = 2 * 1024 * 1024
// Mirrors MAX_HISTORY_MESSAGES in chatbot-service agent.py.
const CHAT_HISTORY_LIMIT = 4

// Password strength checklist shown live under the field as the visitor
// types (see derived.passwordRules) -- kept to widely-understood rules
// (length + the three character classes) rather than also demanding a
// symbol, since this guards a tourism rewards account, not a bank.
const PASSWORD_RULES = [
  { key: 'length', label: 'อย่างน้อย 8 ตัวอักษร', test: (p) => p.length >= 8 },
  { key: 'upper', label: 'มีตัวพิมพ์ใหญ่ (A-Z)', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'มีตัวพิมพ์เล็ก (a-z)', test: (p) => /[a-z]/.test(p) },
  { key: 'number', label: 'มีตัวเลข (0-9)', test: (p) => /[0-9]/.test(p) },
]
const isPasswordValid = (password) => PASSWORD_RULES.every((r) => r.test(password))
// Clamp helper for dragging the uploaded photo within its circle (see
// setAvatarPosition below) -- object-position is a 0-100% pair.
const clampPct = (n) => Math.max(0, Math.min(100, n))

// chatbot-service's schedule mixes real places with two synthetic slots that
// have no places row: the closing "return to the hotel" and "Free Time" filler.
// Saving a trip (see planToTripPayload) needs to tell them apart.
const slotKind = (status) => status === 'End of Day (Return to Hotel)' ? 'hotel' : status === 'Free Time' ? 'free_time' : 'place'

// "HH:MM" -> minutes-since-midnight, for computing how long a trip-plan item
// lasts (arrival_time/departure_time only arrive as display strings from the
// API, not a duration field).
const hhmmToMinutes = (hhmm) => {
  if (!hhmm || typeof hhmm !== 'string' || !hhmm.includes(':')) return null
  const [h, m] = hhmm.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

const formatDurationMinutes = (mins) => {
  if (mins == null || mins <= 0) return null
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} นาที`
  if (m === 0) return `${h} ชม.`
  return `${h} ชม. ${m} นาที`
}

const initialState = {
  searchQuery: '',
  eventSearchQuery: '',
  activeCategory: 'ทั้งหมด',
  loggedIn: false,
  // The signed-in user as the API returns it (id, email, displayName, avatarUrl, ...) -- what <Avatar> and the profile page read. userName below is kept for the existing greeting text.
  currentUser: null,
  authChecked: false,
  userName: '',
  userPoints: 0,
  // avatarUrl/avatarFile hold a *local* blob preview + the File itself while
  // filling in the form -- nothing is uploaded until submitSignup, so
  // avatarUrl is never a real server URL here (see submitSignup).
  authForm: { title: '', firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '', gender: '', birthdate: '', occupation: '', province: '', district: '', subdistrict: '', avatarUrl: '', avatarFile: null, avatarPosition: '50 50', avatarScale: 1, consent: false },
  authError: '',
  avatarUploading: false,
  avatarError: '',
  avatarCropOpen: false,
  avatarCropFile: null,
  avatarCropObjectUrl: '',
  avatarCropPosition: '50 50',
  avatarCropScale: 1,
  authSubmitting: false,
  authPendingConfirmation: false,
  resetForm: { password: '', confirmPassword: '' },
  forgotPasswordSent: false,
  chatOpen: false,
  chatInput: '',
  chatTyping: false,
  chatMessages: [
    { from: 'bot', text: 'สวัสดีครับ! ผมน้องไดโน ผู้ช่วยนำเที่ยวขอนแก่น สอบถามเรื่องสถานที่ อาหาร หรือเทศกาลได้เลยครับ' }
  ],
  // `accommodation` is null until picked, then { name, address, lat, lng }
  // (name/address only present when picked via search, not a dragged pin --
  // see onAccommodationSelect/onAccommodationLocationChange).
  tripForm: { startDate: '', endDate: '', interests: [], budget: 'ปานกลาง', areaScope: 'ทั่วขอนแก่น', accommodation: null, mustGo: [], pace: 'standard', dailyStart: '09:00', dailyEnd: '18:00' },
  mustGoQuery: '',
  // Populated by a debounced fetchPlaces({search}) as mustGoQuery changes
  // (see the effect below) -- used to be a client-side filter over the
  // bulk-loaded `places` array, which no longer exists (see loadData).
  mustGoSuggestions: [],
  tripFormError: '',
  tripStep: 0,
  tripPlanning: false,
  tripPlan: null,
  // Id of the saved copy of `tripPlan` (null while it only exists in memory,
  // e.g. when saving failed) -- TripResultPage's /trip/:id route loads by it.
  tripId: null,
  tripLoading: false,
  tripLoadError: '',
  tripPlanNote: '',
  tripPlanRationale: '',
  feedbackText: '',
  scanState: 'idle',
  scanError: '',
  scanResultPoints: 0,
  scanResultPlace: '',
  favoriteIds: [],
  // Set from navigator.geolocation on mount, if the user grants permission (see below).
  userLocation: null,
  // Populated from the backend API on mount (see loadData below) instead of static seed data.
  // `places` isn't loaded in bulk here anymore -- every page that needs place
  // data now fetches its own slice (PlacesListPage/PlacesTab's paginated
  // fetch, PlaceDetailPage/EventDetailPage/TripResultPage/PlacePicker's
  // single-row fetchPlace, HomePage's top-20, PointsPage's hasQR fetch, etc.)
  // instead of everything reading one bulk array loaded on every page.
  events: [],
  knowledgeBase: [],
  rewards: [],
  qrs: [],
  // True until that initial load settles -- the DB this API talks to can take
  // several seconds (occasionally much longer) to answer a cold query, so
  // pages reading places/events/etc. before then need to tell "still
  // loading" apart from "genuinely empty" (see LoadingSpinner.jsx usage).
  dataLoading: true,
  dataLoadError: false,
  adminLoggedIn: false,
  formOpen: false,
  formType: null,
  formData: {},
  editingId: null,
  mobileMenuOpen: false,
  welcomeModalOpen: !isWelcomeSnoozed(),
  toastMsg: '',
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10)
}
function validateTripDates(f) {
  if (!f.startDate || !f.endDate) return ''
  const start = new Date(f.startDate), end = new Date(f.endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ''
  if (end < start) return 'วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น'
  const days = Math.round((end - start) / 86400000) + 1
  if (days > 7) return 'ระยะเวลาทริปต้องไม่เกิน 7 วัน'
  return ''
}

export function AppProvider({ children }) {
  const navigate = useNavigate()
  const [state, setStateRaw] = useState(initialState)
  const toastTimer = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state

  // Mirrors React class setState: accepts a partial object or an updater fn(prevState) => partial
  const setState = (updater) => {
    setStateRaw((prev) => {
      const partial = typeof updater === 'function' ? updater(prev) : updater
      return { ...prev, ...partial }
    })
  }

  // Error messages are longer than confirmations, so callers pass a longer `ms`.
  const showToast = (msg, ms = 2400) => {
    setState({ toastMsg: msg })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setState({ toastMsg: '' }), ms)
  }
  const ERROR_TOAST_MS = 5000

  // Toast for a failed admin call: signs the admin out when the session ended,
  // says so plainly when the server can't be reached, otherwise shows the
  // server's own message. Returns true when it was a session problem.
  const reportError = (prefix, err) => {
    if (handleSessionExpired(err)) return true
    const reason = err?.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message
    showToast(prefix + reason, ERROR_TOAST_MS)
    return false
  }

  // An admin API call answering 401/403 means the session expired (or the
  // account isn't an admin): send them back to the admin login instead of
  // leaving every button failing with the same message. Returns true if handled.
  const handleSessionExpired = (err) => {
    if (err?.status !== 401 && err?.status !== 403) return false
    setState({ adminLoggedIn: false })
    showToast('เซสชันหมดอายุหรือไม่มีสิทธิ์ผู้ดูแลระบบ กรุณาเข้าสู่ระบบใหม่', ERROR_TOAST_MS)
    navigate('/admin/login')
    return true
  }

  // Bulk data (events/KB/rewards/QRs). Also exposed as actions.reloadData so
  // a screen that shows "load failed" can offer a retry.
  const loadData = async () => {
    setState({ dataLoading: true, dataLoadError: false })
    try {
      const [events, knowledgeBase, rewards, qrs] = await Promise.all([
        fetchEvents(), fetchKnowledgeBase(), fetchRewards(), fetchQrs(),
      ])
      setState({ events, knowledgeBase, rewards, qrs, dataLoading: false })
    } catch (err) {
      console.error('Failed to load data from API:', err)
      showToast('โหลดข้อมูลไม่สำเร็จ ตรวจสอบการเชื่อมต่อ API')
      setState({ dataLoading: false, dataLoadError: true })
    }
  }

  useEffect(() => {
    loadData()

    // Don't pop the location permission prompt on page load -- browsers flag it
    // and visitors distrust a site that asks before they know why. If this site
    // was already allowed, pick the location up silently (no prompt can appear
    // when the state is 'granted'); otherwise it's requested when the visitor
    // uses a feature that needs it (requestUserLocation below). Ranking falls
    // back to rating-only until then.
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' })
        .then((status) => { if (status.state === 'granted') return requestUserLocation() })
        .catch(() => {})
    }
  }, [])

  // Asks the browser for the visitor's position (this is what shows the
  // permission prompt) and stores it. Rejects with an Error carrying `.reason`
  // ('denied' | 'timeout' | 'unavailable' | 'unsupported').
  const requestUserLocation = async () => {
    const loc = await getCurrentPosition({ timeoutMs: 8000 })
    setState({ userLocation: loc })
    return loc
  }
  // Home page's "ดูที่ใกล้ฉัน" button.
  const enableNearbyPlaces = async () => {
    try {
      await requestUserLocation()
    } catch (err) {
      showToast(GENERIC_LOCATION_ERROR[err.reason] ?? GENERIC_LOCATION_ERROR.unavailable, 4500)
    }
  }

  // TripFormPage's "ต้องไปให้ได้" (mustGo) autocomplete -- used to be a
  // client-side filter over the bulk-loaded `places` array, which no longer
  // exists, so debounce a search fetch instead (see mustGoSuggestionsView
  // in the derived section below for the tripForm.mustGo exclusion + view
  // shaping).
  useEffect(() => {
    const q = state.mustGoQuery.trim()
    if (!q) { setState({ mustGoSuggestions: [] }); return }
    const t = setTimeout(() => {
      fetchPlaces({ search: q, isActive: true, limit: 8 })
        .then(({ data }) => setState({ mustGoSuggestions: data }))
        .catch(() => setState({ mustGoSuggestions: [] }))
    }, 300)
    return () => clearTimeout(t)
  }, [state.mustGoQuery])

  // Hydrates loggedIn/userName from the backend's httpOnly session cookie
  // on load, so a page refresh doesn't drop the session (GET /api/auth/me
  // also transparently refreshes an expired access token server-side --
  // see auth.routes.js).
  useEffect(() => {
    fetchMe()
      .then(async ({ user }) => {
        // Balance is fetched before authChecked flips so the header never shows
        // a placeholder "0 พอยท์" that then jumps to the real number.
        const balance = user ? await fetchPointsBalance().then((r) => r.balance).catch(() => 0) : 0
        setState({ loggedIn: !!user, currentUser: user || null, userName: user?.displayName || '', userPoints: balance, authChecked: true, adminLoggedIn: user?.role === 'admin' })
      })
      .catch(() => setState({ authChecked: true }))
  }, [])

  const toggleMobileMenu = () => setState((s) => ({ mobileMenuOpen: !s.mobileMenuOpen }))
  const closeMobileMenu = () => setState({ mobileMenuOpen: false })
  const closeWelcomeModal = () => setState({ welcomeModalOpen: false })
  // "Don't show again for 7 days": close it and remember that in this browser.
  const snoozeWelcomeModal = () => { snoozeWelcome(); setState({ welcomeModalOpen: false }) }
  const welcomeGoTrip = () => { setState({ welcomeModalOpen: false, tripStep: 0 }); navigate('/trip') }
  const welcomeGoPoints = () => { setState({ welcomeModalOpen: false }); navigate('/points') }

  const goHome = () => navigate('/')
  const goPlaces = () => { navigate('/places'); setState({ mobileMenuOpen: false }) }
  const goEvents = () => { navigate('/events'); setState({ mobileMenuOpen: false }) }
  const goPublic = () => navigate('/')
  const goAdminLogin = () => navigate('/admin/login')
  const goTripForm = () => { navigate('/trip'); setState({ tripStep: 0, tripFormError: '' }) }
  const nextStep = () => {
    if (stateRef.current.tripStep === 0) {
      const err = validateTripDates(stateRef.current.tripForm)
      if (err) { setState({ tripFormError: err }); return }
    }
    setState((s) => ({ tripStep: Math.min(3, s.tripStep + 1), tripFormError: '' }))
  }
  const prevStep = () => setState((s) => ({ tripStep: Math.max(0, s.tripStep - 1), tripFormError: '' }))
  const goToStep = (i) => { if (i < stateRef.current.tripStep) setState({ tripStep: i, tripFormError: '' }) }
  const goPoints = () => navigate('/points')
  const goLogin = () => { navigate('/login'); setState({ authError: '', authPendingConfirmation: false }) }
  const goSignup = () => { navigate('/signup'); setState({ authError: '', authPendingConfirmation: false }) }
  const goForgotPassword = () => { navigate('/forgot-password'); setState({ authError: '', forgotPasswordSent: false }) }
  const openPlace = (id) => navigate(`/places/${id}`)
  const openEvent = (id) => navigate(`/events/${id}`)
  const toggleFavorite = (id) => setState((s) => ({
    favoriteIds: s.favoriteIds.includes(id) ? s.favoriteIds.filter((x) => x !== id) : [...s.favoriteIds, id]
  }))
  // Persists via places.is_active (see backend/src/lib/mappers.js's
  // placePayload) -- passes the whole place back through updatePlace rather
  // than a bare {isActive} patch, since placePayload rebuilds every column
  // from its input and a partial body would null out the rest. Takes the
  // place object itself (PlacesTab already has it from its own paginated
  // `paged.rows`) rather than an id -- there's no bulk `state.places` array
  // to look it up in anymore.
  const togglePlaceActive = async (place) => {
    try {
      await updatePlace(place.id, { ...place, isActive: place.isActive === false ? true : false })
    } catch (err) {
      showToast('อัปเดตสถานะไม่สำเร็จ: ' + err.message)
    }
  }

  const setSearchQuery = (v) => setState({ searchQuery: v })
  const onSearchChange = (e) => setSearchQuery(e.target.value)
  const setCategory = (c) => setState({ activeCategory: c })
  const setEventSearchQuery = (v) => setState({ eventSearchQuery: v })
  const onEventSearchChange = (e) => setEventSearchQuery(e.target.value)

  // Set by ScanLandingPage when someone scans a place's physical QR with
  // their phone's regular camera (not our in-app scanner) while logged out
  // -- we send them to /login first, then need to resume the claim they
  // came here for instead of dropping them on the homepage.
  const PENDING_SCAN_KEY = 'dino-pending-scan-qr-id'
  const redirectAfterAuth = () => {
    const qrId = sessionStorage.getItem(PENDING_SCAN_KEY)
    if (qrId) { sessionStorage.removeItem(PENDING_SCAN_KEY); navigate(`/scan/${qrId}`) }
    else navigate('/')
  }

  const updateAuthField = (f, v) => setState((s) => ({ authForm: { ...s.authForm, [f]: v } }))
  const onAuthTitleChange = (e) => updateAuthField('title', e.target.value)
  const onAuthFirstNameChange = (e) => updateAuthField('firstName', e.target.value)
  const onAuthLastNameChange = (e) => updateAuthField('lastName', e.target.value)
  const onAuthEmailChange = (e) => updateAuthField('email', e.target.value)
  const onAuthPhoneChange = (e) => updateAuthField('phone', e.target.value)
  const onAuthPasswordChange = (e) => updateAuthField('password', e.target.value)
  const onAuthConfirmPasswordChange = (e) => updateAuthField('confirmPassword', e.target.value)
  const onAuthGenderChange = (e) => updateAuthField('gender', e.target.value)
  const onAuthBirthdateChange = (e) => updateAuthField('birthdate', e.target.value)
  const onAuthOccupationChange = (e) => updateAuthField('occupation', e.target.value)
  // Cascading address selects: changing a higher level clears the levels
  // below it since their option lists depend on it (see derived below).
  const onAuthProvinceChange = (e) => setState((s) => ({ authForm: { ...s.authForm, province: e.target.value, district: '', subdistrict: '' } }))
  const onAuthDistrictChange = (e) => setState((s) => ({ authForm: { ...s.authForm, district: e.target.value, subdistrict: '' } }))
  const onAuthSubdistrictChange = (e) => updateAuthField('subdistrict', e.target.value)
  const selectPersonaAvatarPreset = (key) => setState((s) => {
    if (s.authForm.avatarFile) URL.revokeObjectURL(s.authForm.avatarUrl)
    return { authForm: { ...s.authForm, avatarUrl: `preset:${key}`, avatarFile: null, avatarPosition: '50 50', avatarScale: 1 }, avatarError: '' }
  })
  const clearPersonaAvatar = () => setState((s) => {
    if (s.authForm.avatarFile) URL.revokeObjectURL(s.authForm.avatarUrl)
    return { authForm: { ...s.authForm, avatarUrl: '', avatarFile: null, avatarPosition: '50 50', avatarScale: 1 }, avatarError: '' }
  })

  // Picking a file only opens the crop popup with a local (never-uploaded)
  // blob preview. Nothing reaches the server here -- the file itself is
  // held in authForm.avatarFile and only actually uploaded from
  // submitSignup, once the visitor clicks "สมัครสมาชิก".
  const onAuthAvatarFileChange = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setState({ avatarError: 'ไฟล์ต้องเป็นรูปภาพเท่านั้น' }); return }
    if (file.size > MAX_AVATAR_FILE_BYTES) { setState({ avatarError: 'ไฟล์ต้องมีขนาดไม่เกิน 2MB' }); return }
    setState({
      avatarCropOpen: true, avatarCropFile: file, avatarCropObjectUrl: URL.createObjectURL(file),
      avatarCropPosition: '50 50', avatarCropScale: 1, avatarError: '',
    })
  }
  // Re-adjusting the pending photo also goes through the popup (one
  // consistent "dragging happens in the popup" interaction) -- reuses the
  // same File/blob URL already sitting in authForm, no new object URL.
  const openAvatarReposition = () => {
    const f = stateRef.current.authForm
    if (!f.avatarFile) return
    setState({ avatarCropOpen: true, avatarCropFile: f.avatarFile, avatarCropObjectUrl: f.avatarUrl, avatarCropPosition: f.avatarPosition, avatarCropScale: f.avatarScale, avatarError: '' })
  }
  const setAvatarCropPosition = (x, y) => setState({ avatarCropPosition: `${clampPct(x)} ${clampPct(y)}` })
  const setAvatarCropScale = (scale) => setState({ avatarCropScale: Math.max(1, Math.min(3, scale)) })
  const cancelAvatarCrop = () => setState((s) => {
    // Only revoke if this session's blob URL isn't the one authForm already
    // owns (i.e. a brand-new pick being discarded, not a reposition of the
    // already-committed file) -- otherwise cancelling a reposition would
    // kill the preview still shown on the card.
    if (s.avatarCropFile && s.avatarCropFile !== s.authForm.avatarFile) URL.revokeObjectURL(s.avatarCropObjectUrl)
    return { avatarCropOpen: false, avatarCropFile: null, avatarCropObjectUrl: '', avatarError: '' }
  })
  // Purely local: commits the file/position/scale into authForm. The actual
  // upload happens later, in submitSignup, only once the whole form is
  // submitted -- see the note on authForm.avatarUrl above.
  const confirmAvatarCrop = () => setState((s) => ({
    authForm: { ...s.authForm, avatarFile: s.avatarCropFile, avatarUrl: s.avatarCropObjectUrl, avatarPosition: s.avatarCropPosition, avatarScale: s.avatarCropScale },
    avatarCropOpen: false, avatarCropFile: null, avatarCropObjectUrl: '',
  }))
  const onAuthConsentChange = (e) => updateAuthField('consent', e.target.checked)
  const updateResetField = (f, v) => setState((s) => ({ resetForm: { ...s.resetForm, [f]: v } }))
  const onResetPasswordChange = (e) => updateResetField('password', e.target.value)
  const onResetConfirmPasswordChange = (e) => updateResetField('confirmPassword', e.target.value)
  const submitLogin = async () => {
    const s = stateRef.current
    if (!s.authForm.email || !s.authForm.password) { setState({ authError: 'กรุณากรอกอีเมลและรหัสผ่าน' }); return }
    setState({ authSubmitting: true, authError: '' })
    try {
      const { user } = await apiLogin(s.authForm.email, s.authForm.password)
      setState({ authSubmitting: false, loggedIn: true, currentUser: user, userName: user.displayName })
      fetchPointsBalance().then(({ balance }) => setState({ userPoints: balance })).catch(() => {})
      redirectAfterAuth()
    } catch (err) {
      setState({ authSubmitting: false, authError: err.message })
    }
  }
  const submitSignup = async () => {
    const s = stateRef.current
    const f = s.authForm
    if (!f.title || !f.firstName || !f.lastName || !f.email || !f.phone || !f.password || !f.confirmPassword || !f.gender || !f.birthdate || !f.occupation || !f.province || !f.district || !f.subdistrict) {
      setState({ authError: 'กรุณากรอกข้อมูลให้ครบถ้วน' }); return
    }
    if (!/^0\d{9}$/.test(f.phone)) { setState({ authError: 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (10 หลัก ขึ้นต้นด้วย 0)' }); return }
    if (new Date(f.birthdate) > new Date()) { setState({ authError: 'กรุณากรอกวันเกิดให้ถูกต้อง' }); return }
    if (!isPasswordValid(f.password)) { setState({ authError: 'รหัสผ่านยังไม่ตรงตามเกณฑ์ที่กำหนด (ดูรายการด้านล่างช่องรหัสผ่าน)' }); return }
    if (f.password !== f.confirmPassword) { setState({ authError: 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน' }); return }
    if (!f.consent) { setState({ authError: 'กรุณายินยอมนโยบายความเป็นส่วนตัวก่อนสมัครสมาชิก' }); return }
    setState({ authSubmitting: true, authError: '' })

    // The picked photo's bytes only actually upload now, at submit time,
    // bundled into the same multipart request as the rest of the form --
    // until this point it was just a local blob preview (see
    // confirmAvatarCrop). No separate pre-signup upload step anymore.
    const avatarUrl = f.avatarUrl?.startsWith('preset:') ? f.avatarUrl : null
    try {
      const result = await apiSignup({
        title: f.title, firstName: f.firstName, lastName: f.lastName, email: f.email, password: f.password, phone: f.phone,
        gender: f.gender, birthdate: f.birthdate, occupation: f.occupation,
        province: f.province, district: f.district, subdistrict: f.subdistrict,
        avatarUrl,
        avatarPosition: f.avatarFile ? `${f.avatarPosition.split(' ')[0]}% ${f.avatarPosition.split(' ')[1]}%` : null,
        avatarScale: f.avatarFile ? f.avatarScale : null,
      }, f.avatarFile)
      if (f.avatarFile) URL.revokeObjectURL(f.avatarUrl)
      if (result.pendingConfirmation) {
        setState({ authSubmitting: false, authPendingConfirmation: true })
        return
      }
      setState({ authSubmitting: false, loggedIn: true, currentUser: result.user, userName: result.user.displayName })
      redirectAfterAuth()
    } catch (err) {
      setState({ authSubmitting: false, authError: err.message })
    }
  }
  // Called by ConfirmEmailPage after it reads ?token= from the confirmation
  // link's URL. Left to throw on failure so the page (not this action)
  // decides how to render an expired/invalid link.
  const completeEmailConfirmation = async (token) => {
    const { user } = await apiConfirmEmail(token)
    setState({ loggedIn: true, currentUser: user, userName: user.displayName, authChecked: true })
    fetchPointsBalance().then(({ balance }) => setState({ userPoints: balance })).catch(() => {})
    redirectAfterAuth()
  }
  const submitForgotPassword = async () => {
    const s = stateRef.current
    if (!s.authForm.email) { setState({ authError: 'กรุณากรอกอีเมล' }); return }
    setState({ authSubmitting: true, authError: '' })
    try {
      await apiForgotPassword(s.authForm.email)
      setState({ authSubmitting: false, forgotPasswordSent: true })
    } catch (err) {
      setState({ authSubmitting: false, authError: err.message })
    }
  }
  // Called by ResetPasswordPage's form on submit -- unlike
  // completeEmailConfirmation this page has real form fields, so it follows
  // submitLogin/submitSignup's convention (manage authSubmitting/authError
  // itself, shown as an inline banner) rather than throwing, since the token
  // is only consumed by this explicit action, not fired on mount.
  const submitResetPassword = async (token) => {
    const s = stateRef.current
    const f = s.resetForm
    if (!isPasswordValid(f.password)) { setState({ authError: 'รหัสผ่านยังไม่ตรงตามเกณฑ์ที่กำหนด (ดูรายการด้านล่างช่องรหัสผ่าน)' }); return }
    if (f.password !== f.confirmPassword) { setState({ authError: 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน' }); return }
    setState({ authSubmitting: true, authError: '' })
    try {
      const { user } = await apiResetPassword(token, f.password)
      setState({ authSubmitting: false, loggedIn: true, currentUser: user, userName: user.displayName })
      fetchPointsBalance().then(({ balance }) => setState({ userPoints: balance })).catch(() => {})
      redirectAfterAuth()
    } catch (err) {
      setState({ authSubmitting: false, authError: err.message })
    }
  }
  const logout = async () => {
    await apiLogout().catch(() => {})
    setState({ loggedIn: false, currentUser: null, userName: '', userPoints: 0 })
    navigate('/')
  }

  // Profile page: swap in the fresh user the API returned after an edit so the
  // header avatar/greeting update without a reload.
  const setCurrentUser = (user) => setState({ currentUser: user, userName: user?.displayName || '' })
  // The account was deleted server-side (which also cleared the cookie).
  const signedOutLocally = () => { setState({ loggedIn: false, currentUser: null, userName: '', userPoints: 0 }); navigate('/') }

  const toggleChat = () => setState((s) => ({ chatOpen: !s.chatOpen }))
  const setChatInput = (v) => setState({ chatInput: v })
  const onChatInputChange = (e) => setChatInput(e.target.value)
  const sendChat = async (overrideText) => {
    const text = (overrideText ?? stateRef.current.chatInput).trim()
    if (!text) return
    // Snapshot the conversation before the new turn is pushed; empty bot
    // placeholders (interrupted streams) carry no content and are skipped.
    // Only the last few turns are sent: the server keeps just the tail anyway
    // (MAX_HISTORY_MESSAGES), and the whole chat would grow every request and
    // eventually trip the API's 50-message limit.
    const history = stateRef.current.chatMessages
      .filter((m) => m.text)
      .slice(-CHAT_HISTORY_LIMIT)
      .map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text }))
    // Push the user message plus an empty bot placeholder that fills in as
    // tokens stream in -- always the last message in the array while streaming.
    setState((s) => ({ chatMessages: [...s.chatMessages, { from: 'user', text }, { from: 'bot', text: '', places: [], events: [] }], chatInput: '', chatTyping: true }))
    const appendToLastBotMessage = (patch) => setState((s) => {
      const msgs = s.chatMessages.slice()
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...patch(msgs[msgs.length - 1]) }
      return { chatMessages: msgs }
    })
    try {
      const { places, events } = await sendChatMessage(text, {
        history,
        onToken: (token) => {
          setState({ chatTyping: false })
          appendToLastBotMessage((last) => ({ text: last.text + token }))
        },
      })
      appendToLastBotMessage(() => ({ places, events }))
      setState({ chatTyping: false })
    } catch (err) {
      console.error('Chat request failed:', err)
      appendToLastBotMessage(() => ({ text: 'ขออภัยครับ ระบบแชทขัดข้องชั่วคราว ลองใหม่อีกครั้งนะครับ', places: [], events: [] }))
      setState({ chatTyping: false })
    }
  }

  const updateTripField = (f, v) => setState((s) => ({ tripForm: { ...s.tripForm, [f]: v }, tripFormError: '' }))
  const onStartDateChange = (e) => updateTripField('startDate', e.target.value)
  const onEndDateChange = (e) => updateTripField('endDate', e.target.value)
  // Fires from LocationPicker's onChange (dragging the pin or editing the
  // manual lat/lng fields) -- merges into whatever's already set instead of
  // replacing it, so a name/address picked earlier via search survives a
  // subsequent pin nudge.
  const onAccommodationLocationChange = (loc) => setState((s) => ({
    tripForm: { ...s.tripForm, accommodation: { ...(s.tripForm.accommodation || {}), lat: loc.lat, lng: loc.lng } },
    tripFormError: '',
  }))
  // Fires from LocationPicker's onSelectPlace (an Autocomplete search hit) --
  // replaces the whole accommodation, since a new search result has its own
  // name/address too.
  const onAccommodationSelect = (place) => updateTripField('accommodation', { name: place.name, address: place.address, lat: place.lat, lng: place.lng })
  // Uses the coordinate already in state.userLocation, or asks the browser for
  // it now (this is the click that shows the permission prompt) and tells the
  // visitor what to do if that fails.
  const useCurrentLocationForAccommodation = async () => {
    let loc = stateRef.current.userLocation
    if (!loc) {
      try {
        loc = await requestUserLocation()
      } catch (err) {
        showToast(GENERIC_LOCATION_ERROR[err.reason] ?? GENERIC_LOCATION_ERROR.unavailable, 4500)
        return
      }
    }
    updateTripField('accommodation', { name: 'ตำแหน่งปัจจุบันของฉัน', address: '', lat: loc.lat, lng: loc.lng })
  }
  const setTripDatePreset = (preset) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let start = today, end = today
    if (preset === 'today') { end = today }
    else if (preset === '2days') { end = addDays(today, 1) }
    else if (preset === '3days') { end = addDays(today, 2) }
    else if (preset === 'weekend') {
      const untilSat = (6 - today.getDay() + 7) % 7
      start = addDays(today, untilSat)
      end = addDays(start, 1)
    }
    setState((s) => ({ tripForm: { ...s.tripForm, startDate: fmtDate(start), endDate: fmtDate(end) }, tripFormError: '' }))
  }
  const onMustGoQueryChange = (e) => setState({ mustGoQuery: e.target.value })
  const addMustGo = (name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setState((s) => s.tripForm.mustGo.includes(trimmed)
      ? { mustGoQuery: '' }
      : { tripForm: { ...s.tripForm, mustGo: [...s.tripForm.mustGo, trimmed] }, mustGoQuery: '', tripFormError: '' })
  }
  const removeMustGo = (name) => setState((s) => ({ tripForm: { ...s.tripForm, mustGo: s.tripForm.mustGo.filter((x) => x !== name) } }))
  const onMustGoKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addMustGo(stateRef.current.mustGoQuery) }
  }
  const setPace = (p) => setState((s) => ({ tripForm: { ...s.tripForm, pace: p } }))
  const onDailyStartChange = (e) => updateTripField('dailyStart', e.target.value)
  const onDailyEndChange = (e) => updateTripField('dailyEnd', e.target.value)
  const onFeedbackChange = (e) => setState({ feedbackText: e.target.value })
  const toggleInterest = (tag) => setState((s) => {
    const has = s.tripForm.interests.includes(tag)
    return { tripForm: { ...s.tripForm, interests: has ? s.tripForm.interests.filter((x) => x !== tag) : [...s.tripForm.interests, tag] } }
  })
  const setBudget = (b) => setState((s) => ({ tripForm: { ...s.tripForm, budget: b } }))
  const setAreaScope = (a) => setState((s) => ({ tripForm: { ...s.tripForm, areaScope: a } }))

  // Reshapes chatbot-service's TripResponse (itinerary/schedule/place, snake_case)
  // into the shape the rest of the app already renders (days/items/place,
  // camelCase) so TripResultPage.jsx and the derived.tripPlan logic below
  // don't need to know where the plan came from. `qrPointsByPlaceId` (id ->
  // {hasQR,qrPoints}) comes from submitTripForm's own fetchPlaces({ids})
  // call -- chatbot-service's TripResponse deliberately omits has_qr/
  // qr_points (see trip_planner/models.py's `extra = "ignore"`), and there's
  // no bulk `state.places` array to cross-reference anymore.
  const tripResponseToPlan = (resp, startDate, qrPointsByPlaceId) => {
    const baseTime = startDate && !Number.isNaN(new Date(startDate).getTime()) ? new Date(startDate).getTime() : Date.now()
    const days = resp.itinerary.map((day) => {
      const dateObj = new Date(baseTime + (day.day - 1) * 86400000)
      return {
        dayNum: day.day,
        date: dateObj.toISOString().slice(0, 10),
        dayCostEstimate: day.day_cost_estimate,
        dayTravelTimeTotal: day.day_travel_time_total,
        items: day.schedule.map((slot) => ({
          placeId: slot.place.id,
          kind: slotKind(slot.status),
          time: slot.arrival_time,
          departureTime: slot.departure_time,
          status: slot.status,
          liked: null,
          distanceFromPrev: slot.distance_km || null,
          travelTimeMin: slot.travel_time_min,
          waitTimeMin: slot.wait_time_min,
          isAnchor: slot.is_anchor,
          mealRole: slot.meal_role,
          place: {
            id: slot.place.id, name: slot.place.name, category: slot.place.category, rating: slot.place.rating, address: slot.place.address, img: slot.place.img,
            location: (slot.place.lat != null && slot.place.lng != null) ? { lat: slot.place.lat, lng: slot.place.lng } : null,
          },
        })),
      }
    })
    const flatItems = days.flatMap((d) => d.items)
    const totalPoints = flatItems.reduce((sum, it) => {
      const qr = qrPointsByPlaceId.get(it.placeId)
      return sum + (qr && qr.hasQR ? qr.qrPoints : 0)
    }, 0)
    return { days, totalBudget: resp.total_cost_estimate, totalDistance: resp.total_distance_km, totalPoints }
  }

  // Rebuilds the plan shape above from a saved trip (GET /api/trips/:id).
  // Hotel / free-time slots have no places row, so they get the same synthetic
  // ids chatbot-service gave them; a place deleted since planning falls back
  // to the name saved with the trip.
  const tripDetailToPlan = (detail) => {
    const days = detail.days.map((d) => ({
      dayNum: d.dayNo,
      date: d.date,
      dayCostEstimate: d.dayCostEstimate,
      dayTravelTimeTotal: d.dayTravelTimeTotal,
      items: d.items.map((it) => {
        const placeId = it.kind === 'place' ? (it.placeId || `removed_${d.dayNo}_${it.position}`)
          : it.kind === 'hotel' ? 'hotel_dummy' : `free_time_dummy_${d.dayNo}_${it.position}`
        const location = it.lat != null && it.lng != null ? { lat: it.lat, lng: it.lng } : null
        return {
          itemId: it.id, placeId, kind: it.kind, time: it.arrivalTime, departureTime: it.departureTime, status: it.status, liked: it.liked,
          distanceFromPrev: it.distanceKm || null, travelTimeMin: it.travelTimeMin, waitTimeMin: it.waitTimeMin, isAnchor: it.isAnchor, mealRole: it.mealRole,
          place: it.place
            ? { ...toTripPlace(it.place), hasQR: it.place.hasQR, qrPoints: it.place.qrPoints }
            : { id: placeId, name: it.placeName, category: it.kind === 'hotel' ? 'ที่พัก' : null, rating: '-', address: '', img: null, location },
        }
      }),
    }))
    const totalPoints = days.flatMap((d) => d.items).reduce((sum, it) => sum + (it.place.hasQR ? it.place.qrPoints : 0), 0)
    return { days, totalBudget: detail.totalCostEstimate, totalDistance: detail.totalDistanceKm, totalPoints }
  }

  // The request body sent to /trip/llm is what a saved trip keeps as its
  // conditions; this maps it back onto the form (for the "เงื่อนไขที่เลือกไว้"
  // recap and for re-running the same conditions).
  const inputToTripForm = (input, current) => {
    if (!input || !input.start_date) return current
    const end = new Date(`${input.start_date}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + Math.max(0, (input.trip_duration_days || 1) - 1))
    return {
      ...current,
      startDate: input.start_date,
      endDate: end.toISOString().slice(0, 10),
      interests: input.interests || [],
      budget: input.budget_level || current.budget,
      areaScope: input.area_scope || current.areaScope,
      accommodation: (input.accommodation_name || input.accommodation_lat != null)
        ? { name: input.accommodation_name || '', address: '', lat: input.accommodation_lat ?? null, lng: input.accommodation_lng ?? null }
        : null,
      mustGo: input.must_go || [],
      pace: input.trip_pace || current.pace,
      dailyStart: input.start_time || current.dailyStart,
      dailyEnd: input.end_time || current.dailyEnd,
    }
  }

  const planToTripPayload = (plan, input, note, planningRationale) => ({
    input, note, planningRationale,
    totalDistanceKm: plan.totalDistance,
    totalCostEstimate: plan.totalBudget,
    days: plan.days.map((d) => ({
      date: d.date,
      dayCostEstimate: d.dayCostEstimate,
      dayTravelTimeTotal: d.dayTravelTimeTotal,
      items: d.items.map((it) => ({
        kind: it.kind,
        placeId: it.kind === 'place' ? it.placeId : null,
        placeName: it.place.name,
        lat: it.place.location?.lat ?? null,
        lng: it.place.location?.lng ?? null,
        arrivalTime: it.time,
        departureTime: it.departureTime || it.time,
        travelTimeMin: it.travelTimeMin,
        distanceKm: it.distanceFromPrev ?? 0,
        status: it.status,
        waitTimeMin: it.waitTimeMin,
        isAnchor: it.isAnchor,
        mealRole: it.mealRole,
        liked: it.liked,
      })),
    })),
  })

  const loadTrip = async (id) => {
    setState({ tripLoading: true, tripLoadError: '' })
    try {
      const detail = await fetchTrip(id)
      setState((s) => ({
        tripId: detail.id,
        tripPlan: tripDetailToPlan(detail),
        tripPlanNote: detail.note,
        tripPlanRationale: detail.planningRationale,
        tripForm: inputToTripForm(detail.input, s.tripForm),
        tripLoading: false,
        feedbackText: '',
      }))
    } catch (err) {
      console.error('Loading saved trip failed:', err)
      setState({ tripLoading: false, tripLoadError: err.status === 401 ? 'กรุณาเข้าสู่ระบบเพื่อดูแผนทริปที่บันทึกไว้' : err.status === 404 ? 'ไม่พบแผนทริปนี้ หรือคุณไม่มีสิทธิ์ดูแผนนี้' : 'โหลดแผนทริปไม่สำเร็จ ลองอีกครั้งนะครับ' })
    }
  }

  const submitTripForm = async () => {
    const f = stateRef.current.tripForm
    const dateErr = validateTripDates(f)
    if (dateErr) { setState({ tripFormError: dateErr }); return }
    if (timeToMinutes(f.dailyEnd) <= timeToMinutes(f.dailyStart)) { setState({ tripFormError: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น' }); return }
    const rawDays = Math.round((new Date(f.endDate) - new Date(f.startDate)) / 86400000) + 1
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 1

    setState({ tripFormError: '', tripPlanning: true })
    try {
      const tripRequest = {
        trip_duration_days: days,
        start_date: f.startDate,
        accommodation_name: f.accommodation?.name || '',
        accommodation_lat: f.accommodation?.lat ?? null,
        accommodation_lng: f.accommodation?.lng ?? null,
        must_go: f.mustGo,
        interests: f.interests,
        trip_pace: f.pace,
        budget_level: f.budget,
        area_scope: f.areaScope,
        start_time: f.dailyStart,
        end_time: f.dailyEnd,
      }
      const resp = await requestTripPlan(tripRequest)
      if (!resp.itinerary || resp.itinerary.length === 0) {
        setState({ tripPlanning: false, tripFormError: resp.note || 'ไม่พบสถานที่ที่ตรงกับเงื่อนไข ลองปรับความสนใจหรืองบประมาณดูนะครับ' })
        return
      }
      const placeIds = [...new Set(resp.itinerary.flatMap((day) => day.schedule.map((slot) => slot.place.id)))]
      // A generated itinerary is the valuable part -- QR/points info is a
      // nice-to-have layered on top of it. Confirmed live: this call can
      // fail on a transient network blip right after /trip/llm already
      // succeeded, and that used to throw here, discarding the whole
      // already-generated plan and showing "generation failed" even though
      // it hadn't. A failure here now just means every place renders
      // without a QR badge/points (tripResponseToPlan already handles a
      // place missing from this map -- see its totalPoints reduce), instead
      // of losing the plan entirely.
      let qrPointsByPlaceId = new Map()
      if (placeIds.length) {
        try {
          const qrPlaces = await fetchPlaces({ ids: placeIds.join(',') })
          qrPointsByPlaceId = new Map(qrPlaces.map((p) => [p.id, { hasQR: p.hasQR, qrPoints: p.qrPoints }]))
        } catch (err) {
          console.error('Fetching QR points for trip plan places failed (continuing without them):', err)
        }
      }
      let plan = tripResponseToPlan(resp, f.startDate, qrPointsByPlaceId)
      // Save it right away -- generating costs an LLM run, and refreshing the
      // page shouldn't throw that away. Logged-in users get a saved copy they
      // can reopen; for a visitor who isn't logged in the backend only records
      // the plan for statistics (`saved.id` is null), so they keep the in-memory
      // plan at /trip/result. A failed save only costs the saved copy.
      let tripId = null
      try {
        const saved = await createTrip(planToTripPayload(plan, tripRequest, resp.note, resp.planning_rationale || ''))
        if (saved.id) {
          tripId = saved.id
          // Show the saved copy rather than the local one: its items carry the
          // ids that likes are stored under, and it's exactly what reopening the
          // trip later will render.
          plan = tripDetailToPlan(saved)
        }
      } catch (err) {
        console.error('Saving trip plan failed (showing it unsaved):', err)
        // Only someone who expects a saved copy needs to hear that it failed.
        if (stateRef.current.loggedIn) showToast(err.status === 409 || err.status === 429 ? err.message : 'บันทึกแผนทริปไม่สำเร็จ แต่ยังดูแผนนี้ได้ตามปกติ')
      }
      setState({ tripId, tripPlan: plan, tripPlanNote: resp.note, tripPlanRationale: resp.planning_rationale || '', tripPlanning: false, feedbackText: '' })
      navigate(tripId ? `/trip/${tripId}` : '/trip/result')
    } catch (err) {
      console.error('Trip plan request failed:', err)
      setState({ tripPlanning: false, tripFormError: 'สร้างแผนทริปไม่สำเร็จ ลองอีกครั้งนะครับ' })
    }
  }

  const setLikeInPlan = (dayNum, placeId, liked) => setState((s) => ({
    tripPlan: {
      ...s.tripPlan,
      days: s.tripPlan.days.map((d) => d.dayNum !== dayNum ? d : { ...d, items: d.items.map((it) => it.placeId !== placeId ? it : { ...it, liked }) })
    }
  }))

  // Clicking the active button again clears the vote. The button reacts at
  // once; for a saved trip the vote is stored too, and rolled back (with a
  // toast) if that fails. Items without an itemId (e.g. one put in by
  // regeneratePlan, which isn't synced yet) only change on screen.
  const setItemLike = async (dayNum, placeId, val) => {
    const { tripPlan, tripId } = stateRef.current
    const item = tripPlan?.days.find((d) => d.dayNum === dayNum)?.items.find((it) => it.placeId === placeId)
    if (!item) return
    const previous = item.liked
    const next = previous === val ? null : val
    setLikeInPlan(dayNum, placeId, next)
    if (!tripId || !item.itemId) return
    try {
      await setTripItemLike(tripId, item.itemId, next)
    } catch (err) {
      console.error('Saving like failed:', err)
      // Only undo if nothing else has changed this item's vote in the meantime.
      const current = stateRef.current.tripPlan?.days.find((d) => d.dayNum === dayNum)?.items.find((it) => it.placeId === placeId)
      if (current && current.liked === next) setLikeInPlan(dayNum, placeId, previous)
      showToast('บันทึกความชอบไม่สำเร็จ ลองอีกครั้งนะครับ')
    }
  }

  // Shapes a fetched place row into the same trimmed `place` object
  // tripResponseToPlan embeds on every item -- regeneratePlan needs to embed
  // this itself (there's no bulk `state.places` for the derived `tripPlan`
  // view's fallback lookup to fall back to anymore, see below). Swapping a
  // single item was cut from the product (no UI calls it) -- removed here too.
  const toTripPlace = (p) => ({
    id: p.id, name: p.name, category: p.category, rating: p.rating, address: p.address, img: p.img,
    location: (p.location?.lat != null && p.location?.lng != null) ? p.location : null,
  })

  const regeneratePlan = async () => {
    const plan = stateRef.current.tripPlan
    const usedIds = new Set(plan.days.flatMap((d) => d.items.map((i) => i.placeId)))
    const dislikedIds = new Set(plan.days.flatMap((d) => d.items.filter((i) => i.liked === false).map((i) => i.placeId)))
    const { data: pool } = await fetchPlaces({ isActive: true, limit: 50 }).catch(() => ({ data: [] }))
    const replacements = pool.filter((p) => !usedIds.has(p.id))
    let ri = 0
    const newDays = plan.days.map((d) => ({
      ...d,
      items: d.items.map((it) => {
        if (dislikedIds.has(it.placeId) && ri < replacements.length) {
          const rep = replacements[ri++]
          return { placeId: rep.id, time: it.time, liked: null, place: toTripPlace(rep) }
        }
        return { ...it, liked: null }
      })
    }))
    // Client-side reshuffle only, no /trip/llm call -- the judge's rationale
    // describes the AI's original ordering logic, which may no longer hold
    // once places get swapped, so clear it rather than leave stale text.
    setState({ tripPlan: { ...plan, days: newDays }, tripPlanRationale: '', feedbackText: '' })
  }

  // The QR's own content only ever carries an opaque id (see QrTab.jsx's
  // qrValue) -- points/place come back from the backend after claimScan,
  // never trusted from what was scanned.
  const extractQrId = (decodedText) => {
    try {
      const path = new URL(decodedText).pathname
      return path.match(/\/scan\/([^/]+)\/?$/)?.[1] || null
    } catch {
      return null
    }
  }

  // Shared by the in-app camera scan (QrScannerModal, via handleQrDetected)
  // and ScanLandingPage (a physical QR opened in a plain browser/camera app).
  const claimScan = async (qrId) => {
    setState({ scanState: 'processing', scanError: '' })
    // Asked for up front but not required: a place without coordinates never
    // needs it, so a failure only matters if the server then says it does.
    let position = null
    let locationFailure = null
    try {
      position = await getCurrentPosition()
    } catch (err) {
      locationFailure = err.reason
    }
    try {
      const { points, placeName, balance } = await scanQr(qrId, position)
      setState({ scanState: 'success', scanResultPoints: points, scanResultPlace: placeName, userPoints: balance })
    } catch (err) {
      let message = err.message
      if (err.status === 401) {
        // Session ended (expired, or an admin signed this account out): make
        // the UI match instead of leaving the page looking logged in.
        setState({ loggedIn: false, currentUser: null, userName: '', userPoints: 0 })
        message = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'
      } else if (err.status === 422 && locationFailure) message = LOCATION_ERROR_MESSAGE[locationFailure]
      else if (err.status === undefined) message = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'
      setState({ scanState: 'error', scanError: message })
    }
  }

  const startScan = () => {
    if (!stateRef.current.loggedIn) { setState({ scanState: 'needsLogin' }); return }
    setState({ scanState: 'scanning', scanError: '' })
  }
  const handleQrDetected = (decodedText) => {
    const qrId = extractQrId(decodedText)
    if (!qrId) { setState({ scanState: 'error', scanError: 'QR Code นี้ไม่ใช่ QR ของ Dino ขอนแก่น' }); return }
    claimScan(qrId)
  }
  // From QrScannerModal's onError: a real camera/permission failure passes a
  // message, cancelling out (backdrop click, Escape, ×) passes null.
  const handleScanCancelled = (message) => setState({ scanState: message ? 'error' : 'idle', scanError: message || '' })
  const resetScan = () => setState({ scanState: 'idle', scanError: '' })

  const adminLogin = async () => {
    const s = stateRef.current
    if (!s.authForm.email || !s.authForm.password) { setState({ authError: 'กรุณากรอกอีเมลและรหัสผ่าน' }); return }
    setState({ authSubmitting: true, authError: '' })
    try {
      const { user } = await apiLogin(s.authForm.email, s.authForm.password)
      if (user.role !== 'admin') {
        await apiLogout().catch(() => {})
        setState({ authSubmitting: false, authError: 'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ' })
        return
      }
      setState({ authSubmitting: false, adminLoggedIn: true })
      navigate('/admin')
    } catch (err) {
      setState({ authSubmitting: false, authError: err.message })
    }
  }
  const adminLogout = () => {
    apiLogout().catch(() => {})
    setState({ adminLoggedIn: false })
    navigate('/')
  }

  const openCreateForm = (type) => {
    const defaults = {
      place: { name: '', category: 'คาเฟ่', rating: '4.5', reviews: '0', price: '', address: '', lat: '', lng: '', hours: '', phone: '', desc: '', amenities: '', tags: '', hasQR: false, qrPoints: '0', img: '', isActive: true },
      event: { name: '', category: '', dateRange: '', venueName: '', admission: '', organizer: '', suitableFor: '', desc: '', status: 'upcoming', img: '', eventStartDate: '', eventEndDate: '', placeId: '' },
      kb: { title: '', category: 'transport', content: '', isPinned: false, isActive: true },
      qr: { placeId: '', points: '10', isActive: true, expiresAt: '', radiusM: '200' },
      reward: { name: '', cost: '50' }
    }
    setState({ formOpen: true, formType: type, formData: defaults[type], editingId: null })
  }
  const openEditForm = (type, item) => {
    const clone = { ...item }
    if (Array.isArray(clone.amenities)) clone.amenities = clone.amenities.join(', ')
    if (Array.isArray(clone.tags)) clone.tags = clone.tags.join(', ')
    if (Array.isArray(clone.suitableFor)) clone.suitableFor = clone.suitableFor.join(', ')
    // rowToPlace() (backend/src/lib/mappers.js) returns location as
    // {lat,lng} -- flatten it so LocationPicker/PlacesTab's plain lat/lng
    // form fields have something to bind to when editing an existing place.
    if (clone.location) { clone.lat = clone.location.lat; clone.lng = clone.location.lng }
    setState({ formOpen: true, formType: type, formData: clone, editingId: item.id })
  }
  const updateFormField = (f, v) => setState((s) => ({ formData: { ...s.formData, [f]: v } }))
  const cancelForm = () => setState({ formOpen: false, formType: null, formData: {}, editingId: null })

  // camelCase->snake_case payload shaping now happens in the backend
  // (backend/src/lib/mappers.js) -- the frontend just dispatches formData as-is.
  const resourceApi = {
    place: { create: createPlace, update: updatePlace, remove: deletePlace, listKey: 'places' },
    event: { create: createEvent, update: updateEvent, remove: deleteEvent, listKey: 'events' },
    kb: { create: createKnowledgeBase, update: updateKnowledgeBase, remove: deleteKnowledgeBase, listKey: 'knowledgeBase' },
    qr: { create: createQr, update: updateQr, remove: deleteQr, listKey: 'qrs' },
    reward: { create: createReward, update: updateReward, remove: deleteReward, listKey: 'rewards' },
  }

  const saveForm = async () => {
    const { formType, formData, editingId } = stateRef.current
    const { create, update, listKey } = resourceApi[formType]
    const errorLabels = { place: 'บันทึกสถานที่ไม่สำเร็จ: ', event: 'บันทึกอีเวนท์ไม่สำเร็จ: ', kb: 'บันทึกฐานความรู้ไม่สำเร็จ: ', qr: 'บันทึก QR ไม่สำเร็จ: ', reward: 'บันทึกของรางวัลไม่สำเร็จ: ' }

    let item
    try {
      item = editingId ? await update(editingId, formData) : await create(formData)
    } catch (err) {
      if (handleSessionExpired(err)) return
      const reason = err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message
      showToast(errorLabels[formType] + reason, ERROR_TOAST_MS)
      return
    }
    setState((s) => ({ [listKey]: editingId ? s[listKey].map((x) => x.id === editingId ? item : x) : [...s[listKey], item] }))

    const labels = { place: 'บันทึกสถานที่แล้ว', event: 'บันทึกอีเวนท์แล้ว', kb: 'บันทึกฐานความรู้แล้ว', qr: 'บันทึก QR แล้ว', reward: 'บันทึกของรางวัลแล้ว' }
    cancelForm()
    showToast(labels[formType] || 'บันทึกแล้ว')
    return item
  }

  // Merges a single already-saved event into state without a full refetch.
  const applyEventUpdate = (item) => setState((s) => ({
    events: s.events.some((e) => e.id === item.id) ? s.events.map((e) => e.id === item.id ? item : e) : [...s.events, item],
  }))

  const applyQrUpdate = (item) => setState((s) => ({ qrs: s.qrs.map((q) => q.id === item.id ? item : q) }))

  const applyRewardUpdate = (item) => setState((s) => ({
    rewards: s.rewards.some((r) => r.id === item.id) ? s.rewards.map((r) => r.id === item.id ? item : r) : [...s.rewards, item],
  }))

  const deleteItem = async (type, id) => {
    const confirmMessage = type === 'qr'
      ? 'ลบ QR นี้ใช่หรือไม่?\n\nป้าย QR ที่พิมพ์ไปแล้วจะสแกนไม่ได้ และประวัติการสแกนของ QR นี้จะถูกลบด้วย (ถ้าแค่ต้องการหยุดชั่วคราว ให้ใช้ "ปิดใช้งาน" แทน)'
      : 'ยืนยันการลบข้อมูลนี้หรือไม่?'
    if (!window.confirm(confirmMessage)) return
    const { remove, listKey } = resourceApi[type]
    try {
      await remove(id)
    } catch (err) {
      if (handleSessionExpired(err)) return
      showToast('ลบไม่สำเร็จ: ' + (err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message), ERROR_TOAST_MS)
      return
    }
    setState((s) => ({ [listKey]: s[listKey].filter((x) => x.id !== id) }))
  }

  const onNewPlace = () => openCreateForm('place')
  const onNewEvent = () => openCreateForm('event')
  const onNewKb = () => openCreateForm('kb')
  const onNewQr = () => openCreateForm('qr')
  const onNewReward = () => openCreateForm('reward')

  const fieldHandlers = {}
  ;['name', 'category', 'rating', 'reviews', 'price', 'address', 'hours', 'phone', 'desc', 'amenities', 'tags', 'qrPoints', 'dateRange', 'venueName', 'admission', 'organizer', 'suitableFor', 'status', 'title', 'content', 'placeId', 'points', 'cost', 'img'].forEach((f) => {
    fieldHandlers['onField_' + f] = (e) => updateFormField(f, e.target.value)
  })
  ;['hasQR', 'isPinned', 'isActive'].forEach((f) => {
    fieldHandlers['onField_' + f] = (e) => updateFormField(f, e.target.checked)
  })

  const actions = {
    showToast, toggleMobileMenu, closeMobileMenu, closeWelcomeModal, snoozeWelcomeModal, enableNearbyPlaces, welcomeGoTrip, welcomeGoPoints,
    goHome, goPlaces, goEvents, goPublic, goAdminLogin, goTripForm, nextStep, prevStep, goToStep,
    goPoints, goLogin, goSignup, goForgotPassword, openPlace, openEvent, setSearchQuery, onSearchChange, setCategory,
    setEventSearchQuery, onEventSearchChange, toggleFavorite, togglePlaceActive,
    onAuthTitleChange, onAuthFirstNameChange, onAuthLastNameChange, onAuthEmailChange, onAuthPhoneChange, onAuthPasswordChange, onAuthConfirmPasswordChange,
    onAuthGenderChange, onAuthBirthdateChange, onAuthOccupationChange, onAuthProvinceChange, onAuthDistrictChange, onAuthSubdistrictChange,
    selectPersonaAvatarPreset, clearPersonaAvatar, onAuthAvatarFileChange, openAvatarReposition,
    setAvatarCropPosition, setAvatarCropScale, cancelAvatarCrop, confirmAvatarCrop,
    onResetPasswordChange, onResetConfirmPasswordChange,
    onAuthConsentChange, submitLogin, submitSignup, completeEmailConfirmation, submitForgotPassword, submitResetPassword, logout, setCurrentUser, signedOutLocally,
    toggleChat, onChatInputChange, sendChat,
    onStartDateChange, onEndDateChange, onAccommodationLocationChange, onAccommodationSelect, useCurrentLocationForAccommodation, setTripDatePreset,
    onMustGoQueryChange, addMustGo, removeMustGo, onMustGoKeyDown,
    setPace, onDailyStartChange, onDailyEndChange,
    onFeedbackChange, toggleInterest, setBudget, setAreaScope, submitTripForm, loadTrip, setItemLike, regeneratePlan,
    startScan, handleQrDetected, handleScanCancelled, claimScan, resetScan,
    adminLogin, adminLogout, openCreateForm, openEditForm, updateFormField, cancelForm, applyEventUpdate, applyRewardUpdate, applyQrUpdate, handleSessionExpired, reportError, reloadData: loadData,
    saveForm, deleteItem, onNewPlace, onNewEvent, onNewKb, onNewQr, onNewReward,
    ...fieldHandlers,
  }

  // ---- Derived / computed view values (mirrors renderVals()) ----
  const s = state
  const titleOptions = [
    { value: 'mr', label: 'นาย' },
    { value: 'mrs', label: 'นาง' },
    { value: 'miss', label: 'นางสาว' },
  ]
  const genderOptions = [
    { value: 'male', label: 'ชาย' },
    { value: 'female', label: 'หญิง' },
    { value: 'unspecified', label: 'ไม่ระบุ' },
  ]
  const occupationOptions = [
    { value: 'student', label: 'นักเรียน/นักศึกษา' },
    { value: 'government', label: 'ข้าราชการ/รัฐวิสาหกิจ' },
    { value: 'private_employee', label: 'พนักงานบริษัทเอกชน' },
    { value: 'business_owner', label: 'ธุรกิจส่วนตัว/ค้าขาย' },
    { value: 'farmer', label: 'เกษตรกร' },
    { value: 'freelance', label: 'รับจ้างทั่วไป/ฟรีแลนซ์' },
    { value: 'homemaker', label: 'แม่บ้าน/พ่อบ้าน' },
    { value: 'retired', label: 'เกษียณอายุ' },
    { value: 'unemployed', label: 'ว่างงาน' },
    { value: 'other', label: 'อื่นๆ' },
  ]
  // Computed client-side just to show the user their age as they type their
  // birthdate -- the backend stores birthdate itself, not a derived age,
  // since "age" would otherwise silently go stale.
  const computeAge = (birthdate) => {
    if (!birthdate) return null
    const dob = new Date(birthdate)
    if (Number.isNaN(dob.getTime()) || dob > new Date()) return null
    const today = new Date()
    let age = today.getFullYear() - dob.getFullYear()
    const beforeBirthdayThisYear = (today.getMonth() < dob.getMonth()) || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())
    if (beforeBirthdayThisYear) age--
    return age >= 0 ? age : null
  }
  const authBirthdateAge = computeAge(s.authForm.birthdate)
  const provinceOptions = thaiAddress.map((p) => p.name)
  const selectedProvinceData = thaiAddress.find((p) => p.name === s.authForm.province)
  const districtOptions = selectedProvinceData ? selectedProvinceData.districts.map((d) => d.name) : []
  const selectedDistrictData = selectedProvinceData?.districts.find((d) => d.name === s.authForm.district)
  const subdistrictOptions = selectedDistrictData ? selectedDistrictData.subdistricts : []
  const categoriesView = categories.map((c) => ({
    label: c, onClick: () => setCategory(c), icon: categoryIcons[c],
    bg: c === s.activeCategory ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff', color: c === s.activeCategory ? '#fff' : '#1f2a24',
    iconBorder: c === s.activeCategory ? '#fff' : '#2E7D32'
  }))
  const isGrid = (k) => k === 'grid', isCup = (k) => k === 'cup', isTemple = (k) => k === 'temple', isMuseum = (k) => k === 'museum', isTree = (k) => k === 'tree', isMountain = (k) => k === 'mountain', isBasket = (k) => k === 'basket', isCamera = (k) => k === 'camera', isFood = (k) => k === 'food', isBed = (k) => k === 'bed'
  const categoriesViewIcons = categoriesView.map((c) => ({ ...c, showGrid: isGrid(c.icon), showCup: isCup(c.icon), showTemple: isTemple(c.icon), showMuseum: isMuseum(c.icon), showTree: isTree(c.icon), showMountain: isMountain(c.icon), showBasket: isBasket(c.icon), showCamera: isCamera(c.icon), showFood: isFood(c.icon), showBed: isBed(c.icon) }))
  // PlacesListPage/EventsListPage now fetch+filter their own server-paginated
  // page (see usePagedList.js) instead of reading a client-filtered view
  // off the bulk-loaded array -- category chips (categoriesViewIcons above)
  // and search inputs on those pages still read/write state.activeCategory/
  // state.searchQuery/state.eventSearchQuery, just no longer through a
  // derived list here. HomePage's top-4 and PointsPage's QR-places list
  // fetch their own place data too now (see HomePage.jsx/PointsPage.jsx),
  // so placeBadge/qrPlacesList moved out of this file entirely.

  const datePresetOptions = [
    { key: 'today', label: 'วันนี้ (เดย์ทริป)' },
    { key: '2days', label: '2 วัน' },
    { key: '3days', label: '3 วัน' },
    { key: 'weekend', label: 'สุดสัปดาห์นี้' },
  ].map((p) => ({ ...p, onClick: () => setTripDatePreset(p.key) }))

  const mustGoSuggestionsView = s.mustGoSuggestions
    .filter((p) => !s.tripForm.mustGo.includes(p.name))
    .slice(0, 6).map((p) => ({ id: p.id, name: p.name, category: p.category, onClick: () => addMustGo(p.name) }))
  const mustGoChipsView = s.tripForm.mustGo.map((name) => ({ name, onRemove: () => removeMustGo(name) }))

  const interestOptionsView = interestList.map((i) => {
    const active = s.tripForm.interests.includes(i)
    return {
      label: i, onClick: () => toggleInterest(i), letter: i.charAt(0),
      bg: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f', borderColor: active ? '#2E7D32' : '#E7E3D2',
      iconBg: active ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#c8d6cc'
    }
  })
  const budgetOptionsView = budgetList.map((b) => {
    const active = b === s.tripForm.budget
    return {
      label: b, onClick: () => setBudget(b), desc: budgetMeta[b],
      bg: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f', descColor: active ? '#2E7D32' : '#626863', borderColor: active ? '#2E7D32' : '#E7E3D2',
      dotBg: active ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff'
    }
  })
  const areaScopeOptionsView = areaScopeList.map((a) => {
    const active = a === s.tripForm.areaScope
    return {
      label: a, onClick: () => setAreaScope(a), desc: areaScopeMeta[a],
      bg: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f', descColor: active ? '#2E7D32' : '#626863', borderColor: active ? '#2E7D32' : '#E7E3D2',
      dotBg: active ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff'
    }
  })
  const paceList = [
    { key: 'relaxed', label: 'สายชิลล์', desc: 'เที่ยวน้อยจุด เน้นพักผ่อน มีเวลาว่างระหว่างวัน' },
    { key: 'standard', label: 'กำลังดี', desc: 'สมดุลระหว่างจำนวนที่เที่ยวกับเวลาพัก' },
    { key: 'packed', label: 'สายลุย', desc: 'อัดแน่นทุกช่วงเวลา เที่ยวให้ได้มากที่สุด' },
  ]
  const paceOptionsView = paceList.map((p) => {
    const active = p.key === s.tripForm.pace
    return {
      label: p.label, desc: p.desc, onClick: () => setPace(p.key),
      bg: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f', descColor: active ? '#2E7D32' : '#626863', borderColor: active ? '#2E7D32' : '#E7E3D2',
      dotBg: active ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff'
    }
  })
  // For TripResultPage's "เงื่อนไขที่เลือกไว้" recap -- a plain readback of
  // what the user picked in the form (not to be confused with
  // tripPlanRationale, the LLM's own explanation for its place choices).
  // budget/areaScope are already stored as their own Thai display strings
  // (see budgetList/areaScopeList), only pace needs the key->label lookup.
  const tripFormSummaryView = {
    dateRangeLabel: s.tripForm.startDate === s.tripForm.endDate ? s.tripForm.startDate : `${s.tripForm.startDate} - ${s.tripForm.endDate}`,
    interests: s.tripForm.interests,
    budget: s.tripForm.budget,
    areaScope: s.tripForm.areaScope,
    paceLabel: paceList.find((p) => p.key === s.tripForm.pace)?.label || s.tripForm.pace,
    accommodationLabel: s.tripForm.accommodation?.name || null,
    mustGo: s.tripForm.mustGo,
    dailyStart: s.tripForm.dailyStart,
    dailyEnd: s.tripForm.dailyEnd,
  }

  const tripPlan = s.tripPlan ? {
    ...s.tripPlan,
    days: s.tripPlan.days.map((d) => ({
      ...d,
      items: d.items.map((it) => {
        const place = it.place || { name: '-', rating: '-', address: '-' }
        const isHotelReturn = it.status === 'End of Day (Return to Hotel)'
        const durationMin = (!isHotelReturn && it.time && it.departureTime)
          ? (hhmmToMinutes(it.departureTime) ?? 0) - (hhmmToMinutes(it.time) ?? 0)
          : null
        return {
          ...it, place,
          timeRangeLabel: (it.departureTime && it.departureTime !== it.time) ? `${it.time} - ${it.departureTime}` : it.time,
          durationLabel: isHotelReturn ? 'ถึงที่พัก' : (formatDurationMinutes(durationMin) ? `อยู่ประมาณ ${formatDurationMinutes(durationMin)}` : null),
          onLike: () => setItemLike(d.dayNum, it.placeId, true),
          onDislike: () => setItemLike(d.dayNum, it.placeId, false),
          likeBg: it.liked === true ? '#E8F5E9' : '#fff', likeColor: it.liked === true ? '#2E7D32' : '#5f6a63', likeBorder: it.liked === true ? '#2E7D32' : '#DCD8C6',
          dislikeBg: it.liked === false ? '#fdecec' : '#fff', dislikeColor: it.liked === false ? '#a33232' : '#5f6a63', dislikeBorder: it.liked === false ? '#a33232' : '#DCD8C6'
        }
      })
    }))
  } : { days: [], totalBudget: 0, totalDistance: 0, totalPoints: 0 }

  // Redeeming happens at the counter (an admin deducts the points), so the
  // tourist-facing view only needs to say whether a reward is within reach.
  const rewardsView = s.rewards.map((r) => {
    const soldOut = r.stock === 0
    const shortBy = Math.max(0, r.cost - s.userPoints)
    return { ...r, soldOut, shortBy, status: soldOut ? 'soldOut' : shortBy > 0 ? 'needMore' : 'ready' }
  })
  // Admin tabs for places/events/knowledgeBase/rewards now fetch their own
  // server-paginated page (see usePagedList.js) instead of reading a
  // pre-built admin view off the bulk-loaded array -- only qrs stays here,
  // since its admin list has no DB column to paginate/search "by place name"
  // against server-side. `placeName` isn't joined here anymore (no bulk
  // `s.places` to join against) -- QrTab.jsx joins it itself against a
  // fetchPlaceNames() id->name map instead.
  const qrsView = s.qrs.map((q) => ({ ...q, onEdit: () => openEditForm('qr', q), onDelete: () => deleteItem('qr', q.id) }))

  const stepMeta = [0, 1, 2, 3].map((i) => {
    const done = i < s.tripStep
    const active = i === s.tripStep
    return {
      n: i + 1,
      label: ['วันเดินทาง', 'ความสนใจ', 'งบประมาณ', 'ช่วงเวลา'][i],
      done, active,
      circleBg: done ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff',
      circleColor: done ? '#fff' : (active ? '#2E7D32' : '#b7c2ba'),
      circleBorder: done ? '#2E7D32' : (active ? '#2E7D32' : '#DCD8C6'),
      labelColor: done || active ? '#1B5E20' : '#a9b3ac',
      labelWeight: active ? '800' : '600',
      onClick: () => goToStep(i)
    }
  })

  const derived = {
    // HomePage computes its own top-4 "recommended places" locally now
    // (fetches + distance re-ranks itself) -- no bulk `state.places` array
    // here to derive it from anymore.
    homeEvents: s.events.slice(0, 3).map((e) => ({ ...e, onOpen: () => openEvent(e.id) })),
    stepMeta,
    isPlaceFormOpen: s.formOpen && s.formType === 'place',
    isEventFormOpen: s.formOpen && s.formType === 'event',
    isKbFormOpen: s.formOpen && s.formType === 'kb',
    isQrFormOpen: s.formOpen && s.formType === 'qr',
    isRewardFormOpen: s.formOpen && s.formType === 'reward',
    isScanning: s.scanState === 'scanning',
    isScanProcessing: s.scanState === 'processing',
    isScanSuccess: s.scanState === 'success',
    isScanError: s.scanState === 'error',
    scanNeedsLogin: s.scanState === 'needsLogin',
    notLoggedIn: !s.loggedIn,
    titleOptions, genderOptions, occupationOptions, authBirthdateAge, provinceOptions, districtOptions, subdistrictOptions,
    personaAvatarOptions: PERSONA_AVATARS,
    passwordRules: PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, met: r.test(s.authForm.password) })),
    passwordsMatch: s.authForm.confirmPassword.length > 0 && s.authForm.password === s.authForm.confirmPassword,
    resetPasswordRules: PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, met: r.test(s.resetForm.password) })),
    resetPasswordsMatch: s.resetForm.confirmPassword.length > 0 && s.resetForm.password === s.resetForm.confirmPassword,
    categoriesView, categoriesViewIcons,
    chatMessagesView: s.chatMessages.map((m) => ({ ...m, align: m.from === 'user' ? 'flex-end' : 'flex-start', bg: m.from === 'user' ? '#2E7D32' : '#f0efe7', color: m.from === 'user' ? '#fff' : '#1f2a24' })),
    interestOptionsView, budgetOptionsView, areaScopeOptionsView, paceOptionsView, datePresetOptions, mustGoSuggestionsView, mustGoChipsView, tripFormSummaryView,
    isStep0: s.tripStep === 0, isStep1: s.tripStep === 1, isStep2: s.tripStep === 2, isStep3: s.tripStep === 3,
    primaryLabel: s.tripStep === 3 ? 'สร้างแผนการเดินทาง →' : 'ถัดไป →',
    onPrimaryStep: s.tripStep === 3 ? submitTripForm : nextStep,
    prevOpacity: s.tripStep === 0 ? '0.35' : '1',
    tripPlan,
    rewardsView, qrsView,
    placeCategoryOptions: categories.filter((c) => c !== 'ทั้งหมด'),
  }

  const value = { state, actions, derived }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
