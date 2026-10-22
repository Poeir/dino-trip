// Logged-in user and admin behaviour: validation messages, crudRouter admin
// mutations, QR scan error mapping, trips ownership, reports, profile, the
// chatbot-service proxies and the billable Google endpoints' guards. Real app,
// fake DB + stub chatbot-service (helpers/apiHarness.js). Google is never
// called: GOOGLE_PLACES_API_KEY is blanked, so those routes stop at 503.
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startHarness, makeUser, UUID, USER_ID, SESSION_COOKIE } from './helpers/apiHarness.js'

const h = await startHarness()
after(() => h.close())

const tourist = makeUser({ role: 'tourist' })
const admin = makeUser({ id: '99999999-8888-4777-8666-555555555555', email: 'admin@example.com', role: 'admin' })

const as = (user) => { h.fakeDb.reset(); h.fakeDb.setSessionUser(user) }
const call = (method, path, opts = {}) => h.request(method, path, { cookie: SESSION_COOKIE, ...opts })
const dbError = (code, detail) => Object.assign(new Error(code), { code, detail })

beforeEach(() => as(tourist))

// ------------------------------------------------------------------ crudRouter admin mutations
test('admin: POST /api/places validates and returns the mapped row (201)', async () => {
  as(admin)
  let res = await call('POST', '/api/places', { body: {} })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'กรุณากรอกชื่อสถานที่')

  res = await call('POST', '/api/places', { body: { name: 'x', rating: 6 } })
  assert.equal(res.json.error.message, 'คะแนนต้องอยู่ระหว่าง 0 ถึง 5')

  res = await call('POST', '/api/places', { body: { name: 'x', lat: 200, lng: 10 } })
  assert.match(res.json.error.message, /พิกัดไม่ถูกต้อง/)

  res = await call('POST', '/api/places', { body: { name: 'x', category: 'ตลาด', marketTime: 'night' } })
  assert.equal(res.json.error.message, 'ช่วงเวลาของตลาดไม่ถูกต้อง')

  h.fakeDb.on(/^insert into "places"/, [{ id: UUID, name: 'คาเฟ่ใหม่', category: 'คาเฟ่', is_active: true, tags: ['a', 'b'] }])
  res = await call('POST', '/api/places', { body: { name: '  คาเฟ่ใหม่  ', category: 'คาเฟ่', tags: 'a, b' } })
  assert.equal(res.status, 201)
  assert.equal(res.json.name, 'คาเฟ่ใหม่')
  const insert = h.fakeDb.queries.find((q) => /^insert into "places"/.test(q.sql))
  assert.ok(insert.bindings.includes('คาเฟ่ใหม่'), 'name is trimmed')
  assert.match(insert.sql, /"embedding"/, 'embedding is reset on write')
})

test('admin: PUT/DELETE on a missing row 404, successful DELETE is 204', async () => {
  as(admin)
  let res = await call('PUT', `/api/knowledge-base/${UUID}`, { body: { title: 'หัวข้อ', content: 'เนื้อหา' } })
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'ไม่พบข้อมูล')

  res = await call('DELETE', `/api/rewards/${UUID}`)
  assert.equal(res.status, 404)

  h.fakeDb.on(/^delete from "rewards"/, { command: 'DELETE', rows: [], rowCount: 1 })
  res = await call('DELETE', `/api/rewards/${UUID}`)
  assert.equal(res.status, 204)
})

