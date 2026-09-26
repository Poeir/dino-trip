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
import { toUserResponse } from '../lib/userResponse.js'
import { normalizeEmail, isValidEmail, assertPasswordStrong, readProfileFields, readAvatarFields } from '../lib/userValidation.js'

export const authRouter = Router()

const avatarUpload = createImageUploadMiddleware('avatarFile', 2 * 1024 * 1024)

const SUSPENDED_MESSAGE = 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ'
const isDeleted = (row) => !!row.deleted_at

// Reuses the app's one existing "frontend base URL" concept (see cors() in
// app.js) instead of a new env var -- needed to build an absolute link back
// to ConfirmEmailPage.jsx for the confirmation email below.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

// multipart/form-data so the picked photo's bytes can ride in the same
// request as the rest of the form -- there's no account row to attach an
// uploaded image to until this request creates one, so (unlike the old
// Supabase-Storage version) there's no separate pre-signup upload step.
authRouter.post('/signup', avatarUpload, asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email)
  const password = req.body.password
  if (!email || !password) throw httpError(400, 'กรุณากรอกข้อมูลให้ครบถ้วน')
  if (!isValidEmail(email)) throw httpError(400, 'กรุณากรอกอีเมลให้ถูกต้อง')
  const { title, firstName, lastName, phone, gender, province, district, subdistrict, birthdate, occupation } = readProfileFields(req.body)
  assertPasswordStrong(password)
  const avatar = readAvatarFields(req.body)

  // Includes soft-deleted accounts on purpose: their address stays reserved.
  const existing = await db('users').where('email', email).first()
  if (existing) throw httpError(400, 'อีเมลนี้ถูกใช้งานแล้ว')

  const displayName = `${firstName} ${lastName}`.trim()
  const passwordHash = await bcrypt.hash(password, 10)

  let user
  try {
    ;[user] = await db('users').insert({
      email, password_hash: passwordHash, display_name: displayName, phone, title,
      first_name: firstName, last_name: lastName, gender, province, district, subdistrict, birthdate, occupation,
      avatar_preset: avatar.preset,
      avatar_data: req.file ? req.file.buffer : null,
      avatar_mime: req.file ? req.file.mimetype : null,
      avatar_position: req.file ? avatar.position : null,
      avatar_scale: req.file ? avatar.scale : null,
    }).returning(['id', 'email'])
  } catch (err) {
    // Two signups for the same address racing past the check above.
    if (err.code === '23505') throw httpError(400, 'อีเมลนี้ถูกใช้งานแล้ว')
    throw err
  }

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

  const current = await db('users').where('id', record.user_id).first()
  if (!current || isDeleted(current)) throw httpError(400, 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ')
  if (current.status !== 'active') throw httpError(403, SUSPENDED_MESSAGE)

  const [row] = await db('users').where('id', record.user_id).update({ email_verified: true, last_login_at: new Date() }).returning('*')

  const rawToken = await createSession(row.id)
  setSessionCookie(res, rawToken)
  res.json({ user: toUserResponse(row) })
}))

authRouter.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) throw httpError(400, 'กรุณากรอกอีเมลและรหัสผ่าน')

  const row = await db('users').where('email', normalizeEmail(email)).first()
  const passwordOk = row && await bcrypt.compare(password, row.password_hash)
  // A soft-deleted account answers exactly like a wrong password, so login
  // can't be used to learn that an address once had an account.
  if (!passwordOk || isDeleted(row)) throw httpError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง')

  // Only reached with the right password, so this tells the owner what
  // happened without revealing anything to someone guessing addresses.
  if (row.status !== 'active') throw httpError(403, SUSPENDED_MESSAGE)

  if (!row.email_verified) throw httpError(403, 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ กรุณาตรวจสอบกล่องจดหมายของคุณ')

  await db('users').where('id', row.id).update({ last_login_at: new Date() })
  const rawToken = await createSession(row.id)
  setSessionCookie(res, rawToken)
  res.json({ user: toUserResponse(row) })
}))

authRouter.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body
  if (!email) throw httpError(400, 'กรุณากรอกอีเมล')

  const user = await db('users').where('email', normalizeEmail(email)).first()
  // Suspended/deleted accounts get no reset mail (same response either way).
  if (user && !isDeleted(user) && user.status === 'active') {
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
  assertPasswordStrong(password)

  const record = await consumePasswordResetToken(token)
  if (!record) throw httpError(400, 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุ')

  // The link may have been issued before the account was suspended or deleted.
  const current = await db('users').where('id', record.user_id).first()
  if (!current || isDeleted(current)) throw httpError(400, 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุ')
  if (current.status !== 'active') throw httpError(403, SUSPENDED_MESSAGE)

  const passwordHash = await bcrypt.hash(password, 10)
  // A successful reset proves mailbox ownership, same proof /confirm relies
  // on -- and any session that isn't the one about to be created here should
  // not survive a password reset.
  const [row] = await db('users').where('id', record.user_id).update({ password_hash: passwordHash, email_verified: true, last_login_at: new Date() }).returning('*')
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
