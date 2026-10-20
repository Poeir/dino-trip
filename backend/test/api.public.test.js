// Public endpoints (no session): health, SEO, auth flows, survey, public
// lists through crudRouter, error format and the dev Swagger UI. Real app,
// fake DB (helpers/apiHarness.js) -- no database or outside service needed.
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { startHarness, makeUser, UUID } from './helpers/apiHarness.js'

const h = await startHarness()
after(() => h.close())
beforeEach(() => h.fakeDb.reset())

const placeRow = (over = {}) => ({
  id: UUID, name: 'บึงแก่นนคร', category: 'สถานที่ท่องเที่ยว', rating: 4.6, review_count: 900, lat: 16.42, lng: 102.84,
  amenities: ['ที่จอดรถ'], tags: [], has_qr: false, qr_points: 0, is_active: true, images: ['https://img.test/a.jpg'], ...over,
})

// ------------------------------------------------------------------ health
test('GET / names the API', async () => {
  const res = await h.request('GET', '/')
  assert.equal(res.status, 200)
  assert.equal(res.json.name, 'Dino Khon Kaen API')
})

test('GET /api/health runs a real query and reports ok / 503', async () => {
  let res = await h.request('GET', '/api/health')
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, { status: 'ok' })
  assert.ok(h.fakeDb.queries.some((q) => /select 1/.test(q.sql)))

  h.fakeDb.on(/select 1/, new Error('connection refused'))
  res = await h.request('GET', '/health')
  assert.equal(res.status, 503)
  assert.deepEqual(res.json, { status: 'error' })
})

test('unknown routes give the JSON 404 shape', async () => {
  const res = await h.request('GET', '/api/does-not-exist')
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'Not found: GET /api/does-not-exist')
})

// ------------------------------------------------------------------ SEO
test('robots.txt is plain text and points at the sitemap', async () => {
  const res = await h.request('GET', '/robots.txt')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/plain/)
  assert.match(res.text, /Sitemap: .*\/sitemap\.xml/)
})

test('sitemap.xml lists active places', async () => {
  h.fakeDb.on(/from "places"/, [{ id: UUID, updated_at: '2026-10-01T00:00:00Z' }])
  const res = await h.request('GET', '/sitemap.xml')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /xml/)
  assert.ok(res.text.includes(`/places/${UUID}</loc>`))
})

test('SEO pages: static page renders, bad ids and unknown paths 404 as HTML', async () => {
  let res = await h.request('GET', '/api/seo/page/trip')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
  assert.match(res.text, /<title>/)

  res = await h.request('GET', '/api/seo/page/places/not-a-uuid')
  assert.equal(res.status, 404)
  assert.match(res.headers.get('content-type'), /text\/html/)

  res = await h.request('GET', `/api/seo/page/places/${UUID}`) // fake DB: no such place
  assert.equal(res.status, 404)
})

test('SEO place page renders the place from the DB', async () => {
  const id = '22222222-2222-4333-8444-555555555555'
  h.fakeDb.on(/from "places" where "id"/, [placeRow({ id, name: 'วัดหนองแวง' })])
  const res = await h.request('GET', `/api/seo/page/places/${id}`)
  assert.equal(res.status, 200)
  assert.ok(res.text.includes('วัดหนองแวง'))
  assert.ok(res.text.includes('application/ld+json'))
})

// ------------------------------------------------------------------ auth
test('GET /api/auth/me without a cookie is { user: null }, not 401', async () => {
  const res = await h.request('GET', '/api/auth/me')
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, { user: null })
  assert.equal(h.fakeDb.queries.length, 0)
})