test('admin: QR / reward / knowledge-base / event payload validation', async () => {
  as(admin)
  const expect400 = async (path, body, message) => {
    const res = await call('POST', path, { body })
    assert.equal(res.status, 400, `${path} ${JSON.stringify(body)}`)
    assert.equal(res.json.error.message, message)
  }
  await expect400('/api/qrs', {}, 'กรุณาเลือกสถานที่')
  await expect400('/api/qrs', { placeId: UUID, points: 0 }, 'พอยท์ต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 10000')
  await expect400('/api/qrs', { placeId: UUID, points: 10, radiusM: 5 }, 'รัศมีต้องอยู่ระหว่าง 20 ถึง 5000 เมตร')
  await expect400('/api/rewards', { name: 'x', cost: '12abc' }, 'พอยท์ที่ใช้แลกต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 1000000')
  await expect400('/api/rewards', { cost: 10 }, 'กรุณากรอกชื่อของรางวัล')
  await expect400('/api/knowledge-base', { content: 'x' }, 'กรุณากรอกหัวข้อ')
  await expect400('/api/events', { name: 'งาน', eventStartDate: '2026-11-08', eventEndDate: '2026-11-04' }, 'วันที่สิ้นสุดต้องไม่มาก่อนวันที่เริ่มงาน')
  await expect400('/api/events', { name: 'งาน', status: 'weird' }, 'สถานะอีเวนท์ไม่ถูกต้อง')
})

test('admin: a second QR for the same place is a readable 409', async () => {
  as(admin)
  h.fakeDb.on(/^insert into "qrs"/, dbError('23505'))
  const res = await call('POST', '/api/qrs', { body: { placeId: UUID, points: 10 } })
  assert.equal(res.status, 409)
  assert.equal(res.json.error.message, 'สถานที่นี้มี QR อยู่แล้ว (ได้ 1 QR ต่อสถานที่)')
})

test('admin: image uploads reject non-image files before touching storage', async () => {
  as(admin)
  const form = new FormData()
  form.append('photoFile', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt')
  let res = await call('POST', `/api/places/${UUID}/photos`, { form })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'รองรับเฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)')

  res = await call('POST', `/api/events/${UUID}/photos`, { form: new FormData() })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'กรุณาเลือกไฟล์รูปภาพ')
})

// ------------------------------------------------------------------ QR scan
test('QR scan: coordinate validation and claim_qr_scan error mapping', async () => {
  let res = await call('POST', `/api/qrs/${UUID}/scan`, { body: { lat: 200, lng: 0 } })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'ตำแหน่งที่ส่งมาไม่ถูกต้อง')

  const cases = [
    ['QR404', 404, 'ไม่พบ QR นี้'],
    ['QR403', 403, 'QR นี้ปิดใช้งานอยู่'],
    ['QR409', 409, 'คุณเคยสแกน QR นี้ไปแล้ว'],
    ['QR410', 410, 'QR นี้หมดอายุแล้ว'],
    ['QR422', 422, 'ต้องเปิดการเข้าถึงตำแหน่งเพื่อสแกน QR นี้'],
  ]
  for (const [code, status, message] of cases) {
    as(tourist)
    h.fakeDb.on(/claim_qr_scan/, dbError(code))
    res = await call('POST', `/api/qrs/${UUID}/scan`, { body: {} })
    assert.equal(res.status, status, code)
    assert.equal(res.json.error.message, message)
  }

  as(tourist)
  h.fakeDb.on(/claim_qr_scan/, dbError('QR451', '350|200'))
  res = await call('POST', `/api/qrs/${UUID}/scan`, { body: { lat: 16.4, lng: 102.8 } })
  assert.equal(res.status, 403)
  assert.equal(res.json.error.message, 'คุณอยู่ห่างจากสถานที่ประมาณ 350 เมตร ต้องอยู่ภายใน 200 เมตรจึงจะสแกนได้')

  as(tourist)
  h.fakeDb.on(/claim_qr_scan/, { command: 'SELECT', rows: [{ points_awarded: 10, place_name: 'บึงแก่นนคร', new_balance: 110 }] })
  res = await call('POST', `/api/qrs/${UUID}/scan`, { body: { lat: 16.4, lng: 102.8 } })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, { points: 10, placeName: 'บึงแก่นนคร', balance: 110 })
  // The user id comes from the session, never from the request.
  assert.ok(h.fakeDb.queries.find((q) => /claim_qr_scan/.test(q.sql)).bindings.includes(USER_ID))
})

