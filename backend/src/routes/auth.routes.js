import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { db } from '../lib/db.js'
import { createImageUploadMiddleware } from '../lib/imageUpload.js'
import { setSessionCookie, clearSessionCookie } from '../lib/authCookies.js'
import { createSession, resolveSessionUser, destroySession } from '../lib/session.js'
import { createVerificationToken, findVerificationToken } from '../lib/emailVerification.js'
import { createPasswordResetToken, consumePasswordResetToken } from '../lib/passwordReset.js'
import { sendVerificationEmail, sendPasswordResetEmail } from '../lib/mailer.js'

export const authRouter = Router()

const avatarUpload = createImageUploadMiddleware(2 * 1024 * 1024)

const AVATAR_POSITION_RE = /^\d{1,3}% \d{1,3}%$/

const toUserResponse = (row) => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name || row.email.split('@')[0],
  phone: row.phone || null,
  title: row.title || null,
  avatarUrl: row.avatar_preset ? `preset:${row.avatar_preset}` : (row.avatar_data ? `/api/users/${row.id}/avatar` : null),
  avatarPosition: row.avatar_position || null,
  avatarScale: row.avatar_scale ?? null,
  role: row.role || 'tourist',
})

// Thai mobile numbers: 10 digits starting with 0 (e.g. 0812345678). This is
// a profile field for staff to look accounts up by at the redemption
// counter (UC-08), not a login credential, so it doesn't need to handle
// international formats the way a phone-based login would.
const THAI_PHONE_RE = /^0\d{9}$/

