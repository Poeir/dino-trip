import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { httpError } from '../middleware/errorHandler.js'
import { db } from '../lib/db.js'
import { createImageUploadMiddleware } from '../lib/imageUpload.js'
import { clearSessionCookie } from '../lib/authCookies.js'
import { revokeUserSessions, revokeOtherSessions } from '../lib/session.js'
import { assertNotLastAdmin } from '../lib/adminGuards.js'
import { toProfileResponse } from '../lib/userResponse.js'
import { rateLimit } from '../lib/rateLimit.js'
import { normalizeEmail, isValidEmail, assertPasswordStrong, readProfileFields, readAvatarFields } from '../lib/userValidation.js'
import { createEmailChangeToken, findPendingEmailChange, cancelEmailChange, consumeEmailChangeToken } from '../lib/emailChange.js'
import { sendEmailChangeEmail, sendEmailChangeNotice } from '../lib/mailer.js'

// The signed-in user's own account. Every handler works on req.user.id (set by
// requireAuth from the session cookie) -- an id is never read from the request.
export const profileRouter = Router()

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
const avatarUpload = createImageUploadMiddleware('avatarFile', 2 * 1024 * 1024)

// Password-checking and mail-sending routes get a tight per-account budget.
const sensitiveLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 })
const writeLimit = rateLimit({ windowMs: 60 * 1000, max: 30 })

const PRESET_KEY_RE = /^[a-z0-9_-]{1,50}$/

const audit = (trx, userId, action, details = {}) =>
  trx('admin_audit_log').insert({ admin_id: userId, action, target_user_id: userId, details: JSON.stringify(details) })

// Checks the account password for actions that must be confirmed by it.
// Reads the row fresh so a stale session can't act on an outdated hash.
async function assertPassword(userId, password) {
  if (!password || typeof password !== 'string') throw httpError(400, 'กรุณากรอกรหัสผ่านปัจจุบัน')
  const row = await db('users').select('password_hash').where('id', userId).first()
  if (!row || !(await bcrypt.compare(password, row.password_hash))) throw httpError(403, 'รหัสผ่านไม่ถูกต้อง')
}

// ---------------------------------------------------------------------------
// Confirming an email change: the link goes to the NEW address and may be opened
// in a browser that isn't signed in, so possession of the token is the proof.
// Registered before requireAuth on purpose.
// ---------------------------------------------------------------------------
profileRouter.post('/email/confirm', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyFn: (req) => req.ip }), asyncHandler(async (req, res) => {
  const { token } = req.body || {}
  if (!token || typeof token !== 'string') throw httpError(400, 'ลิงก์ยืนยันไม่ถูกต้อง')
  let email
  try {
    email = await db.transaction(async (trx) => {
      const record = await consumeEmailChangeToken(token, trx)
      if (!record) throw httpError(400, 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ')
      const user = await trx('users').where('id', record.user_id).forUpdate().first()
      if (!user || user.deleted_at || user.status !== 'active') throw httpError(400, 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ')
      // Someone may have registered the address since the request was made.
      const taken = await trx('users').where('email', record.new_email).whereNot('id', user.id).first()
      if (taken) throw httpError(409, 'อีเมลนี้ถูกใช้งานแล้ว')
      await trx('users').where('id', user.id).update({ email: record.new_email, email_verified: true, updated_at: new Date() })
      await audit(trx, user.id, 'user.email_change', { from: user.email, to: record.new_email })
      return record.new_email
    })
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'อีเมลนี้ถูกใช้งานแล้ว')
    throw err
  }
  res.json({ email })
}))

profileRouter.use(requireAuth)

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
profileRouter.get('/', asyncHandler(async (req, res) => {
  const id = req.user.id
  const [row, scans, redemptions, pending] = await Promise.all([
    db('users').select('*').where('id', id).first(),
    db('qr_scans').where('user_id', id).count('id as n').sum('points_awarded as pts').first(),
    db('redemptions').where({ user_id: id, status: 'completed' }).count('id as n').sum('cost as pts').first(),
    findPendingEmailChange(id),
  ])
  res.json({
    ...toProfileResponse(row),
    stats: {
      scans: Number(scans.n), pointsEarned: Number(scans.pts || 0),
      redemptions: Number(redemptions.n), pointsSpent: Number(redemptions.pts || 0),
    },
    pendingEmail: pending ? pending.new_email : null,
  })
}))