test('GET /api/points/me returns the session user balance', async () => {
  h.fakeDb.on(/select "points_balance" from "users"/, [{ points_balance: 42 }])
  const res = await call('GET', '/api/points/me')
  assert.deepEqual(res.json, { balance: 42 })
})

// ------------------------------------------------------------------ trips
test('trips: other users\' trips 404, rename validation, like validation', async () => {
  let res = await call('GET', `/api/trips/${UUID}`)
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'ไม่พบแผนทริปนี้')
  const lookup = h.fakeDb.queries.find((q) => /from "trips" where/.test(q.sql))
  assert.ok(lookup.bindings.includes(USER_ID), 'scoped to the session user')

  as(tourist)
  h.fakeDb.on(/from "trips" where/, [{ id: UUID, user_id: USER_ID, title: 'เดิม' }])
  res = await call('PATCH', `/api/trips/${UUID}`, { body: { title: '   ' } })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'กรุณาตั้งชื่อทริป')
  res = await call('PATCH', `/api/trips/${UUID}`, { body: {} })
  assert.equal(res.json.error.message, 'ไม่มีข้อมูลที่ต้องแก้ไข')
  res = await call('PATCH', `/api/trips/${UUID}`, { body: { isFavorite: 'yes' } })
  assert.equal(res.json.error.message, 'ข้อมูลที่ส่งมาไม่ถูกต้อง')
  res = await call('PATCH', `/api/trips/${UUID}/items/${UUID}`, { body: { liked: 'maybe' } })
  assert.equal(res.status, 400)
  res = await call('PATCH', `/api/trips/${UUID}/items/${UUID}`, { body: { liked: true } })
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'ไม่พบสถานที่นี้ในแผนทริป')
})

test('trips: the list is paginated and scoped to the user', async () => {
  h.fakeDb.on(/count\(\*\)/, [{ count: 0 }])
  const res = await call('GET', '/api/trips?favorite=1&search=50%')
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, { data: [], total: 0, page: 1, pageSize: 12, totalPages: 1 })
  assert.ok(h.fakeDb.queries.every((q) => !/from "trips"/.test(q.sql) || q.bindings.includes(USER_ID)))
})

test('trips: saving while logged in hits the 50-trip cap', async () => {
  h.fakeDb.on(/from "places" where "id" in/, [{ id: UUID, name: 'บึงแก่นนคร' }])
  h.fakeDb.on(/count\(\*\)/, [{ count: 50 }])
  const res = await call('POST', '/api/trips', { body: { days: [{ date: '2026-11-01', items: [{ placeId: UUID, arrivalTime: '09:00', departureTime: '10:00' }] }] } })
  assert.equal(res.status, 409)
  assert.equal(res.json.error.message, 'บันทึกแผนทริปได้สูงสุด 50 แผน กรุณาลบแผนเก่าก่อน')
})

// ------------------------------------------------------------------ reports
test('place/event reports: field validation, "other" needs a note, missing target 404', async () => {
  let res = await call('POST', `/api/places/${UUID}/reports`, { body: { fields: ['colour'] } })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'กรุณาเลือกข้อมูลที่ไม่ถูกต้อง')
  res = await call('POST', `/api/places/${UUID}/reports`, { body: { fields: ['other'] } })
  assert.equal(res.json.error.message, 'กรุณาอธิบายปัญหาที่พบ')
  res = await call('POST', `/api/places/${UUID}/reports`, { body: { fields: ['hours'] } })
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'ไม่พบสถานที่')
  res = await call('POST', `/api/events/${UUID}/reports`, { body: { fields: ['date'] } })
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'ไม่พบกิจกรรม')
})

