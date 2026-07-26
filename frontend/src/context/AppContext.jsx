import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  categories, categoryIcons, interestList, budgetList, budgetMeta, adminTabs
} from '../data/seed.js'
import { supabase } from '../lib/supabaseClient.js'
import { sendChatMessage, requestTripPlan } from '../lib/chatbotService.js'

const AppContext = createContext(null)

const initialState = {
  mode: 'public',
  view: 'home',
  selectedPlaceId: null,
  selectedEventId: null,
  searchQuery: '',
  activeCategory: 'ทั้งหมด',
  loggedIn: false,
  userName: '',
  userPoints: 140,
  authForm: { name: '', email: '', password: '' },
  authError: '',
  chatOpen: false,
  chatInput: '',
  chatTyping: false,
  chatMessages: [
    { from: 'bot', text: 'สวัสดีครับ! ผมน้องไดโน ผู้ช่วยนำเที่ยวขอนแก่น สอบถามเรื่องสถานที่ อาหาร หรือเทศกาลได้เลยครับ' }
  ],
  tripForm: { startDate: '', endDate: '', interests: [], budget: 'ปานกลาง', accommodation: '', mustGo: '', pace: 'standard', dailyStart: '09:00', dailyEnd: '18:00' },
  tripFormError: '',
  tripStep: 0,
  tripPlanning: false,
  tripPlan: null,
  tripPlanNote: '',
  feedbackText: '',
  scanState: 'idle',
  scanResultPoints: 0,
  scanResultPlace: '',
  // Populated from Supabase on mount (see loadData below) instead of static seed data.
  places: [],
  events: [],
  knowledgeBase: [],
  rewards: [],
  qrs: [],
  adminLoggedIn: false,
  adminTab: 'dashboard',
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
function validateTripDates(f) {
  if (!f.startDate || !f.endDate) return ''
  const start = new Date(f.startDate), end = new Date(f.endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ''
  if (end < start) return 'วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น'
  const days = Math.round((end - start) / 86400000) + 1
  if (days > 7) return 'ระยะเวลาทริปต้องไม่เกิน 7 วัน'
  return ''
}

// DB rows use snake_case; the rest of the app (components/derived logic) was
// built around the camelCase shape from the old seed.js, so map on the way in...
function rowToPlace(row) {
  return {
    id: row.id,
    source: row.source,
    googlePlaceId: row.google_place_id,
    name: row.name,
    category: row.category,
    rating: row.rating,
    reviews: row.review_count,
    price: row.price,
    address: row.address,
    hours: row.hours,
    phone: row.phone,
    website: row.website,
    mapsUrl: row.maps_url,
    desc: row.description,
    amenities: row.amenities || [],
    tags: row.tags || [],
    hasQR: row.has_qr,
    qrPoints: row.qr_points,
    reviewsList: row.reviews || [],
    location: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null,
    img: row.img,
  }
}
function rowToEvent(row) {
  return {
    id: row.id, name: row.name, category: row.category, dateRange: row.date_range, venueName: row.venue_name,
    admission: row.admission, organizer: row.organizer, suitableFor: row.suitable_for || [], desc: row.description,
    status: row.status, img: row.img,
  }
}
function rowToKb(row) {
  return { id: row.id, title: row.title, category: row.category, content: row.content, isPinned: row.is_pinned, isActive: row.is_active }
}
function rowToQr(row) {
  return { id: row.id, placeId: row.place_id, points: row.points }
}

export function AppProvider({ children }) {
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
      const [placesRes, eventsRes, kbRes, rewardsRes, qrsRes] = await Promise.all([
        supabase.from('places').select('*').order('name'),
        supabase.from('events').select('*').order('created_at'),
        supabase.from('knowledge_base').select('*').order('created_at'),
        supabase.from('rewards').select('*').order('cost'),
        supabase.from('qrs').select('*'),
      ])
      const firstError = [placesRes, eventsRes, kbRes, rewardsRes, qrsRes].find((r) => r.error)
      if (firstError) {
        console.error('Failed to load data from Supabase:', firstError.error)
        showToast('โหลดข้อมูลไม่สำเร็จ ตรวจสอบการเชื่อมต่อ Supabase')
        return
      }
      setState({
        places: placesRes.data.map(rowToPlace),
        events: eventsRes.data.map(rowToEvent),
        knowledgeBase: kbRes.data.map(rowToKb),
        rewards: rewardsRes.data,
        qrs: qrsRes.data.map(rowToQr),
      })
    }
    loadData()
  }, [])

  const toggleMobileMenu = () => setState((s) => ({ mobileMenuOpen: !s.mobileMenuOpen }))
  const closeMobileMenu = () => setState({ mobileMenuOpen: false })
  const closeWelcomeModal = () => setState({ welcomeModalOpen: false })
  const welcomeGoTrip = () => setState({ welcomeModalOpen: false, view: 'tripForm', tripStep: 0 })
  const welcomeGoPoints = () => setState({ welcomeModalOpen: false, view: 'points' })

  const goHome = () => setState({ view: 'home' })
  const goPlaces = () => setState({ view: 'placesList', mobileMenuOpen: false })
  const goEvents = () => setState({ view: 'eventsList', mobileMenuOpen: false })
  const goPublic = () => setState({ mode: 'public', view: 'home' })
  const goAdminLogin = () => setState({ mode: 'admin', view: 'adminLogin' })
  const goTripForm = () => setState({ view: 'tripForm', tripStep: 0, tripFormError: '' })
  const nextStep = () => {
    if (stateRef.current.tripStep === 0) {
      const err = validateTripDates(stateRef.current.tripForm)
      if (err) { setState({ tripFormError: err }); return }
    }
    setState((s) => ({ tripStep: Math.min(3, s.tripStep + 1), tripFormError: '' }))
  }
  const prevStep = () => setState((s) => ({ tripStep: Math.max(0, s.tripStep - 1), tripFormError: '' }))
  const goToStep = (i) => { if (i < stateRef.current.tripStep) setState({ tripStep: i, tripFormError: '' }) }
  const goPoints = () => setState({ view: 'points' })
  const goLogin = () => setState({ view: 'login', authError: '' })
  const goSignup = () => setState({ view: 'signup', authError: '' })
  const openPlace = (id) => setState({ view: 'placeDetail', selectedPlaceId: id })
  const openEvent = (id) => setState({ view: 'eventDetail', selectedEventId: id })

  const setSearchQuery = (v) => setState({ searchQuery: v })
  const onSearchChange = (e) => setSearchQuery(e.target.value)
  const setCategory = (c) => setState({ activeCategory: c })

  const updateAuthField = (f, v) => setState((s) => ({ authForm: { ...s.authForm, [f]: v } }))
  const onAuthNameChange = (e) => updateAuthField('name', e.target.value)
  const onAuthEmailChange = (e) => updateAuthField('email', e.target.value)
  const onAuthPasswordChange = (e) => updateAuthField('password', e.target.value)
  const submitLogin = () => {
    const s = stateRef.current
    if (!s.authForm.email || !s.authForm.password) { setState({ authError: 'กรุณากรอกอีเมลและรหัสผ่าน' }); return }
    setState({ loggedIn: true, userName: s.authForm.email.split('@')[0], view: 'home', authError: '' })
  }
  const submitSignup = () => {
    const s = stateRef.current
    if (!s.authForm.name || !s.authForm.email || !s.authForm.password) { setState({ authError: 'กรุณากรอกข้อมูลให้ครบถ้วน' }); return }
    setState({ loggedIn: true, userName: s.authForm.name, view: 'home', authError: '' })
  }
  const logout = () => setState({ loggedIn: false, userName: '', view: 'home' })

  const toggleChat = () => setState((s) => ({ chatOpen: !s.chatOpen }))
  const setChatInput = (v) => setState({ chatInput: v })
  const onChatInputChange = (e) => setChatInput(e.target.value)
  const sendChat = async () => {
    const text = stateRef.current.chatInput.trim()
    if (!text) return
    const historyForApi = stateRef.current.chatMessages.map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text }))
    setState((s) => ({ chatMessages: [...s.chatMessages, { from: 'user', text }], chatInput: '', chatTyping: true }))
    try {
      const { reply, places } = await sendChatMessage(text, historyForApi)
      setState((s) => ({ chatMessages: [...s.chatMessages, { from: 'bot', text: reply, places }], chatTyping: false }))
    } catch (err) {
      console.error('Chat request failed:', err)
      setState((s) => ({ chatMessages: [...s.chatMessages, { from: 'bot', text: 'ขออภัยครับ ระบบแชทขัดข้องชั่วคราว ลองใหม่อีกครั้งนะครับ' }], chatTyping: false }))
    }
  }

  const updateTripField = (f, v) => setState((s) => ({ tripForm: { ...s.tripForm, [f]: v }, tripFormError: '' }))
  const onStartDateChange = (e) => updateTripField('startDate', e.target.value)
  const onEndDateChange = (e) => updateTripField('endDate', e.target.value)
  const onAccommodationChange = (e) => updateTripField('accommodation', e.target.value)
  const onMustGoChange = (e) => updateTripField('mustGo', e.target.value)
  const setPace = (p) => setState((s) => ({ tripForm: { ...s.tripForm, pace: p } }))
  const onDailyStartChange = (e) => updateTripField('dailyStart', e.target.value)
  const onDailyEndChange = (e) => updateTripField('dailyEnd', e.target.value)
  const onFeedbackChange = (e) => setState({ feedbackText: e.target.value })
  const toggleInterest = (tag) => setState((s) => {
    const has = s.tripForm.interests.includes(tag)
    return { tripForm: { ...s.tripForm, interests: has ? s.tripForm.interests.filter((x) => x !== tag) : [...s.tripForm.interests, tag] } }
  })
  const setBudget = (b) => setState((s) => ({ tripForm: { ...s.tripForm, budget: b } }))

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
          liked: null,
          distanceFromPrev: slot.distance_km || null,
          place: { id: slot.place.id, name: slot.place.name, category: slot.place.category, rating: slot.place.rating, address: slot.place.address, img: slot.place.img },
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

    setState({ tripFormError: '', tripPlanning: true, view: 'tripLoading' })
    try {
      const resp = await requestTripPlan({
        trip_duration_days: days,
        start_date: f.startDate,
        accommodation_name: f.accommodation,
        must_go: f.mustGo.split(',').map((s) => s.trim()).filter(Boolean),
        interests: f.interests,
        trip_pace: f.pace,
        budget_level: f.budget,
        start_time: f.dailyStart,
        end_time: f.dailyEnd,
      })
      if (!resp.itinerary || resp.itinerary.length === 0) {
        setState({ tripPlanning: false, view: 'tripForm', tripFormError: resp.note || 'ไม่พบสถานที่ที่ตรงกับเงื่อนไข ลองปรับความสนใจหรืองบประมาณดูนะครับ' })
        return
      }
      setState({ tripPlan: tripResponseToPlan(resp, f.startDate), tripPlanNote: resp.note, tripPlanning: false, view: 'tripResult', feedbackText: '' })
    } catch (err) {
      console.error('Trip plan request failed:', err)
      setState({ tripPlanning: false, view: 'tripForm', tripFormError: 'สร้างแผนทริปไม่สำเร็จ ลองอีกครั้งนะครับ' })
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
    setState({ tripPlan: { ...plan, days: newDays }, feedbackText: '' })
  }

  const startScan = () => {
    setState({ scanState: 'scanning' })
    setTimeout(() => {
      const qrPlaces = stateRef.current.places.filter((p) => p.hasQR)
      const place = qrPlaces[Math.floor(Math.random() * qrPlaces.length)]
      setState((s) => ({ scanState: 'success', scanResultPoints: place.qrPoints, scanResultPlace: place.name, userPoints: s.userPoints + place.qrPoints }))
    }, 1300)
  }
  const resetScan = () => setState({ scanState: 'idle' })
  const redeemReward = (id) => {
    const s = stateRef.current
    const reward = s.rewards.find((r) => r.id === id)
    if (!reward || s.userPoints < reward.cost) return
    setState((s2) => ({ userPoints: s2.userPoints - reward.cost }))
  }

  const adminLogin = () => setState({ adminLoggedIn: true, mode: 'admin', view: 'admin', adminTab: 'dashboard' })
  const adminLogout = () => setState({ adminLoggedIn: false, mode: 'public', view: 'home' })
  const setAdminTab = (t) => setState({ adminTab: t, formOpen: false })

  const openCreateForm = (type) => {
    const defaults = {
      place: { name: '', category: 'คาเฟ่', rating: '4.5', reviews: '0', price: '', address: '', hours: '', phone: '', desc: '', amenities: '', tags: '', hasQR: false, qrPoints: '0' },
      event: { name: '', category: '', dateRange: '', venueName: '', admission: '', organizer: '', suitableFor: '', desc: '', status: 'upcoming' },
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

  const saveForm = async () => {
    const { formType, formData, editingId } = stateRef.current
    const splitList = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean)

    if (formType === 'place') {
      const payload = {
        name: formData.name, category: formData.category, rating: parseFloat(formData.rating) || null,
        review_count: parseInt(formData.reviews) || 0, price: formData.price, address: formData.address,
        hours: formData.hours, phone: formData.phone, description: formData.desc,
        amenities: splitList(formData.amenities), tags: splitList(formData.tags),
        has_qr: !!formData.hasQR, qr_points: parseInt(formData.qrPoints) || 0,
      }
      const query = editingId
        ? supabase.from('places').update(payload).eq('id', editingId).select().single()
        : supabase.from('places').insert(payload).select().single()
      const { data, error } = await query
      if (error) { showToast('บันทึกสถานที่ไม่สำเร็จ: ' + error.message); return }
      const item = rowToPlace(data)
      setState((s) => ({ places: editingId ? s.places.map((p) => p.id === editingId ? item : p) : [...s.places, item] }))
    } else if (formType === 'event') {
      const payload = {
        name: formData.name, category: formData.category, date_range: formData.dateRange, venue_name: formData.venueName,
        admission: formData.admission, organizer: formData.organizer, suitable_for: splitList(formData.suitableFor),
        description: formData.desc, status: formData.status,
      }
      const query = editingId
        ? supabase.from('events').update(payload).eq('id', editingId).select().single()
        : supabase.from('events').insert(payload).select().single()
      const { data, error } = await query
      if (error) { showToast('บันทึกอีเวนท์ไม่สำเร็จ: ' + error.message); return }
      const item = rowToEvent(data)
      setState((s) => ({ events: editingId ? s.events.map((e) => e.id === editingId ? item : e) : [...s.events, item] }))
    } else if (formType === 'kb') {
      const payload = { title: formData.title, category: formData.category, content: formData.content, is_pinned: !!formData.isPinned, is_active: !!formData.isActive }
      const query = editingId
        ? supabase.from('knowledge_base').update(payload).eq('id', editingId).select().single()
        : supabase.from('knowledge_base').insert(payload).select().single()
      const { data, error } = await query
      if (error) { showToast('บันทึกฐานความรู้ไม่สำเร็จ: ' + error.message); return }
      const item = rowToKb(data)
      setState((s) => ({ knowledgeBase: editingId ? s.knowledgeBase.map((k) => k.id === editingId ? item : k) : [...s.knowledgeBase, item] }))
    } else if (formType === 'qr') {
      const payload = { place_id: formData.placeId, points: parseInt(formData.points) || 0 }
      const query = editingId
        ? supabase.from('qrs').update(payload).eq('id', editingId).select().single()
        : supabase.from('qrs').insert(payload).select().single()
      const { data, error } = await query
      if (error) { showToast('สร้าง QR ไม่สำเร็จ: ' + error.message); return }
      const item = rowToQr(data)
      setState((s) => ({ qrs: editingId ? s.qrs.map((q) => q.id === editingId ? item : q) : [...s.qrs, item] }))
    } else if (formType === 'reward') {
      const payload = { name: formData.name, cost: parseInt(formData.cost) || 0 }
      const query = editingId
        ? supabase.from('rewards').update(payload).eq('id', editingId).select().single()
        : supabase.from('rewards').insert(payload).select().single()
      const { data, error } = await query
      if (error) { showToast('บันทึกของรางวัลไม่สำเร็จ: ' + error.message); return }
      setState((s) => ({ rewards: editingId ? s.rewards.map((r) => r.id === editingId ? data : r) : [...s.rewards, data] }))
    }

    const labels = { place: 'บันทึกสถานที่แล้ว', event: 'บันทึกอีเวนท์แล้ว', kb: 'บันทึกฐานความรู้แล้ว', qr: 'สร้าง QR แล้ว', reward: 'บันทึกของรางวัลแล้ว' }
    cancelForm()
    showToast(labels[formType] || 'บันทึกแล้ว')
  }

  const deleteItem = async (type, id) => {
    if (!window.confirm('ยืนยันการลบข้อมูลนี้หรือไม่?')) return
    const table = { place: 'places', event: 'events', kb: 'knowledge_base', qr: 'qrs', reward: 'rewards' }[type]
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) { showToast('ลบไม่สำเร็จ: ' + error.message); return }
    if (type === 'place') setState((s) => ({ places: s.places.filter((p) => p.id !== id) }))
    if (type === 'event') setState((s) => ({ events: s.events.filter((e) => e.id !== id) }))
    if (type === 'kb') setState((s) => ({ knowledgeBase: s.knowledgeBase.filter((k) => k.id !== id) }))
    if (type === 'qr') setState((s) => ({ qrs: s.qrs.filter((q) => q.id !== id) }))
    if (type === 'reward') setState((s) => ({ rewards: s.rewards.filter((r) => r.id !== id) }))
  }

  const onNewPlace = () => openCreateForm('place')
  const onNewEvent = () => openCreateForm('event')
  const onNewKb = () => openCreateForm('kb')
  const onNewQr = () => openCreateForm('qr')
  const onNewReward = () => openCreateForm('reward')

  const fieldHandlers = {}
  ;['name', 'category', 'rating', 'reviews', 'price', 'address', 'hours', 'phone', 'desc', 'amenities', 'tags', 'qrPoints', 'dateRange', 'venueName', 'admission', 'organizer', 'suitableFor', 'status', 'title', 'content', 'placeId', 'points', 'cost'].forEach((f) => {
    fieldHandlers['onField_' + f] = (e) => updateFormField(f, e.target.value)
  })
  ;['hasQR', 'isPinned', 'isActive'].forEach((f) => {
    fieldHandlers['onField_' + f] = (e) => updateFormField(f, e.target.checked)
  })

  const actions = {
    showToast, toggleMobileMenu, closeMobileMenu, closeWelcomeModal, welcomeGoTrip, welcomeGoPoints,
    goHome, goPlaces, goEvents, goPublic, goAdminLogin, goTripForm, nextStep, prevStep, goToStep,
    goPoints, goLogin, goSignup, openPlace, openEvent, setSearchQuery, onSearchChange, setCategory,
    onAuthNameChange, onAuthEmailChange, onAuthPasswordChange, submitLogin, submitSignup, logout,
    toggleChat, onChatInputChange, sendChat,
    onStartDateChange, onEndDateChange, onAccommodationChange, onMustGoChange, setPace, onDailyStartChange, onDailyEndChange,
    onFeedbackChange, toggleInterest, setBudget, submitTripForm, setItemLike, regeneratePlan,
    startScan, resetScan, redeemReward,
    adminLogin, adminLogout, setAdminTab, openCreateForm, openEditForm, updateFormField, cancelForm,
    saveForm, deleteItem, onNewPlace, onNewEvent, onNewKb, onNewQr, onNewReward,
    ...fieldHandlers,
  }

  // ---- Derived / computed view values (mirrors renderVals()) ----
  const s = state
  const categoriesView = categories.map((c) => ({
    label: c, onClick: () => setCategory(c), icon: categoryIcons[c],
    bg: c === s.activeCategory ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#fff', color: c === s.activeCategory ? '#fff' : '#1f2a24',
    iconBorder: c === s.activeCategory ? '#fff' : '#2E7D32'
  }))
  const isGrid = (k) => k === 'grid', isCup = (k) => k === 'cup', isTemple = (k) => k === 'temple', isMuseum = (k) => k === 'museum', isTree = (k) => k === 'tree', isBasket = (k) => k === 'basket', isCamera = (k) => k === 'camera', isFood = (k) => k === 'food', isBed = (k) => k === 'bed'
  const categoriesViewIcons = categoriesView.map((c) => ({ ...c, showGrid: isGrid(c.icon), showCup: isCup(c.icon), showTemple: isTemple(c.icon), showMuseum: isMuseum(c.icon), showTree: isTree(c.icon), showBasket: isBasket(c.icon), showCamera: isCamera(c.icon), showFood: isFood(c.icon), showBed: isBed(c.icon) }))
  const placeBadge = (p) => p.reviews >= 1500 ? { label: 'ยอดนิยม', bg: '#FDEEE3', color: '#E07B39' } : { label: '', bg: '', color: '' }
  const filteredPlaces = s.places.filter((p) => {
    const catOk = s.activeCategory === 'ทั้งหมด' || p.category === s.activeCategory
    const q = s.searchQuery.trim().toLowerCase()
    const qOk = !q || p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)
    return catOk && qOk
  }).map((p) => ({ ...p, onOpen: () => openPlace(p.id), badge: placeBadge(p) }))

  const eventsView = s.events.map((e) => ({ ...e, onOpen: () => openEvent(e.id) }))
  const selectedPlace = s.places.find((p) => p.id === s.selectedPlaceId) || { amenities: [] }
  const selectedEvent = s.events.find((e) => e.id === s.selectedEventId) || { suitableFor: [] }
  const qrPlacesList = s.places.filter((p) => p.hasQR).map((p) => ({ ...p, onOpen: () => openPlace(p.id) }))

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
        return {
          ...it, place,
          onLike: () => setItemLike(d.dayNum, it.placeId, true),
          onDislike: () => setItemLike(d.dayNum, it.placeId, false),
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
  const placesView = s.places.map((p) => ({ ...p, onEdit: () => openEditForm('place', p), onDelete: () => deleteItem('place', p.id) }))
  const eventsAdminView = s.events.map((e) => ({ ...e, onEdit: () => openEditForm('event', e), onDelete: () => deleteItem('event', e.id) }))
  const kbView = s.knowledgeBase.map((k) => ({ ...k, statusLabel: (k.isPinned ? '📌 Pinned · ' : '') + (k.isActive ? 'Active' : 'Inactive'), onEdit: () => openEditForm('kb', k), onDelete: () => deleteItem('kb', k.id) }))
  const qrsView = s.qrs.map((q) => ({ ...q, placeName: (s.places.find((p) => p.id === q.placeId) || {}).name || '-', onDelete: () => deleteItem('qr', q.id) }))

  const adminNav = adminTabs.map((t) => {
    const active = t.key === s.adminTab
    return {
      key: t.key, label: t.label, onClick: () => setAdminTab(t.key),
      bg: active ? '#E8F5E9' : 'transparent', color: active ? '#1B5E20' : '#6d7a72',
      iconBg: active ? 'linear-gradient(135deg,#66BB6A,#2E7D32)' : '#F1F8E9',
      iconColor: active ? '#fff' : '#7d8a80',
      isDashboard: t.icon === 'dashboard', isPlaces: t.icon === 'places', isEvents: t.icon === 'events', isKnowledge: t.icon === 'knowledge', isQr: t.icon === 'qr'
    }
  })
  const adminTabLabel = (adminTabs.find((t) => t.key === s.adminTab) || {}).label || ''

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
    isPublic: s.mode === 'public',
    isHome: s.mode === 'public' && s.view === 'home',
    isPlaceDetail: s.mode === 'public' && s.view === 'placeDetail',
    isEventDetail: s.mode === 'public' && s.view === 'eventDetail',
    isPlacesList: s.mode === 'public' && s.view === 'placesList',
    isEventsList: s.mode === 'public' && s.view === 'eventsList',
    homePlaces: s.places.slice(0, 4).map((p) => ({ ...p, onOpen: () => openPlace(p.id), badge: placeBadge(p) })),
    homeEvents: s.events.slice(0, 3).map((e) => ({ ...e, onOpen: () => openEvent(e.id) })),
    stepMeta,
    isTripForm: s.mode === 'public' && s.view === 'tripForm',
    isTripLoading: s.mode === 'public' && s.view === 'tripLoading',
    isTripResult: s.mode === 'public' && s.view === 'tripResult',
    isPoints: s.mode === 'public' && s.view === 'points',
    isLogin: s.mode === 'public' && s.view === 'login',
    isSignup: s.mode === 'public' && s.view === 'signup',
    isAdminLoginView: s.mode === 'admin' && s.view === 'adminLogin',
    isAdminDashboardView: s.mode === 'admin' && s.view === 'admin',
    isAdminDashboardTab: s.adminTab === 'dashboard',
    isAdminPlacesTab: s.adminTab === 'places',
    isAdminEventsTab: s.adminTab === 'events',
    isAdminKbTab: s.adminTab === 'knowledge',
    isAdminQrTab: s.adminTab === 'qr',
    isPlaceFormOpen: s.formOpen && s.formType === 'place',
    isEventFormOpen: s.formOpen && s.formType === 'event',
    isKbFormOpen: s.formOpen && s.formType === 'kb',
    isQrFormOpen: s.formOpen && s.formType === 'qr',
    isRewardFormOpen: s.formOpen && s.formType === 'reward',
    isScanning: s.scanState === 'scanning',
    isScanSuccess: s.scanState === 'success',
    notLoggedIn: !s.loggedIn,
    categoriesView, categoriesViewIcons, filteredPlaces, placesEmpty: filteredPlaces.length === 0, eventsView,
    selectedPlace, selectedEvent, qrPlacesList,
    chatMessagesView: s.chatMessages.map((m) => ({ ...m, align: m.from === 'user' ? 'flex-end' : 'flex-start', bg: m.from === 'user' ? '#2E7D32' : '#f0efe7', color: m.from === 'user' ? '#fff' : '#1f2a24' })),
    interestOptionsView, budgetOptionsView, paceOptionsView,
    isStep0: s.tripStep === 0, isStep1: s.tripStep === 1, isStep2: s.tripStep === 2, isStep3: s.tripStep === 3,
    primaryLabel: s.tripStep === 3 ? 'สร้างแผนการเดินทาง →' : 'ถัดไป →',
    onPrimaryStep: s.tripStep === 3 ? submitTripForm : nextStep,
    prevOpacity: s.tripStep === 0 ? '0.35' : '1',
    tripPlan,
    rewardsView, rewardsAdminView,
    placesView, eventsAdminView, kbView, qrsView,
    placeCategoryOptions: categories.filter((c) => c !== 'ทั้งหมด'),
    adminNav, adminTabLabel,
    navHomeColor: s.view === 'home' ? '#1B5E20' : '#1f2a24', navHomeWeight: s.view === 'home' ? '800' : '600',
    navTripColor: ['tripForm', 'tripLoading', 'tripResult'].includes(s.view) ? '#1B5E20' : '#1f2a24', navTripWeight: ['tripForm', 'tripLoading', 'tripResult'].includes(s.view) ? '800' : '600',
    navPointsColor: s.view === 'points' ? '#1B5E20' : '#1f2a24', navPointsWeight: s.view === 'points' ? '800' : '600',
    navPlacesColor: ['placesList', 'placeDetail'].includes(s.view) ? '#1B5E20' : '#1f2a24', navPlacesWeight: ['placesList', 'placeDetail'].includes(s.view) ? '800' : '600',
    navEventsColor: ['eventsList', 'eventDetail'].includes(s.view) ? '#1B5E20' : '#1f2a24', navEventsWeight: ['eventsList', 'eventDetail'].includes(s.view) ? '800' : '600',
    navHomeUnderline: s.view === 'home' ? '100%' : '0%',
    navTripUnderline: ['tripForm', 'tripLoading', 'tripResult'].includes(s.view) ? '100%' : '0%',
    navPointsUnderline: s.view === 'points' ? '100%' : '0%',
    navPlacesUnderline: ['placesList', 'placeDetail'].includes(s.view) ? '100%' : '0%',
    navEventsUnderline: ['eventsList', 'eventDetail'].includes(s.view) ? '100%' : '0%',
  }

  const value = { state, actions, derived }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