// One timeline of everything that moved the balance. Manual adjustments show the
// reason but never who made them.
const HISTORY_SQL = `
  select * from (
    select cast('scan' as text) as type, s.id, s.scanned_at as at, s.points_awarded as delta,
           coalesce(p.name, '(สถานที่ถูกลบแล้ว)') as title, cast(null as text) as note, cast(null as text) as status
    from qr_scans s
    left join qrs q on q.id = s.qr_id
    left join places p on p.id = q.place_id
    where s.user_id = :userId
    union all
    select cast('redeem' as text), r.id, r.redeemed_at, -r.cost,
           coalesce(r.reward_name, w.name, '(ของรางวัลถูกลบแล้ว)'), r.cancel_reason, r.status
    from redemptions r
    left join rewards w on w.id = r.reward_id
    where r.user_id = :userId
    union all
    select cast('adjust' as text), a.id, a.created_at, a.delta,
           'ปรับแต้มโดยผู้ดูแลระบบ', a.reason, cast(null as text)
    from points_adjustments a
    where a.user_id = :userId
  ) h
  where (:type = 'all' or h.type = :type)`

profileRouter.get('/history', asyncHandler(async (req, res) => {
  const type = ['scan', 'redeem', 'adjust'].includes(req.query.type) ? req.query.type : 'all'
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const bindings = { userId: req.user.id, type }
  const [{ rows }, { rows: [{ n }] }] = await Promise.all([
    db.raw(`${HISTORY_SQL} order by h.at desc, h.id limit :limit offset :offset`, { ...bindings, limit: pageSize, offset: (page - 1) * pageSize }),
    db.raw(`select cast(count(*) as integer) as n from (${HISTORY_SQL}) c`, bindings),
  ])
  res.json({
    data: rows.map((r) => ({ id: `${r.type}:${r.id}`, type: r.type, at: r.at, delta: r.delta, title: r.title, note: r.note, status: r.status })),
    total: n, page, pageSize, totalPages: Math.ceil(n / pageSize),
  })
}))

// ---------------------------------------------------------------------------
// Personal details
// ---------------------------------------------------------------------------
// Only the fields readProfileFields() returns can change here -- role, points,
// status and email are deliberately not reachable from this route.
profileRouter.patch('/', writeLimit, asyncHandler(async (req, res) => {
  const f = readProfileFields(req.body)
  const [row] = await db('users').where('id', req.user.id).update({
    title: f.title, first_name: f.firstName, last_name: f.lastName,
    display_name: `${f.firstName} ${f.lastName}`.trim(),
    phone: f.phone, gender: f.gender, province: f.province, district: f.district, subdistrict: f.subdistrict,
    birthdate: f.birthdate, occupation: f.occupation, updated_at: new Date(),
  }).returning('*')
  res.json(toProfileResponse(row))
}))

// ---------------------------------------------------------------------------
// Avatar: a preset OR an uploaded photo -- setting one clears the other.
// ---------------------------------------------------------------------------
profileRouter.put('/avatar', writeLimit, avatarUpload, asyncHandler(async (req, res) => {
  const avatar = readAvatarFields(req.body)
  let patch
  if (req.file) {
    patch = {
      avatar_preset: null, avatar_data: req.file.buffer, avatar_mime: req.file.mimetype,
      avatar_position: avatar.position, avatar_scale: avatar.scale,
    }
  } else if (avatar.preset) {
    if (!PRESET_KEY_RE.test(avatar.preset)) throw httpError(400, 'avatarUrl ไม่ถูกต้อง')
    patch = { avatar_preset: avatar.preset, avatar_data: null, avatar_mime: null, avatar_position: null, avatar_scale: null }
  } else {
    throw httpError(400, 'กรุณาเลือกรูปโปรไฟล์')
  }
  const [row] = await db('users').where('id', req.user.id).update({ ...patch, avatar_updated_at: new Date(), updated_at: new Date() }).returning('*')
  res.json(toProfileResponse(row))
}))