test('place report: already-open fields are skipped, all-duplicate is 409', async () => {
  h.fakeDb.on(/select "id" from "places"/, [{ id: UUID }])
  h.fakeDb.on(/select "field" from "place_reports"/, [{ field: 'hours' }])
  let res = await call('POST', `/api/places/${UUID}/reports`, { body: { fields: ['hours', 'phone'], note: 'เบอร์ผิด' } })
  assert.equal(res.status, 201)
  assert.deepEqual(res.json, { ok: true, created: 1, skipped: 1 })
  res = await call('POST', `/api/places/${UUID}/reports`, { body: { field: 'hours' } })
  assert.equal(res.status, 409)

  res = await call('GET', `/api/places/${UUID}/reports/mine`)
  assert.deepEqual(res.json, { pendingFields: ['hours'] })
})

test('admin: resolving reports validates field/status/resolution', async () => {
  as(admin)
  let res = await call('POST', '/api/admin/place-reports/resolve', { body: { placeId: UUID, field: 'bogus', status: 'resolved' } })
  assert.equal(res.json.error.message, 'ฟิลด์ไม่ถูกต้อง')
  res = await call('POST', '/api/admin/place-reports/resolve', { body: { placeId: UUID, field: 'hours', status: 'resolved' } })
  assert.equal(res.json.error.message, 'กรุณาระบุวิธีจัดการ')
  res = await call('POST', '/api/admin/event-reports/resolve', { body: { eventId: UUID, field: 'date', status: 'maybe' } })
  assert.equal(res.json.error.message, 'สถานะไม่ถูกต้อง')
  res = await call('POST', '/api/admin/event-reports/resolve', { body: { eventId: UUID, field: 'date', status: 'rejected' } })
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'ไม่พบรายงานที่รอตรวจสอบ')
  res = await call('GET', '/api/admin/place-reports/count')
  assert.deepEqual(res.json, { pending: 0 })
})

// ------------------------------------------------------------------ event requests
test('event requests: validation, AI extract limits, ownership', async () => {
  let res = await call('POST', '/api/event-requests', { body: { name: '' } })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'กรุณากรอกชื่ออีเวนท์')

  res = await call('POST', '/api/event-requests/extract', { body: { text: '  ' } })
  assert.equal(res.json.error.message, 'กรุณาวางข้อความจากโพสต์')
  res = await call('POST', '/api/event-requests/extract', { body: { text: 'ก'.repeat(5001) } })
  assert.equal(res.json.error.message, 'ข้อความยาวเกินไป (ไม่เกิน 5000 ตัวอักษร)')

  res = await call('PUT', `/api/event-requests/${UUID}`, { body: { name: 'งาน' } })
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'ไม่พบคำขอที่แก้ไขได้')
})

test('event requests: a 6th pending request is refused with 429', async () => {
  h.fakeDb.on(/count\("id"\) as "c" from "event_requests"/, [{ c: 5 }])
  const res = await call('POST', '/api/event-requests', { body: { name: 'งานใหม่' } })
  assert.equal(res.status, 429)
  assert.equal(res.json.error.message, 'มีคำขอที่รออนุมัติอยู่ 5 รายการแล้ว กรุณารอการตรวจสอบก่อน')
})

test('admin: approving/rejecting event requests', async () => {
  as(admin)
  let res = await call('POST', `/api/admin/event-requests/${UUID}/reject`, { body: {} })
  assert.equal(res.json.error.message, 'กรุณาระบุเหตุผลที่ปฏิเสธ')
  res = await call('POST', `/api/admin/event-requests/${UUID}/approve`)
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'ไม่พบคำขอ')
  h.fakeDb.on(/from "event_requests" where "id"/, [{ id: UUID, status: 'approved' }])
  res = await call('POST', `/api/admin/event-requests/${UUID}/approve`)
  assert.equal(res.status, 409)
  assert.equal(res.json.error.message, 'คำขอนี้ถูกตรวจสอบไปแล้ว')
})