test('login validation, wrong password, unverified and success', async () => {
  let res = await h.request('POST', '/api/auth/login', { body: { email: 'a@b.co' } })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'กรุณากรอกอีเมลและรหัสผ่าน')

  res = await h.request('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'Passw0rd!' } })
  assert.equal(res.status, 401)
  assert.equal(res.json.error.message, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง')

  const hash = bcrypt.hashSync('Passw0rd!', 4)
  h.fakeDb.on(/from "users" where "email"/, [makeUser({ password_hash: hash, email_verified: false })])
  res = await h.request('POST', '/api/auth/login', { body: { email: 'Tourist@Example.com', password: 'Passw0rd!' } })
  assert.equal(res.status, 403)
  assert.match(res.json.error.message, /กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ/)

  h.fakeDb.on(/from "users" where "email"/, [makeUser({ password_hash: hash, status: 'suspended' })])
  res = await h.request('POST', '/api/auth/login', { body: { email: 'tourist@example.com', password: 'Passw0rd!' } })
  assert.equal(res.status, 403)
  assert.equal(res.json.error.message, 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ')

  h.fakeDb.on(/from "users" where "email"/, [makeUser({ password_hash: hash })])
  res = await h.request('POST', '/api/auth/login', { body: { email: 'tourist@example.com', password: 'Passw0rd!' } })
  assert.equal(res.status, 200)
  assert.equal(res.json.user.email, 'tourist@example.com')
  assert.equal(res.json.user.role, 'tourist')
  assert.equal(res.json.user.password_hash, undefined)
  const cookie = res.headers.get('set-cookie')
  assert.match(cookie, /session_token=[0-9a-f]{64}/)
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /SameSite=Lax/i)
  // The email is normalised before lookup.
  assert.ok(h.fakeDb.queries.some((q) => /from "users" where "email"/.test(q.sql) && q.bindings.includes('tourist@example.com')))
  assert.ok(h.fakeDb.queries.some((q) => /^insert into "sessions"/.test(q.sql)))
})

test('login is rate limited per IP+email (10 per 15 min) with Retry-After', async () => {
  const body = { email: 'ratelimit@example.com' } // 400s still count
  for (let i = 0; i < 10; i++) assert.equal((await h.request('POST', '/api/auth/login', { body })).status, 400)
  const res = await h.request('POST', '/api/auth/login', { body })
  assert.equal(res.status, 429)
  assert.equal(res.json.error.message, 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง')
  assert.ok(Number(res.headers.get('retry-after')) > 0)
})

test('signup validation messages', async () => {
  let res = await h.request('POST', '/api/auth/signup', { body: {} })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'กรุณากรอกข้อมูลให้ครบถ้วน')

  res = await h.request('POST', '/api/auth/signup', { body: { email: 'not-an-email', password: 'x' } })
  assert.equal(res.json.error.message, 'กรุณากรอกอีเมลให้ถูกต้อง')

  const profile = { title: 'mr', firstName: 'สมชาย', lastName: 'ใจดี', phone: '0812345678', gender: 'male', province: 'ขอนแก่น', district: 'เมือง', subdistrict: 'ในเมือง', birthdate: '2000-01-01', occupation: 'student' }
  res = await h.request('POST', '/api/auth/signup', { body: { email: 'new@example.com', password: 'short', ...profile } })
  assert.equal(res.json.error.message, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
  res = await h.request('POST', '/api/auth/signup', { body: { email: 'new@example.com', password: 'Passw0rd!', ...profile, phone: '12345' } })
  assert.match(res.json.error.message, /เบอร์โทรศัพท์/)

  h.fakeDb.on(/from "users" where "email"/, [makeUser()])
  res = await h.request('POST', '/api/auth/signup', { body: { email: 'tourist@example.com', password: 'Passw0rd!', ...profile } })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'อีเมลนี้ถูกใช้งานแล้ว')
})

test('token endpoints reject missing / unknown tokens', async () => {
  let res = await h.request('POST', '/api/auth/confirm', { body: {} })
  assert.equal(res.json.error.message, 'ลิงก์ยืนยันไม่ถูกต้อง')
  res = await h.request('POST', '/api/auth/confirm', { body: { token: 'nope' } })
  assert.equal(res.json.error.message, 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ')
  res = await h.request('POST', '/api/auth/reset-password', { body: { password: 'Passw0rd!' } })
  assert.equal(res.json.error.message, 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง')
  res = await h.request('POST', '/api/auth/forgot-password', { body: {} })
  assert.equal(res.json.error.message, 'กรุณากรอกอีเมล')
  res = await h.request('POST', '/api/profile/email/confirm', { body: {} })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'ลิงก์ยืนยันไม่ถูกต้อง')
})

test('forgot-password answers the same whether or not the email exists', async () => {
  const res = await h.request('POST', '/api/auth/forgot-password', { body: { email: 'ghost@example.com' } })
  assert.equal(res.status, 200)
  assert.equal(res.json.message, 'หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปให้แล้ว')
})

test('logout always succeeds and clears the cookie', async () => {
  const res = await h.request('POST', '/api/auth/logout')
  assert.equal(res.status, 204)
  assert.match(res.headers.get('set-cookie'), /session_token=;/)
})

// ------------------------------------------------------------------ crudRouter lists
test('GET /api/places maps DB rows to the camelCase API shape', async () => {
  h.fakeDb.on(/from "places"/, [placeRow()])
  const res = await h.request('GET', '/api/places?isActive=true')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.json))
  const [p] = res.json
  assert.equal(p.name, 'บึงแก่นนคร')
  assert.equal(p.reviews, 900)
  assert.deepEqual(p.location, { lat: 16.42, lng: 102.84 })
  assert.equal(p.img, 'https://img.test/a.jpg')
  assert.equal(p.review_count, undefined)
  assert.ok(h.fakeDb.queries.some((q) => /"is_active" = \$1/.test(q.sql)))
})

