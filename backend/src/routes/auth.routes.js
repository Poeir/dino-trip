import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { createAuthClient } from '../lib/supabaseAuthClient.js'
import { supabase } from '../lib/supabaseClient.js'
import { setSessionCookies, clearSessionCookies } from '../lib/authCookies.js'
import { resolveSessionUser } from '../lib/session.js'

export const authRouter = Router()

const toUserResponse = (user, role) => ({
  id: user.id,
  email: user.email,
  displayName: user.user_metadata?.display_name || user.email.split('@')[0],
  phone: user.user_metadata?.phone || null,
  role: role || 'tourist',
})

// users.role isn't in the Supabase Auth user object (auth.users) -- it lives
// on the app's own `users` profile row, so every response that includes a
// user has to look it up separately via the service-role client.
const fetchRole = async (userId) => {
  const { data } = await supabase.from('users').select('role').eq('id', userId).single()
  return data?.role
}

// Thai mobile numbers: 10 digits starting with 0 (e.g. 0812345678). This is
// a profile field for staff to look accounts up by at the redemption
// counter (UC-08), not a login credential, so it doesn't need to handle
// international formats the way a phone-based login would.
const THAI_PHONE_RE = /^0\d{9}$/

authRouter.post('/signup', asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body
  if (!name || !email || !password || !phone) throw httpError(400, 'กรุณากรอกข้อมูลให้ครบถ้วน')
  if (!THAI_PHONE_RE.test(phone)) throw httpError(400, 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (10 หลัก ขึ้นต้นด้วย 0)')

  const { data, error } = await createAuthClient().auth.signUp({
    email, password, options: { data: { display_name: name, phone } },
  })
  if (error) throw httpError(400, error.message === 'User already registered' ? 'อีเมลนี้ถูกใช้งานแล้ว' : error.message)
  // Only null if email confirmation is required -- confirm-email is off for
  // this project, but stay correct if that ever changes.
  if (!data.session) throw httpError(400, 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ')

  setSessionCookies(res, data.session)
  res.status(201).json({ user: toUserResponse(data.user, await fetchRole(data.user.id)) })
}))

authRouter.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) throw httpError(400, 'กรุณากรอกอีเมลและรหัสผ่าน')

  const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password })
  if (error) throw httpError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง')

  setSessionCookies(res, data.session)
  res.json({ user: toUserResponse(data.user, await fetchRole(data.user.id)) })
}))

authRouter.post('/logout', asyncHandler(async (req, res) => {
  const token = req.cookies?.sb_access_token
  if (token) {
    // Revoke via the admin API with the explicit token from this request's
    // cookie (not a shared client's ambient session -- see
    // supabaseAuthClient.js). Best-effort: cookies get cleared below
    // regardless, so an already-expired token shouldn't block logout.
    await supabase.auth.admin.signOut(token).catch(() => {})
  }
  clearSessionCookies(res)
  res.status(204).end()
}))

authRouter.get('/me', asyncHandler(async (req, res) => {
  const user = await resolveSessionUser(req, res)
  res.json({ user: user ? toUserResponse(user, await fetchRole(user.id)) : null })
}))