// ------------------------------------------------------------------ profile
test('profile: edit needs every field, password and email changes need the password', async () => {
  let res = await call('PATCH', '/api/profile', { body: { firstName: 'ก' } })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'กรุณากรอกข้อมูลให้ครบถ้วน')

  res = await call('POST', '/api/profile/password', { body: { newPassword: 'Passw0rd!' } })
  assert.equal(res.json.error.message, 'กรุณากรอกรหัสผ่านปัจจุบัน')

  res = await call('POST', '/api/profile/email', { body: { email: 'bad' } })
  assert.equal(res.json.error.message, 'กรุณากรอกอีเมลให้ถูกต้อง')

  res = await call('PUT', '/api/profile/avatar', { body: {} })
  assert.equal(res.json.error.message, 'กรุณาเลือกรูปโปรไฟล์')
  res = await call('PUT', '/api/profile/avatar', { body: { avatarUrl: 'preset:x', avatarScale: 9 } })
  assert.equal(res.json.error.message, 'avatarScale ไม่ถูกต้อง')
})

test('profile: wrong current password is 403', async () => {
  h.fakeDb.on(/select "password_hash" from "users"/, [{ password_hash: '$2a$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv' }])
  const res = await call('DELETE', '/api/profile', { body: { password: 'Wr0ngPass' } })
  assert.equal(res.status, 403)
  assert.equal(res.json.error.message, 'รหัสผ่านไม่ถูกต้อง')
})

// ------------------------------------------------------------------ admin users / redemptions
test('admin users: reason and points validation, cannot suspend yourself', async () => {
  as(admin)
  let res = await call('POST', `/api/admin/users/${UUID}/suspend`, { body: {} })
  assert.equal(res.json.error.message, 'กรุณาระบุเหตุผล')
  res = await call('POST', `/api/admin/users/${UUID}/points`, { body: { delta: 0, reason: 'x' } })
  assert.equal(res.json.error.message, 'จำนวนพอยท์ต้องเป็นจำนวนเต็มที่ไม่ใช่ 0 และไม่เกิน 100000')
  res = await call('GET', `/api/admin/users/${UUID}`)
  assert.equal(res.status, 404)
  assert.equal(res.json.error.message, 'ไม่พบผู้ใช้')

  as(admin)
  h.fakeDb.on(/from "users" where "id" = \$1 limit \$2 for update/, [{ ...admin }])
  res = await call('POST', `/api/admin/users/${admin.id}/suspend`, { body: { reason: 'ทดสอบ' } })
  assert.equal(res.status, 400)
  assert.equal(res.json.error.message, 'ไม่สามารถระงับบัญชีของตัวเองได้')
})

test('admin redemptions: required ids and DB error mapping', async () => {
  as(admin)
  let res = await call('POST', '/api/admin/redemptions', { body: {} })
  assert.equal(res.json.error.message, 'ต้องระบุผู้ใช้และของรางวัล')
  h.fakeDb.on(/admin_redeem_reward/, dbError('PT402'))
  res = await call('POST', '/api/admin/redemptions', { body: { userId: UUID, rewardId: UUID } })
  assert.equal(res.status, 402)
  assert.equal(res.json.error.message, 'พอยท์ของผู้ใช้ไม่พอ')
  as(admin)
  h.fakeDb.on(/admin_redeem_reward/, dbError('RW409'))
  res = await call('POST', '/api/admin/redemptions', { body: { userId: UUID, rewardId: UUID } })
  assert.equal(res.status, 409)
  assert.equal(res.json.error.message, 'ของรางวัลหมดแล้ว')
  res = await call('POST', `/api/admin/redemptions/${UUID}/cancel`, { body: { reason: '' } })
  assert.equal(res.json.error.message, 'กรุณาระบุเหตุผลที่ยกเลิก')
})