profileRouter.delete('/avatar', writeLimit, asyncHandler(async (req, res) => {
  const [row] = await db('users').where('id', req.user.id).update({
    avatar_preset: null, avatar_data: null, avatar_mime: null, avatar_position: null, avatar_scale: null,
    avatar_updated_at: new Date(), updated_at: new Date(),
  }).returning('*')
  res.json(toProfileResponse(row))
}))

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------
profileRouter.post('/password', sensitiveLimit, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {}
  await assertPassword(req.user.id, currentPassword)
  if (typeof newPassword !== 'string') throw httpError(400, 'กรุณากรอกรหัสผ่านใหม่')
  assertPasswordStrong(newPassword)
  if (newPassword === currentPassword) throw httpError(400, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม')

  const passwordHash = await bcrypt.hash(newPassword, 10)
  await db.transaction(async (trx) => {
    await trx('users').where('id', req.user.id).update({ password_hash: passwordHash, password_changed_at: new Date(), updated_at: new Date() })
    // Anyone else holding a session (a lost phone, a shared computer) is signed out.
    await revokeOtherSessions(req.user.id, req.cookies?.session_token, trx)
    await trx('password_reset_tokens').where('user_id', req.user.id).delete()
    await audit(trx, req.user.id, 'user.password_change')
  })
  res.json({ ok: true })
}))

// ---------------------------------------------------------------------------
// Email change: request -> link to the new address -> POST /email/confirm above
// ---------------------------------------------------------------------------
profileRouter.post('/email', sensitiveLimit, asyncHandler(async (req, res) => {
  const { password } = req.body || {}
  const newEmail = normalizeEmail(req.body?.email)
  if (!newEmail || !isValidEmail(newEmail)) throw httpError(400, 'กรุณากรอกอีเมลให้ถูกต้อง')
  await assertPassword(req.user.id, password)
  if (newEmail === req.user.email) throw httpError(400, 'อีเมลนี้เป็นอีเมลปัจจุบันของคุณอยู่แล้ว')
  // Includes soft-deleted accounts: their address stays reserved.
  if (await db('users').where('email', newEmail).first()) throw httpError(400, 'อีเมลนี้ถูกใช้งานแล้ว')

  const rawToken = await createEmailChangeToken(req.user.id, newEmail)
  await sendEmailChangeEmail(newEmail, `${FRONTEND_ORIGIN}/confirm-email-change?token=${rawToken}`)
  // Best effort: the owner's current mailbox learns a change was requested.
  sendEmailChangeNotice(req.user.email, newEmail, `${FRONTEND_ORIGIN}/forgot-password`).catch((err) => console.error(err))
  res.json({ pendingEmail: newEmail })
}))

profileRouter.delete('/email', writeLimit, asyncHandler(async (req, res) => {
  await cancelEmailChange(req.user.id)
  res.status(204).end()
}))

// ---------------------------------------------------------------------------
// Delete my account: soft delete, same as an admin deleting it -- the row and
// its points history stay and the address stays reserved.
// ---------------------------------------------------------------------------
profileRouter.delete('/', sensitiveLimit, asyncHandler(async (req, res) => {
  await assertPassword(req.user.id, req.body?.password)
  await db.transaction(async (trx) => {
    const target = await trx('users').where('id', req.user.id).forUpdate().first()
    if (!target || target.deleted_at) throw httpError(409, 'บัญชีนี้ถูกลบแล้ว')
    await assertNotLastAdmin(trx, target)
    await trx('users').where('id', target.id).update({ deleted_at: new Date(), deleted_by: target.id })
    await revokeUserSessions(target.id, trx)
    await trx('password_reset_tokens').where('user_id', target.id).delete()
    await trx('email_verification_tokens').where('user_id', target.id).delete()
    await trx('email_change_tokens').where('user_id', target.id).delete()
    await audit(trx, target.id, 'user.self_delete')
  })
  clearSessionCookie(res)
  res.status(204).end()
}))