// Mirrors PASSWORD_RULES in AppContext.jsx -- the client shows this checklist
// live as the visitor types, but the server re-checks it too since a client
// check alone isn't a real boundary.
const PASSWORD_RULES = [
  { test: (p) => p.length >= 8, message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' },
  { test: (p) => /[A-Z]/.test(p), message: 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่ (A-Z) อย่างน้อย 1 ตัว' },
  { test: (p) => /[a-z]/.test(p), message: 'รหัสผ่านต้องมีตัวพิมพ์เล็ก (a-z) อย่างน้อย 1 ตัว' },
  { test: (p) => /[0-9]/.test(p), message: 'รหัสผ่านต้องมีตัวเลข (0-9) อย่างน้อย 1 ตัว' },
]

const TITLE_VALUES = ['mr', 'mrs', 'miss']
const GENDER_VALUES = ['male', 'female', 'unspecified']
const OCCUPATION_VALUES = [
  'student', 'government', 'private_employee', 'business_owner',
  'farmer', 'freelance', 'homemaker', 'retired', 'unemployed', 'other',
]

// Reuses the app's one existing "frontend base URL" concept (see cors() in
// app.js) instead of a new env var -- needed to build an absolute link back
// to ConfirmEmailPage.jsx for the confirmation email below.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

// multipart/form-data so the picked photo's bytes can ride in the same
// request as the rest of the form -- there's no account row to attach an
// uploaded image to until this request creates one, so (unlike the old
// Supabase-Storage version) there's no separate pre-signup upload step.
authRouter.post('/signup', avatarUpload, asyncHandler(async (req, res) => {
  const { title, firstName, lastName, email, password, phone, gender, province, district, subdistrict, birthdate, occupation, avatarUrl, avatarPosition, avatarScale } = req.body
  if (!title || !firstName || !lastName || !email || !password || !phone || !gender || !province || !district || !subdistrict || !birthdate || !occupation) {
    throw httpError(400, 'กรุณากรอกข้อมูลให้ครบถ้วน')
  }
  if (!TITLE_VALUES.includes(title)) throw httpError(400, 'กรุณาเลือกคำนำหน้าให้ถูกต้อง')
  if (!THAI_PHONE_RE.test(phone)) throw httpError(400, 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (10 หลัก ขึ้นต้นด้วย 0)')
  const failedPasswordRule = PASSWORD_RULES.find((r) => !r.test(password))
  if (failedPasswordRule) throw httpError(400, failedPasswordRule.message)
  if (!GENDER_VALUES.includes(gender)) throw httpError(400, 'กรุณาเลือกเพศให้ถูกต้อง')
  if (!OCCUPATION_VALUES.includes(occupation)) throw httpError(400, 'กรุณาเลือกอาชีพให้ถูกต้อง')
  if (Number.isNaN(Date.parse(birthdate)) || new Date(birthdate) > new Date()) throw httpError(400, 'กรุณากรอกวันเกิดให้ถูกต้อง')
  // avatarUrl is optional -- "preset:<key>" picked from the built-in set
  // (see PERSONA_AVATARS in AppContext.jsx). An uploaded photo comes
  // through req.file instead (see avatarUpload above), not this field.
  // avatarPosition ("X% Y%", CSS object-position) and avatarScale (zoom,
  // 1-3) only apply to an uploaded photo -- multer puts them in req.body
  // as plain strings even though avatarScale is numeric on the wire.
  if (avatarUrl != null && (typeof avatarUrl !== 'string' || avatarUrl.length > 500)) throw httpError(400, 'avatarUrl ไม่ถูกต้อง')
  if (avatarPosition != null && !AVATAR_POSITION_RE.test(avatarPosition)) throw httpError(400, 'avatarPosition ไม่ถูกต้อง')
  const avatarScaleNum = avatarScale != null ? Number(avatarScale) : null
  if (avatarScaleNum != null && (Number.isNaN(avatarScaleNum) || avatarScaleNum < 1 || avatarScaleNum > 3)) throw httpError(400, 'avatarScale ไม่ถูกต้อง')

  const existing = await db('users').where('email', email).first()
  if (existing) throw httpError(400, 'อีเมลนี้ถูกใช้งานแล้ว')

  const displayName = `${firstName} ${lastName}`.trim()
  const passwordHash = await bcrypt.hash(password, 10)
  const avatarPreset = avatarUrl?.startsWith('preset:') ? avatarUrl.slice('preset:'.length) : null

  const [user] = await db('users').insert({
    email, password_hash: passwordHash, display_name: displayName, phone, title,
    first_name: firstName, last_name: lastName, gender, province, district, subdistrict, birthdate, occupation,
    avatar_preset: avatarPreset,
    avatar_data: req.file ? req.file.buffer : null,
    avatar_mime: req.file ? req.file.mimetype : null,
    avatar_position: req.file ? avatarPosition || null : null,
    avatar_scale: req.file ? avatarScaleNum : null,
  }).returning(['id', 'email'])

  const rawToken = await createVerificationToken(user.id)
  await sendVerificationEmail(user.email, `${FRONTEND_ORIGIN}/confirm?token=${rawToken}`)
  res.status(201).json({ pendingConfirmation: true, email: user.email })
}))

// Landing point for our own confirmation email link (see sendVerificationEmail
// above) -- ConfirmEmailPage.jsx reads ?token= from the URL and posts it here.
authRouter.post('/confirm', asyncHandler(async (req, res) => {
  const { token } = req.body
  if (!token) throw httpError(400, 'ลิงก์ยืนยันไม่ถูกต้อง')
  const record = await findVerificationToken(token)
  if (!record) throw httpError(400, 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ')

  const [row] = await db('users').where('id', record.user_id).update({ email_verified: true }).returning('*')
  if (!row) throw httpError(400, 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ')

  const rawToken = await createSession(row.id)
  setSessionCookie(res, rawToken)
  res.json({ user: toUserResponse(row) })
}))

authRouter.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) throw httpError(400, 'กรุณากรอกอีเมลและรหัสผ่าน')

  const row = await db('users').where('email', email).first()
  const passwordOk = row && await bcrypt.compare(password, row.password_hash)
  if (!passwordOk) throw httpError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง')

  if (!row.email_verified) throw httpError(403, 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ กรุณาตรวจสอบกล่องจดหมายของคุณ')

  const rawToken = await createSession(row.id)
  setSessionCookie(res, rawToken)
  res.json({ user: toUserResponse(row) })
}))

authRouter.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body
  if (!email) throw httpError(400, 'กรุณากรอกอีเมล')

  const user = await db('users').where('email', email).first()
  if (user) {
    const rawToken = await createPasswordResetToken(user.id)
    await sendPasswordResetEmail(user.email, `${FRONTEND_ORIGIN}/reset-password?token=${rawToken}`)
  }
  // Same response whether or not the email exists -- otherwise this endpoint
  // becomes an account-enumeration oracle.
  res.json({ message: 'หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปให้แล้ว' })
}))

authRouter.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, password } = req.body
  if (!token) throw httpError(400, 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง')
  const failedRule = PASSWORD_RULES.find((r) => !r.test(password || ''))
  if (failedRule) throw httpError(400, failedRule.message)

  const record = await consumePasswordResetToken(token)
  if (!record) throw httpError(400, 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุ')

  const passwordHash = await bcrypt.hash(password, 10)
  // A successful reset proves mailbox ownership, same proof /confirm relies
  // on -- and any session that isn't the one about to be created here should
  // not survive a password reset.
  const [row] = await db('users').where('id', record.user_id).update({ password_hash: passwordHash, email_verified: true }).returning('*')
  await db('sessions').where('user_id', record.user_id).delete()

  const rawToken = await createSession(row.id)
  setSessionCookie(res, rawToken)
  res.json({ user: toUserResponse(row) })
}))

authRouter.post('/logout', asyncHandler(async (req, res) => {
  await destroySession(req.cookies?.session_token)
  clearSessionCookie(res)
  res.status(204).end()
}))

authRouter.get('/me', asyncHandler(async (req, res) => {
  const user = await resolveSessionUser(req, res)
  res.json({ user: user ? toUserResponse(user) : null })
}))