test('admin stats: dashboard numbers and trip stats window', async () => {
  as(admin)
  h.fakeDb.on(/from users$/m, { command: 'SELECT', rows: [{ total: 10, suspended: 1, unverified: 2, new_7d: 3, deleted: 0, active_admins: 1 }] })
  h.fakeDb.on(/as distributed/, { command: 'SELECT', rows: [{ distributed: 500, outstanding: 200 }] })
  h.fakeDb.on(/as last_7d/, { command: 'SELECT', rows: [{ last_7d: 4 }] })
  h.fakeDb.on(/as last_30d/, { command: 'SELECT', rows: [{ last_30d: 5 }] })
  const res = await call('GET', '/api/admin/stats')
  assert.equal(res.status, 200)
  assert.equal(res.json.users.total, 10)
  assert.equal(res.json.points.distributed, 500)
  assert.equal(res.json.scansLast7Days, 4)
  assert.deepEqual(res.json.recentRedemptions, [])
})

// ------------------------------------------------------------------ chatbot-service proxies
test('admin: /api/admin/stats/system reports backend + chatbot versions', async () => {
  as(admin)
  const res = await call('GET', '/api/admin/stats/system')
  assert.equal(res.status, 200)
  assert.equal(typeof res.json.backend.version, 'string')
  assert.deepEqual(res.json.chatbot, { version: '9.9.9', sha: 'stubsha' })
})

test('admin: event extract / describe / reindex are forwarded to chatbot-service', async () => {
  as(admin)
  const before = h.chatbot.calls.length
  let res = await call('POST', '/api/events/extract', { body: { text: 'งานไหม 4 พ.ย.' } })
  assert.equal(res.status, 200)
  assert.equal(res.json.extracted, true)
  assert.deepEqual(h.chatbot.calls[before], { method: 'POST', url: '/events/extract', body: { text: 'งานไหม 4 พ.ย.' } })

  res = await call('POST', '/api/places/describe', { body: { category: 'คาเฟ่' } })
  assert.equal(res.json.error.message, 'กรุณากรอกชื่อสถานที่ก่อน')
  res = await call('POST', '/api/places/describe', { body: { name: 'ร้าน', category: 'คาเฟ่', tags: ['a', 1] } })
  assert.equal(res.json.description, 'คำอธิบาย')
  assert.deepEqual(h.chatbot.calls.at(-1).body.tags, ['a'])

  res = await call('GET', '/api/reindex/status')
  assert.equal(res.json.stub, true)
  res = await call('POST', '/api/reindex')
  assert.equal(h.chatbot.calls.at(-1).url, '/admin/reindex')
})

test('user: event-request extract forwards trimmed text', async () => {
  const res = await call('POST', '/api/event-requests/extract', { body: { text: '  โพสต์  ' } })
  assert.equal(res.status, 200)
  assert.deepEqual(h.chatbot.calls.at(-1).body, { text: 'โพสต์' })
})