test('page/limit switch the list to a paginated object', async () => {
  // Handlers registered later are checked first; the count query also ends in "limit" (.first()).
  h.fakeDb.on(/from "knowledge_base".*limit/, [{ id: UUID, title: 'การเดินทาง', content: 'x', is_pinned: false, is_active: true, embedding: null }])
  h.fakeDb.on(/count\("id"\)/, [{ c: 3 }])
  const res = await h.request('GET', '/api/knowledge-base?page=1&limit=1')
  assert.equal(res.status, 200)
  assert.equal(res.json.total, 3)
  assert.equal(res.json.pageSize, 1)
  assert.equal(res.json.totalPages, 3)
  assert.equal(res.json.data[0].isEmbedded, false)
})

test('crudRouter caches list responses (25s TTL)', async () => {
  h.fakeDb.on(/from "rewards"/, [{ id: UUID, name: 'พวงกุญแจ', cost: 50, stock: null, image_url: null }])
  const first = await h.request('GET', '/api/rewards?search=cache-test')
  const before = h.fakeDb.queries.length
  const second = await h.request('GET', '/api/rewards?search=cache-test')
  assert.deepEqual(second.json, first.json)
  assert.equal(h.fakeDb.queries.length, before, 'second call should be served from the cache')
  assert.deepEqual(first.json[0], { id: UUID, name: 'พวงกุญแจ', cost: 50, stock: null, imageUrl: '' })
})

test('GET /:id 404s with the Thai message; malformed ids are 400; missing migration is 503', async () => {
  let res = await h.request('GET', `/api/events/${UUID}`)
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'ไม่พบข้อมูล')

  h.fakeDb.on(/from "events" where "id"/, Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }))
  res = await h.request('GET', '/api/events/not-a-uuid')
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'ข้อมูลที่ส่งมาไม่ถูกต้อง')

  h.fakeDb.on(/from "qrs" where "id"/, Object.assign(new Error('column does not exist'), { code: '42703' }))
  res = await h.request('GET', `/api/qrs/${UUID}`)
  assert.equal(res.status, 503)
  assert.match(res.json.error.message, /ฐานข้อมูลยังไม่เป็นปัจจุบัน/)
})

test('unexpected DB errors become a generic 500 without leaking driver text', async () => {
  h.fakeDb.on(/from "place_photos"/, new Error('secret driver detail'))
  const res = await h.request('GET', `/api/places/${UUID}/photos`)
  assert.equal(res.status, 500)
  assert.equal(res.json.error.message, 'เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง')
  assert.ok(!res.text.includes('secret'))
})

test('GET /api/qrs/meta/places only returns places with a live QR, points from the QR', async () => {
  h.fakeDb.on(/from "qrs"/, [{ place_id: UUID, points: 25, radius_m: 150, expires_at: null }])
  h.fakeDb.on(/from "places"/, [placeRow({ qr_points: 1 })])
  const res = await h.request('GET', '/api/qrs/meta/places')
  assert.equal(res.status, 200)
  assert.equal(res.json[0].qrPoints, 25)
  assert.equal(res.json[0].qrRadiusM, 150)
  assert.equal(res.json[0].hasQR, true)
})

test('GET /api/users/:id/avatar 404s with no body when there is no photo', async () => {
  const res = await h.request('GET', `/api/users/${UUID}/avatar`)
  assert.equal(res.status, 404)
  assert.equal(res.text, '')
})

