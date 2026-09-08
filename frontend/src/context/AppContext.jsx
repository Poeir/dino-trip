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
  fetchPointsBalance, scanQr, redeemReward as apiRedeemReward,
} from '../lib/apiClient.js'
import { sendChatMessage, requestTripPlan } from '../lib/chatbotService.js'
import { haversineKm } from '../utils/geo.js'

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
  tripForm: { startDate: '', endDate: '', interests: [], budget: 'ปานกลาง', areaScope: 'ทั่วขอนแก่น', accommodation: '', mustGo: [], pace: 'standard', dailyStart: '09:00', dailyEnd: '18:00' },
  mustGoQuery: '',
  tripFormError: '',
  tripStep: 0,
  tripPlanning: false,
  tripPlan: null,
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
  places: [],
  events: [],
  knowledgeBase: [],
  rewards: [],
  qrs: [],
  adminLoggedIn: false,
  formOpen: false,
  formType: null,
  formData: {},
  editingId: null,
  mobileMenuOpen: false,
  welcomeModalOpen: true,
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

  const showToast = (msg) => {
    setState({ toastMsg: msg })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setState({ toastMsg: '' }), 2400)
  }

  useEffect(() => {
    async function loadData() {
      try {
        const [places, events, knowledgeBase, rewards, qrs] = await Promise.all([
          fetchPlaces(), fetchEvents(), fetchKnowledgeBase(), fetchRewards(), fetchQrs(),
        ])
        setState({ places, events, knowledgeBase, rewards, qrs })
      } catch (err) {
        console.error('Failed to load data from API:', err)
        showToast('โหลดข้อมูลไม่สำเร็จ ตรวจสอบการเชื่อมต่อ API')
      }
    }
    loadData()

    // Best-effort: ranking falls back to rating-only if the user denies/ignores
    // the permission prompt or the browser has no geolocation support.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setState({ userLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
        () => {},
        { timeout: 8000, maximumAge: 300000 }
      )
    }
  }, [])

  // Hydrates loggedIn/userName from the backend's httpOnly session cookie
  // on load, so a page refresh doesn't drop the session (GET /api/auth/me
  // also transparently refreshes an expired access token server-side --
  // see auth.routes.js).
  useEffect(() => {
    fetchMe()
      .then(({ user }) => {
        setState({ loggedIn: !!user, userName: user?.displayName || '', authChecked: true, adminLoggedIn: user?.role === 'admin' })
        if (user) fetchPointsBalance().then(({ balance }) => setState({ userPoints: balance })).catch(() => {})
      })
      .catch(() => setState({ authChecked: true }))
  }, [])

  const toggleMobileMenu = () => setState((s) => ({ mobileMenuOpen: !s.mobileMenuOpen }))
  const closeMobileMenu = () => setState({ mobileMenuOpen: false })
  const closeWelcomeModal = () => setState({ welcomeModalOpen: false })
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
  // Session-only: the backend has no is_active column for places yet, so this
  // hides/shows a place on the public site for the current session only and
  // resets on reload. See placePayload() in backend/src/lib/mappers.js.
  const togglePlaceActive = (id) => setState((s) => ({
    places: s.places.map((p) => p.id === id ? { ...p, isActive: p.isActive === false ? true : false } : p)
  }))

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
      setState({ authSubmitting: false, loggedIn: true, userName: user.displayName })
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
      setState({ authSubmitting: false, loggedIn: true, userName: result.user.displayName })
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
    setState({ loggedIn: true, userName: user.displayName, authChecked: true })
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
      setState({ authSubmitting: false, loggedIn: true, userName: user.displayName })
      fetchPointsBalance().then(({ balance }) => setState({ userPoints: balance })).catch(() => {})
      redirectAfterAuth()
    } catch (err) {
      setState({ authSubmitting: false, authError: err.message })
    }
  }
  const logout = async () => {
    await apiLogout().catch(() => {})
    setState({ loggedIn: false, userName: '' })
    navigate('/')
  }

  const toggleChat = () => setState((s) => ({ chatOpen: !s.chatOpen }))
  const setChatInput = (v) => setState({ chatInput: v })
  const onChatInputChange = (e) => setChatInput(e.target.value)
  const sendChat = async (overrideText) => {
    const text = (overrideText ?? stateRef.current.chatInput).trim()
    if (!text) return
    // Push the user message plus an empty bot placeholder that fills in as
    // tokens stream in -- always the last message in the array while streaming.
    setState((s) => ({ chatMessages: [...s.chatMessages, { from: 'user', text }, { from: 'bot', text: '', places: [] }], chatInput: '', chatTyping: true }))
    const appendToLastBotMessage = (patch) => setState((s) => {
      const msgs = s.chatMessages.slice()
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...patch(msgs[msgs.length - 1]) }
      return { chatMessages: msgs }
    })
    try {
      const { places } = await sendChatMessage(text, {
        onToken: (token) => {
          setState({ chatTyping: false })
          appendToLastBotMessage((last) => ({ text: last.text + token }))
        },
      })
      appendToLastBotMessage(() => ({ places }))
      setState({ chatTyping: false })
    } catch (err) {
      console.error('Chat request failed:', err)
      appendToLastBotMessage(() => ({ text: 'ขออภัยครับ ระบบแชทขัดข้องชั่วคราว ลองใหม่อีกครั้งนะครับ', places: [] }))
      setState({ chatTyping: false })
    }
  }

  const updateTripField = (f, v) => setState((s) => ({ tripForm: { ...s.tripForm, [f]: v }, tripFormError: '' }))
  const onStartDateChange = (e) => updateTripField('startDate', e.target.value)
  const onEndDateChange = (e) => updateTripField('endDate', e.target.value)
  const onAccommodationChange = (e) => updateTripField('accommodation', e.target.value)
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
  // don't need to know where the plan came from.
  const tripResponseToPlan = (resp, startDate) => {
    const baseTime = startDate && !Number.isNaN(new Date(startDate).getTime()) ? new Date(startDate).getTime() : Date.now()
    const days = resp.itinerary.map((day) => {
      const dateObj = new Date(baseTime + (day.day - 1) * 86400000)
      return {
        dayNum: day.day,
        date: dateObj.toISOString().slice(0, 10),
        items: day.schedule.map((slot) => ({
          placeId: slot.place.id,
          time: slot.arrival_time,
          departureTime: slot.departure_time,
          status: slot.status,
          liked: null,
          distanceFromPrev: slot.distance_km || null,
          place: {
            id: slot.place.id, name: slot.place.name, category: slot.place.category, rating: slot.place.rating, address: slot.place.address, img: slot.place.img,
            location: (slot.place.lat != null && slot.place.lng != null) ? { lat: slot.place.lat, lng: slot.place.lng } : null,
          },
        })),
      }
    })
    const flatItems = days.flatMap((d) => d.items)
    const totalPoints = flatItems.reduce((sum, it) => {
      const p = stateRef.current.places.find((pp) => pp.id === it.placeId)
      return sum + (p && p.hasQR ? p.qrPoints : 0)
    }, 0)
    return { days, totalBudget: resp.total_cost_estimate, totalDistance: resp.total_distance_km, totalPoints }
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
      const resp = await requestTripPlan({
        trip_duration_days: days,
        start_date: f.startDate,
        accommodation_name: f.accommodation,
        must_go: f.mustGo,
        interests: f.interests,
        trip_pace: f.pace,
        budget_level: f.budget,
        area_scope: f.areaScope,
        start_time: f.dailyStart,
        end_time: f.dailyEnd,
      })
      if (!resp.itinerary || resp.itinerary.length === 0) {
        setState({ tripPlanning: false, tripFormError: resp.note || 'ไม่พบสถานที่ที่ตรงกับเงื่อนไข ลองปรับความสนใจหรืองบประมาณดูนะครับ' })
        return
      }
      setState({ tripPlan: tripResponseToPlan(resp, f.startDate), tripPlanNote: resp.note, tripPlanRationale: resp.planning_rationale || '', tripPlanning: false, feedbackText: '' })
      navigate('/trip/result')
    } catch (err) {
      console.error('Trip plan request failed:', err)
      setState({ tripPlanning: false, tripFormError: 'สร้างแผนทริปไม่สำเร็จ ลองอีกครั้งนะครับ' })
    }
  }

  const setItemLike = (dayNum, placeId, val) => {
    setState((s) => ({
      tripPlan: {
        ...s.tripPlan,
        days: s.tripPlan.days.map((d) => d.dayNum !== dayNum ? d : { ...d, items: d.items.map((it) => it.placeId !== placeId ? it : { ...it, liked: it.liked === val ? null : val }) })
      }
    }))
  }

  const swapItem = (dayNum, placeId) => {
    const s = stateRef.current
    const plan = s.tripPlan
    const usedIds = new Set(plan.days.flatMap((d) => d.items.map((i) => i.placeId)))
    const current = plan.days.flatMap((d) => d.items).find((i) => i.placeId === placeId)
    const currentCategory = current && current.place && current.place.category
    const sameCategory = s.places.filter((p) => !usedIds.has(p.id) && p.category === currentCategory)
    const pool = sameCategory.length ? sameCategory : s.places.filter((p) => !usedIds.has(p.id))
    if (!pool.length) { showToast('ไม่มีสถานที่อื่นให้สลับแล้วครับ'); return }
    const replacement = pool[Math.floor(Math.random() * pool.length)]
    setState((s2) => ({
      tripPlan: {
        ...s2.tripPlan,
        days: s2.tripPlan.days.map((d) => d.dayNum !== dayNum ? d : {
          ...d,
          items: d.items.map((it) => it.placeId !== placeId ? it : { placeId: replacement.id, time: it.time, liked: null })
        })
      }
    }))
  }

  const regeneratePlan = () => {
    const s = stateRef.current
    const plan = s.tripPlan
    const all = s.places
    const usedIds = new Set(plan.days.flatMap((d) => d.items.map((i) => i.placeId)))
    const dislikedIds = new Set(plan.days.flatMap((d) => d.items.filter((i) => i.liked === false).map((i) => i.placeId)))
    const replacements = all.filter((p) => !usedIds.has(p.id))
    let ri = 0
    const newDays = plan.days.map((d) => ({
      ...d,
      items: d.items.map((it) => {
        if (dislikedIds.has(it.placeId) && ri < replacements.length) {
          const rep = replacements[ri++]
          return { placeId: rep.id, time: it.time, liked: null }
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
    try {
      const { points, placeName, balance } = await scanQr(qrId)
      setState({ scanState: 'success', scanResultPoints: points, scanResultPlace: placeName, userPoints: balance })
    } catch (err) {
      setState({ scanState: 'error', scanError: err.message })
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
  const redeemReward = async (id) => {
    const s = stateRef.current
    const reward = s.rewards.find((r) => r.id === id)
    if (!reward || s.userPoints < reward.cost) return
    try {
      const { balance } = await apiRedeemReward(id)
      setState({ userPoints: balance })
      showToast(`แลก "${reward.name}" สำเร็จ`)
    } catch (err) {
      showToast('แลกของรางวัลไม่สำเร็จ: ' + err.message)
    }
  }

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
      place: { name: '', category: 'คาเฟ่', rating: '4.5', reviews: '0', price: '', address: '', hours: '', phone: '', desc: '', amenities: '', tags: '', hasQR: false, qrPoints: '0', img: '', isActive: true },
      event: { name: '', category: '', dateRange: '', venueName: '', admission: '', organizer: '', suitableFor: '', desc: '', status: 'upcoming', img: '' },
      kb: { title: '', category: 'transport', content: '', isPinned: false, isActive: true },
      qr: { placeId: '', points: '10' },
      reward: { name: '', cost: '50' }
    }
    setState({ formOpen: true, formType: type, formData: defaults[type], editingId: null })
  }
  const openEditForm = (type, item) => {
    const clone = { ...item }
    if (Array.isArray(clone.amenities)) clone.amenities = clone.amenities.join(', ')
    if (Array.isArray(clone.tags)) clone.tags = clone.tags.join(', ')
    if (Array.isArray(clone.suitableFor)) clone.suitableFor = clone.suitableFor.join(', ')
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
    const errorLabels = { place: 'บันทึกสถานที่ไม่สำเร็จ: ', event: 'บันทึกอีเวนท์ไม่สำเร็จ: ', kb: 'บันทึกฐานความรู้ไม่สำเร็จ: ', qr: 'สร้าง QR ไม่สำเร็จ: ', reward: 'บันทึกของรางวัลไม่สำเร็จ: ' }

    let item
    try {
      item = editingId ? await update(editingId, formData) : await create(formData)
    } catch (err) {
      showToast(errorLabels[formType] + err.message)
      return
    }
    setState((s) => ({ [listKey]: editingId ? s[listKey].map((x) => x.id === editingId ? item : x) : [...s[listKey], item] }))

    const labels = { place: 'บันทึกสถานที่แล้ว', event: 'บันทึกอีเวนท์แล้ว', kb: 'บันทึกฐานความรู้แล้ว', qr: 'สร้าง QR แล้ว', reward: 'บันทึกของรางวัลแล้ว' }
    cancelForm()
    showToast(labels[formType] || 'บันทึกแล้ว')
  }

  const deleteItem = async (type, id) => {
    if (!window.confirm('ยืนยันการลบข้อมูลนี้หรือไม่?')) return
    const { remove, listKey } = resourceApi[type]
    try {
      await remove(id)
    } catch (err) {
      showToast('ลบไม่สำเร็จ: ' + err.message)
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
    showToast, toggleMobileMenu, closeMobileMenu, closeWelcomeModal, welcomeGoTrip, welcomeGoPoints,
    goHome, goPlaces, goEvents, goPublic, goAdminLogin, goTripForm, nextStep, prevStep, goToStep,
    goPoints, goLogin, goSignup, goForgotPassword, openPlace, openEvent, setSearchQuery, onSearchChange, setCategory,
    setEventSearchQuery, onEventSearchChange, toggleFavorite, togglePlaceActive,
    onAuthTitleChange, onAuthFirstNameChange, onAuthLastNameChange, onAuthEmailChange, onAuthPhoneChange, onAuthPasswordChange, onAuthConfirmPasswordChange,
    onAuthGenderChange, onAuthBirthdateChange, onAuthOccupationChange, onAuthProvinceChange, onAuthDistrictChange, onAuthSubdistrictChange,
    selectPersonaAvatarPreset, clearPersonaAvatar, onAuthAvatarFileChange, openAvatarReposition,
    setAvatarCropPosition, setAvatarCropScale, cancelAvatarCrop, confirmAvatarCrop,
    onResetPasswordChange, onResetConfirmPasswordChange,
    onAuthConsentChange, submitLogin, submitSignup, completeEmailConfirmation, submitForgotPassword, submitResetPassword, logout,
    toggleChat, onChatInputChange, sendChat,
    onStartDateChange, onEndDateChange, onAccommodationChange, setTripDatePreset,
    onMustGoQueryChange, addMustGo, removeMustGo, onMustGoKeyDown,
    setPace, onDailyStartChange, onDailyEndChange,
    onFeedbackChange, toggleInterest, setBudget, setAreaScope, submitTripForm, setItemLike, swapItem, regeneratePlan,
    startScan, handleQrDetected, handleScanCancelled, claimScan, resetScan, redeemReward,
    adminLogin, adminLogout, openCreateForm, openEditForm, updateFormField, cancelForm,
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
  const placeBadge = (p) => p.reviews >= 1500 ? { label: 'ยอดนิยม', bg: '#FDEEE3', color: '#E07B39' } : { label: '', bg: '', color: '' }
  const filteredPlaces = s.places.filter((p) => {
    const activeOk = p.isActive !== false
    const catOk = s.activeCategory === 'ทั้งหมด' || p.category === s.activeCategory
    const q = s.searchQuery.trim().toLowerCase()
    const qOk = !q || p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)
    return activeOk && catOk && qOk
  }).map((p) => ({ ...p, onOpen: () => openPlace(p.id), badge: placeBadge(p), isFavorite: s.favoriteIds.includes(p.id), onToggleFavorite: () => toggleFavorite(p.id) }))

  const eventsView = s.events.filter((e) => {
    const q = s.eventSearchQuery.trim().toLowerCase()
    return !q || e.name.toLowerCase().includes(q) || (e.desc || '').toLowerCase().includes(q)
  }).map((e) => ({ ...e, onOpen: () => openEvent(e.id) }))
  const qrPlacesList = s.places.filter((p) => p.hasQR).map((p) => ({ ...p, onOpen: () => openPlace(p.id) }))

  const datePresetOptions = [
    { key: 'today', label: 'วันนี้ (เดย์ทริป)' },
    { key: '2days', label: '2 วัน' },
    { key: '3days', label: '3 วัน' },
    { key: 'weekend', label: 'สุดสัปดาห์นี้' },
  ].map((p) => ({ ...p, onClick: () => setTripDatePreset(p.key) }))

  const mustGoQueryTrim = s.mustGoQuery.trim().toLowerCase()
  const mustGoSuggestionsView = mustGoQueryTrim
    ? s.places.filter((p) => p.name.toLowerCase().includes(mustGoQueryTrim) && !s.tripForm.mustGo.includes(p.name))
      .slice(0, 6).map((p) => ({ id: p.id, name: p.name, category: p.category, onClick: () => addMustGo(p.name) }))
    : []
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
      bg: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f', descColor: active ? '#2E7D32' : '#8a938c', borderColor: active ? '#2E7D32' : '#E7E3D2',
      dotBg: active ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff'
    }
  })
  const areaScopeOptionsView = areaScopeList.map((a) => {
    const active = a === s.tripForm.areaScope
    return {
      label: a, onClick: () => setAreaScope(a), desc: areaScopeMeta[a],
      bg: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f', descColor: active ? '#2E7D32' : '#8a938c', borderColor: active ? '#2E7D32' : '#E7E3D2',
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
      bg: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f', descColor: active ? '#2E7D32' : '#8a938c', borderColor: active ? '#2E7D32' : '#E7E3D2',
      dotBg: active ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff'
    }
  })

  const tripPlan = s.tripPlan ? {
    ...s.tripPlan,
    days: s.tripPlan.days.map((d) => ({
      ...d,
      items: d.items.map((it) => {
        const place = it.place || s.places.find((p) => p.id === it.placeId) || { name: '-', rating: '-', address: '-' }
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
          onSwap: () => swapItem(d.dayNum, it.placeId),
          likeBg: it.liked === true ? '#E8F5E9' : '#fff', likeColor: it.liked === true ? '#2E7D32' : '#6d7a72', likeBorder: it.liked === true ? '#2E7D32' : '#DCD8C6',
          dislikeBg: it.liked === false ? '#fdecec' : '#fff', dislikeColor: it.liked === false ? '#a33232' : '#6d7a72', dislikeBorder: it.liked === false ? '#a33232' : '#DCD8C6'
        }
      })
    }))
  } : { days: [], totalBudget: 0, totalDistance: 0, totalPoints: 0 }

  const rewardsView = s.rewards.map((r) => {
    const canRedeem = s.userPoints >= r.cost
    return { ...r, onRedeem: () => redeemReward(r.id), disabled: !canRedeem, btnBg: canRedeem ? '#2E7D32' : '#eee', btnColor: canRedeem ? '#fff' : '#999' }
  })
  const rewardsAdminView = s.rewards.map((r) => ({ ...r, onEdit: () => openEditForm('reward', r), onDelete: () => deleteItem('reward', r.id) }))
  const placesView = s.places.map((p) => ({ ...p, isActive: p.isActive !== false, onToggleActive: () => togglePlaceActive(p.id), onEdit: () => openEditForm('place', p), onDelete: () => deleteItem('place', p.id) }))
  const eventsAdminView = s.events.map((e) => ({ ...e, onEdit: () => openEditForm('event', e), onDelete: () => deleteItem('event', e.id) }))
  const kbView = s.knowledgeBase.map((k) => ({ ...k, statusLabel: (k.isPinned ? '📌 Pinned · ' : '') + (k.isActive ? 'Active' : 'Inactive'), onEdit: () => openEditForm('kb', k), onDelete: () => deleteItem('kb', k.id) }))
  const qrsView = s.qrs.map((q) => ({ ...q, placeName: (s.places.find((p) => p.id === q.placeId) || {}).name || '-', onEdit: () => openEditForm('qr', q), onDelete: () => deleteItem('qr', q.id) }))

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

  // `places` already arrives rating-ranked from the API. When we know the user's
  // location, re-rank the top of that list (a quality floor) by distance instead
  // of showing the single best-rated places regardless of how far away they are.
  const NEARBY_QUALITY_POOL = 20
  const activePlaces = s.places.filter((p) => p.isActive !== false)
  const homePlacesRanked = s.userLocation
    ? activePlaces
        .slice(0, NEARBY_QUALITY_POOL)
        .map((p) => ({ ...p, distanceKm: p.location ? haversineKm(s.userLocation, p.location) : null }))
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    : activePlaces

  const derived = {
    homePlaces: homePlacesRanked.slice(0, 4).map((p) => ({ ...p, onOpen: () => openPlace(p.id), badge: placeBadge(p), isFavorite: s.favoriteIds.includes(p.id), onToggleFavorite: () => toggleFavorite(p.id) })),
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
    categoriesView, categoriesViewIcons, filteredPlaces, placesEmpty: filteredPlaces.length === 0, eventsView,
    qrPlacesList,
    chatMessagesView: s.chatMessages.map((m) => ({ ...m, align: m.from === 'user' ? 'flex-end' : 'flex-start', bg: m.from === 'user' ? '#2E7D32' : '#f0efe7', color: m.from === 'user' ? '#fff' : '#1f2a24' })),
    interestOptionsView, budgetOptionsView, areaScopeOptionsView, paceOptionsView, datePresetOptions, mustGoSuggestionsView, mustGoChipsView,
    isStep0: s.tripStep === 0, isStep1: s.tripStep === 1, isStep2: s.tripStep === 2, isStep3: s.tripStep === 3,
    primaryLabel: s.tripStep === 3 ? 'สร้างแผนการเดินทาง →' : 'ถัดไป →',
    onPrimaryStep: s.tripStep === 3 ? submitTripForm : nextStep,
    prevOpacity: s.tripStep === 0 ? '0.35' : '1',
    tripPlan,
    rewardsView, rewardsAdminView,
    placesView, eventsAdminView, kbView, qrsView,
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