// ------------------------------------------------------------------ Google-backed admin routes (never billed in tests)
test('admin: place-sync / place-import guards run before any Google call', async () => {
  as(admin)
  let res = await call('POST', '/api/admin/place-sync/preview', { body: { scope: 'everything' } })
  assert.equal(res.json.error.message, 'ขอบเขตการซิงก์ไม่ถูกต้อง')
  res = await call('POST', '/api/admin/place-sync/preview', { body: { scope: 'selected', ids: ['nope'] } })
  assert.equal(res.json.error.message, 'รหัสสถานที่ไม่ถูกต้อง')
  res = await call('PUT', `/api/admin/place-sync/places/${UUID}/locked-fields`, { body: { lockedFields: ['colour'] } })
  assert.equal(res.json.error.message, 'รายการฟิลด์ที่ล็อกไม่ถูกต้อง')
  res = await call('POST', `/api/admin/place-sync/places/${UUID}/sync`, { body: { fields: ['colour'] } })
  assert.equal(res.json.error.message, 'ฟิลด์ที่เลือกไม่ถูกต้อง')
  res = await call('POST', `/api/admin/place-sync/places/${UUID}/diff/name`, { body: { action: 'maybe' } })
  assert.equal(res.json.error.message, 'การกระทำไม่ถูกต้อง')

  res = await call('GET', '/api/admin/place-import/search?q=a')
  assert.equal(res.json.error.message, 'กรุณาพิมพ์คำค้นอย่างน้อย 2 ตัวอักษร')
  // No API key in tests: the request stops at 503 instead of reaching Google.
  res = await call('GET', '/api/admin/place-import/search?q=คาเฟ่')
  assert.equal(res.status, 503)
  assert.equal(res.json.error.message, 'ยังไม่ได้ตั้งค่า GOOGLE_PLACES_API_KEY บนเซิร์ฟเวอร์')

  res = await call('POST', '/api/admin/place-sync/preview', { body: { scope: 'all' } })
  assert.equal(res.status, 200)
  assert.equal(res.json.needsConfirm, true)
})

// ------------------------------------------------------------------ places users asked for (chat's Google fallback)
test('place-candidates: admin only', async () => {
  const res = await call('GET', '/api/admin/place-candidates')
  assert.equal(res.status, 403)
})

test('place-candidates: list is mapped and ordered by how often it was asked', async () => {
  as(admin)
  h.fakeDb.on(/^select \* from "place_candidates"/, [{
    google_place_id: 'g1', name: 'บ้านสวนกลางนา', address: 'อำเภอ พระยืน ขอนแก่น', area_query: 'พระยืน',
    category: 'ร้านอาหาร', rating: '4.7', review_count: 24, maps_url: 'https://maps.google.com/?cid=1',
    ask_count: 5, status: 'pending',
  }])
  const res = await call('GET', '/api/admin/place-candidates?status=pending')
  assert.equal(res.status, 200)
  assert.deepEqual(
    { name: res.json.data[0].name, rating: res.json.data[0].rating, askCount: res.json.data[0].askCount, areaQuery: res.json.data[0].areaQuery },
    { name: 'บ้านสวนกลางนา', rating: 4.7, askCount: 5, areaQuery: 'พระยืน' },
  )
  const list = h.fakeDb.queries.find((q) => /^select \* from "place_candidates"/.test(q.sql))
  assert.match(list.sql, /order by "ask_count" desc/)
})

test('place-candidates: import guards run before any Google call', async () => {
  as(admin)
  let res = await call('POST', '/api/admin/place-candidates/nope/import')
  assert.equal(res.status, 404)

  h.fakeDb.on(/from "place_candidates"/, [{ google_place_id: 'g1', status: 'imported', ask_count: 2 }])
  res = await call('POST', '/api/admin/place-candidates/g1/import')
  assert.equal(res.status, 409)

  // No API key in tests: a real import stops at 503 instead of reaching Google,
  // and the candidate is not marked imported.
  as(admin)
  h.fakeDb.on(/from "place_candidates"/, [{ google_place_id: 'g1', status: 'pending', ask_count: 2 }])
  res = await call('POST', '/api/admin/place-candidates/g1/import')
  assert.equal(res.status, 503)
  assert.ok(!h.fakeDb.queries.some((q) => /^update "place_candidates"/.test(q.sql)))
})

test('place-candidates: dismiss only a pending one', async () => {
  as(admin)
  let res = await call('POST', '/api/admin/place-candidates/g1/dismiss')
  assert.equal(res.status, 404)
  h.fakeDb.on(/^update "place_candidates"/, { command: 'UPDATE', rows: [], rowCount: 1 })
  res = await call('POST', '/api/admin/place-candidates/g1/dismiss')
  assert.equal(res.status, 200)
})