// ------------------------------------------------------------------ trips (anonymous)
const tripBody = (over = {}) => ({
  title: 'ทริปทดสอบ',
  days: [{ date: '2026-11-01', items: [{ placeId: UUID, arrivalTime: '09:00', departureTime: '10:00' }] }],
  ...over,
})

test('POST /api/trips validates the plan', async () => {
  let res = await h.request('POST', '/api/trips', { body: {} })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'ข้อมูลแผนทริปไม่ถูกต้อง: จำนวนวันต้องอยู่ระหว่าง 1-14')

  res = await h.request('POST', '/api/trips', { body: tripBody({ days: [{ date: '2026-02-30', items: [] }] }) })
  assert.equal(res.json.error.message, 'ข้อมูลแผนทริปไม่ถูกต้อง: วันที่ของวัน 1')

  res = await h.request('POST', '/api/trips', { body: tripBody() }) // fake DB knows no places
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'ข้อมูลแผนทริปไม่ถูกต้อง: มีสถานที่ที่ไม่พบในระบบ')
})

test('POST /api/trips without a session records the plan anonymously (202, id null)', async () => {
  h.fakeDb.on(/from "places" where "id" in/, [{ id: UUID, name: 'บึงแก่นนคร' }])
  h.fakeDb.on(/^insert into "trips"/, [{ id: 'trip-1' }])
  h.fakeDb.on(/^insert into "trip_days"/, [{ id: 'day-1' }])
  const res = await h.request('POST', '/api/trips', { body: tripBody() })
  assert.equal(res.status, 202)
  assert.deepEqual(res.json, { id: null })
  const insert = h.fakeDb.queries.find((q) => /^insert into "trips"/.test(q.sql))
  assert.ok(insert.bindings.includes(null), 'user_id should be null')
  const item = h.fakeDb.queries.find((q) => /^insert into "trip_items"/.test(q.sql))
  assert.ok(item.bindings.includes('บึงแก่นนคร'), 'place name comes from the places table')
})

// ------------------------------------------------------------------ survey
const surveyBody = (over = {}) => ({
  gender: 'female', age: 21, occupation: 'student', planMethod: 'social', planTime: '1-3h', aiUsage: 'sometimes', khonKaenVisit: 'visited',
  answers: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, 4])), ...over,
})

test('survey questions and status are served without the DB', async () => {
  let res = await h.request('GET', '/api/survey/questions')
  assert.equal(res.status, 200)
  assert.equal(res.json.questions.length, 16)
  assert.equal(res.json.scale.length, 5)
  res = await h.request('GET', '/api/survey/status')
  assert.deepEqual(res.json, { submitted: false })
  res = await h.request('GET', '/api/survey/status', { cookie: 'survey_done=1' })
  assert.deepEqual(res.json, { submitted: true })
  assert.equal(h.fakeDb.queries.length, 0)
})

test('survey submit: honeypot, validation, one per browser, success sets the cookie', async () => {
  let res = await h.request('POST', '/api/survey', { body: surveyBody({ website: 'http://spam' }) })
  assert.equal(res.status, 201)
  assert.equal(h.fakeDb.queries.length, 0, 'honeypot submissions are not stored')

  res = await h.request('POST', '/api/survey', { body: surveyBody({ gender: 'x' }) })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'กรุณาเลือกเพศ')

  res = await h.request('POST', '/api/survey', { body: surveyBody(), cookie: 'survey_done=1' })
  assert.equal(res.status, 409)
  assert.equal(res.json.error.message, 'เครื่องนี้ตอบแบบสอบถามแล้ว ขอบคุณที่ร่วมตอบ')

  res = await h.request('POST', '/api/survey', { body: surveyBody() })
  assert.equal(res.status, 201)
  assert.match(res.headers.get('set-cookie'), /survey_done=1/)
  assert.ok(h.fakeDb.queries.some((q) => /^insert into "survey_responses"/.test(q.sql)))
})

// ------------------------------------------------------------------ docs
test('dev Swagger UI and the JSON spec are served outside production', async () => {
  let res = await h.request('GET', '/api/docs/openapi.json')
  assert.equal(res.status, 200)
  assert.equal(res.json.openapi, '3.0.3')
  assert.ok(Object.keys(res.json.paths).length > 90)
  res = await h.request('GET', '/api/docs/')
  assert.equal(res.status, 200)
  assert.match(res.text, /swagger-ui/i)
})