test('admin: cost estimates need no DB and give per-click baht figures', async () => {
  as(admin)
  const res = await call('GET', '/api/admin/cost-estimates')
  assert.equal(res.status, 200)
  for (const k of ['syncPerPlaceThb', 'importPerPlaceThb', 'describePerPlaceThb', 'textSearchThb', 'nearbySearchThb']) {
    assert.equal(typeof res.json[k], 'number', k)
    assert.ok(res.json[k] >= 0, k)
  }
  assert.ok(res.json.importPerPlaceThb > res.json.syncPerPlaceThb) // details+atmosphere+photos vs details only
})

test('admin: auto-sync settings are validated before anything is saved', async () => {
  as(admin)
  let res = await call('PUT', '/api/admin/place-auto-sync', { body: { runHour: 99 } })
  assert.equal(res.status, 400)
  res = await call('PUT', '/api/admin/place-auto-sync', { body: { monthlyCallCap: '900' } })
  assert.equal(res.status, 400)
  res = await call('PUT', '/api/admin/place-auto-sync', { body: {} })
  assert.equal(res.status, 400)
})

test('admin: area import validates input before any Google call', async () => {
  as(admin)
  const ok = { area: 'พระลับ', radius: 3000, categories: ['cafe'] }
  let res = await call('POST', '/api/admin/place-import/area-search', { body: { ...ok, area: 'a' } })
  assert.equal(res.status, 400)
  res = await call('POST', '/api/admin/place-import/area-search', { body: { ...ok, radius: 50 } })
  assert.equal(res.status, 400)
  res = await call('POST', '/api/admin/place-import/area-search', { body: { ...ok, categories: ['spaceport'] } })
  assert.equal(res.status, 400)
  res = await call('POST', '/api/admin/place-import/area-search', { body: { ...ok, categories: [] } })
  assert.equal(res.status, 400)
  // Valid input, no API key in tests: stops at 503 instead of reaching Google.
  res = await call('POST', '/api/admin/place-import/area-search', { body: ok })
  assert.equal(res.status, 503)

  res = await call('POST', '/api/admin/place-import/batch', { body: { googlePlaceIds: [] } })
  assert.equal(res.status, 400)
  res = await call('POST', '/api/admin/place-import/batch', { body: { googlePlaceIds: Array.from({ length: 51 }, (_, i) => `g${i}`) } })
  assert.equal(res.status, 400)
  // AI descriptions cost an LLM request per place, so that option has a lower cap (20) than a plain import (50).
  res = await call('POST', '/api/admin/place-import/batch', { body: { describe: true, googlePlaceIds: Array.from({ length: 21 }, (_, i) => `g${i}`) } })
  assert.equal(res.status, 400)
  res = await call('POST', '/api/admin/place-import/publish', { body: { placeIds: [] } })
  assert.equal(res.status, 400)
  res = await call('POST', '/api/admin/place-import/publish', { body: { placeIds: ['nope'] } })
  assert.equal(res.status, 400)
  res = await call('POST', '/api/admin/place-import/publish', { body: { placeIds: Array.from({ length: 101 }, () => UUID) } })
  assert.equal(res.status, 200) // duplicates collapse to one id, which is under the cap
  res = await call('GET', '/api/admin/place-import/batch/00000000-0000-4000-8000-000000000000')
  assert.equal(res.status, 404)
  res = await call('POST', '/api/admin/place-import/batch/00000000-0000-4000-8000-000000000000/cancel')
  assert.equal(res.status, 404)
})

test('admin survey: export is CSV with a BOM; deleting a missing response 404s', async () => {
  as(admin)
  let res = await call('GET', '/api/admin/survey/export')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/csv/)
  assert.match(res.headers.get('content-disposition'), /survey-responses\.csv/)
  assert.ok(res.text.startsWith('id,submitted_at'), 'header row (BOM is stripped by fetch decoding)')
  res = await call('DELETE', `/api/admin/survey/${UUID}`)
  assert.equal(res.status, 404)
})
