import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { db } from '../lib/db.js'
import { revokeUserSessions } from '../lib/session.js'
import { assertNotLastAdmin } from '../lib/adminGuards.js'
import { createVerificationToken } from '../lib/emailVerification.js'
import { sendVerificationEmail } from '../lib/mailer.js'

// Admin-only account management. Everything here goes through requireAdmin,
// and every change that touches an account writes admin_audit_log.
export const adminUsersRouter = Router()
adminUsersRouter.use(requireAdmin)

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

const LIST_COLUMNS = [
  'id', 'email', 'display_name', 'first_name', 'last_name', 'phone', 'role', 'status', 'status_reason',
  'email_verified', 'points_balance', 'created_at', 'last_login_at', 'deleted_at',
  'avatar_preset', 'avatar_position', 'avatar_scale', db.raw('avatar_data is not null as has_avatar'),
]

// Column names here are interpolated into ORDER BY, so only these keys ever
// reach the query.
const SORT_COLUMNS = { created: 'created_at', name: 'display_name', points: 'points_balance', lastLogin: 'last_login_at' }

const toListRow = (r) => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name || r.email.split('@')[0],
  firstName: r.first_name,
  lastName: r.last_name,
  phone: r.phone,
  role: r.role,
  status: r.status,
  statusReason: r.status_reason,
  emailVerified: r.email_verified,
  pointsBalance: r.points_balance,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
  deletedAt: r.deleted_at,
  // An uploaded photo is served by the public avatar endpoint, which 404s for
  // soft-deleted accounts -- so those fall back to the initial in the UI.
  avatarUrl: r.avatar_preset ? `preset:${r.avatar_preset}` : (r.has_avatar && !r.deleted_at ? `/api/users/${r.id}/avatar` : null),
  avatarPosition: r.avatar_position || null,
  avatarScale: r.avatar_scale != null ? Number(r.avatar_scale) : null,
})

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&')

// 'visible' (the default) hides soft-deleted accounts; 'all' shows everything.
function applyFilters(query, q) {
  const status = q.status || 'visible'
  if (status === 'active') query.where('status', 'active').whereNull('deleted_at')
  else if (status === 'suspended') query.where('status', 'suspended').whereNull('deleted_at')
  else if (status === 'deleted') query.whereNotNull('deleted_at')
  else if (status === 'visible') query.whereNull('deleted_at')

  if (q.role === 'admin' || q.role === 'tourist') query.where('role', q.role)
  if (q.verified === 'true' || q.verified === 'false') query.where('email_verified', q.verified === 'true')

  const search = String(q.search || '').trim()
  if (search) {
    const term = `%${escapeLike(search)}%`
    query.where((b) => {
      for (const col of ['email', 'display_name', 'first_name', 'last_name', 'phone']) b.orWhereILike(col, term)
    })
  }
  return query
}

adminUsersRouter.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const sortColumn = SORT_COLUMNS[req.query.sort] || SORT_COLUMNS.created
  const sortDir = req.query.dir === 'asc' ? 'asc' : 'desc'

  const [{ c: total }, rows] = await Promise.all([
    applyFilters(db('users'), req.query).count('id as c').first(),
    applyFilters(db('users').select(LIST_COLUMNS), req.query)
      .orderByRaw(`${sortColumn} ${sortDir} nulls last, id`)
      .limit(pageSize).offset((page - 1) * pageSize),
  ])
  res.json({ data: rows.map(toListRow), total: Number(total), page, pageSize, totalPages: Math.ceil(Number(total) / pageSize) })
}))

adminUsersRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const user = await db('users')
    .select(
      'id', 'email', 'title', 'first_name', 'last_name', 'display_name', 'phone', 'gender', 'province', 'district',
      'subdistrict', 'birthdate', 'occupation', 'role', 'status', 'status_reason', 'status_changed_at',
      'status_changed_by', 'deleted_at', 'deleted_by', 'email_verified', 'points_balance', 'created_at',
      'last_login_at', 'avatar_preset', 'avatar_position', 'avatar_scale', db.raw('avatar_data is not null as has_avatar'),
    )
    .where('id', id).first()
  if (!user) throw httpError(404, 'ไม่พบผู้ใช้')

  const [scans, redemptions, adjustments, audit, scanTotals, redemptionTotals, people] = await Promise.all([
    db('qr_scans as s').leftJoin('qrs as q', 'q.id', 's.qr_id').leftJoin('places as p', 'p.id', 'q.place_id')
      .select('s.id', 's.points_awarded', 's.scanned_at', 'p.name as place_name')
      .where('s.user_id', id).orderBy('s.scanned_at', 'desc').limit(50),
    db('redemptions as r').leftJoin('rewards as w', 'w.id', 'r.reward_id')
      .select('r.id', 'r.cost', 'r.redeemed_at', 'r.status', db.raw('coalesce(r.reward_name, w.name) as reward_name'))
      .where('r.user_id', id).orderBy('r.redeemed_at', 'desc').limit(50),
    db('points_adjustments as a').leftJoin('users as u', 'u.id', 'a.admin_id')
      .select('a.id', 'a.delta', 'a.balance_after', 'a.reason', 'a.created_at', 'u.display_name as admin_name', 'u.email as admin_email')
      .where('a.user_id', id).orderBy('a.created_at', 'desc').limit(50),
    db('admin_audit_log as l').leftJoin('users as u', 'u.id', 'l.admin_id')
      .select('l.id', 'l.action', 'l.details', 'l.created_at', 'u.display_name as admin_name', 'u.email as admin_email')
      .where('l.target_user_id', id).orderBy('l.created_at', 'desc').limit(30),
    db('qr_scans').where('user_id', id).count('id as n').sum('points_awarded as pts').first(),
    db('redemptions').where('user_id', id).count('id as n').sum('cost as pts').first(),
    db('users').select('id', 'display_name', 'email').whereIn('id', [user.status_changed_by, user.deleted_by].filter(Boolean)),
  ])
  const nameOf = (uid) => {
    const p = people.find((x) => x.id === uid)
    return p ? (p.display_name || p.email) : null
  }
  const adminLabel = (r) => r.admin_name || r.admin_email || null

  res.json({
    ...toListRow(user),
    title: user.title,
    gender: user.gender,
    province: user.province,
    district: user.district,
    subdistrict: user.subdistrict,
    birthdate: user.birthdate,
    occupation: user.occupation,
    statusChangedAt: user.status_changed_at,
    statusChangedByName: nameOf(user.status_changed_by),
    deletedByName: nameOf(user.deleted_by),
    totals: {
      scans: Number(scanTotals.n), pointsEarned: Number(scanTotals.pts || 0),
      redemptions: Number(redemptionTotals.n), pointsSpent: Number(redemptionTotals.pts || 0),
    },
    scans: scans.map((s) => ({ id: s.id, placeName: s.place_name || '(สถานที่ถูกลบแล้ว)', points: s.points_awarded, at: s.scanned_at })),
    redemptions: redemptions.map((r) => ({ id: r.id, rewardName: r.reward_name || '(ของรางวัลถูกลบแล้ว)', cost: r.cost, at: r.redeemed_at, status: r.status })),
    adjustments: adjustments.map((a) => ({ id: a.id, delta: a.delta, balanceAfter: a.balance_after, reason: a.reason, at: a.created_at, adminName: adminLabel(a) })),
    audit: audit.map((l) => ({ id: l.id, action: l.action, details: l.details, at: l.created_at, adminName: adminLabel(l) })),
  })
}))

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

const readReason = (req, { required }) => {
  const reason = String(req.body?.reason ?? '').trim()
  if (required && !reason) throw httpError(400, 'กรุณาระบุเหตุผล')
  if (reason.length > 500) throw httpError(400, 'เหตุผลยาวเกินไป (ไม่เกิน 500 ตัวอักษร)')
  return reason
}

const logAction = (trx, adminId, action, targetId, details = {}) =>
  trx('admin_audit_log').insert({ admin_id: adminId, action, target_user_id: targetId, details: JSON.stringify(details) })

async function lockUser(trx, id) {
  const target = await trx('users').where('id', id).forUpdate().first()
  if (!target) throw httpError(404, 'ไม่พบผู้ใช้')
  return target
}

const assertNotSelf = (req, target, message) => {
  if (target.id === req.user.id) throw httpError(400, message)
}

async function respondWithUser(res, id) {
  const row = await db('users').select(LIST_COLUMNS).where('id', id).first()
  res.json(toListRow(row))
}

adminUsersRouter.post('/:id/suspend', asyncHandler(async (req, res) => {
  const reason = readReason(req, { required: true })
  await db.transaction(async (trx) => {
    const target = await lockUser(trx, req.params.id)
    if (target.deleted_at) throw httpError(409, 'บัญชีนี้ถูกลบแล้ว')
    assertNotSelf(req, target, 'ไม่สามารถระงับบัญชีของตัวเองได้')
    if (target.status === 'suspended') throw httpError(409, 'บัญชีนี้ถูกระงับอยู่แล้ว')
    await assertNotLastAdmin(trx, target)
    await trx('users').where('id', target.id).update({ status: 'suspended', status_reason: reason, status_changed_at: new Date(), status_changed_by: req.user.id })
    await revokeUserSessions(target.id, trx)
    await logAction(trx, req.user.id, 'user.suspend', target.id, { reason })
  })
  await respondWithUser(res, req.params.id)
}))

adminUsersRouter.post('/:id/unsuspend', asyncHandler(async (req, res) => {
  await db.transaction(async (trx) => {
    const target = await lockUser(trx, req.params.id)
    if (target.deleted_at) throw httpError(409, 'บัญชีนี้ถูกลบแล้ว กู้คืนบัญชีก่อน')
    if (target.status !== 'suspended') throw httpError(409, 'บัญชีนี้ไม่ได้ถูกระงับ')
    await trx('users').where('id', target.id).update({ status: 'active', status_reason: null, status_changed_at: new Date(), status_changed_by: req.user.id })
    await logAction(trx, req.user.id, 'user.unsuspend', target.id)
  })
  await respondWithUser(res, req.params.id)
}))

// POST rather than DELETE so the reason can ride in the body. Soft delete only:
// the row, scans and redemptions stay, and the address stays reserved.
adminUsersRouter.post('/:id/delete', asyncHandler(async (req, res) => {
  const reason = readReason(req, { required: false })
  await db.transaction(async (trx) => {
    const target = await lockUser(trx, req.params.id)
    if (target.deleted_at) throw httpError(409, 'บัญชีนี้ถูกลบแล้ว')
    assertNotSelf(req, target, 'ไม่สามารถลบบัญชีของตัวเองได้')
    await assertNotLastAdmin(trx, target)
    await trx('users').where('id', target.id).update({ deleted_at: new Date(), deleted_by: req.user.id })
    await revokeUserSessions(target.id, trx)
    await trx('password_reset_tokens').where('user_id', target.id).delete()
    await trx('email_verification_tokens').where('user_id', target.id).delete()
    await logAction(trx, req.user.id, 'user.delete', target.id, reason ? { reason } : {})
  })
  await respondWithUser(res, req.params.id)
}))

adminUsersRouter.post('/:id/restore', asyncHandler(async (req, res) => {
  await db.transaction(async (trx) => {
    const target = await lockUser(trx, req.params.id)
    if (!target.deleted_at) throw httpError(409, 'บัญชีนี้ไม่ได้ถูกลบ')
    await trx('users').where('id', target.id).update({ deleted_at: null, deleted_by: null })
    await logAction(trx, req.user.id, 'user.restore', target.id)
  })
  await respondWithUser(res, req.params.id)
}))

const POINTS_DELTA_MAX = 100000

adminUsersRouter.post('/:id/points', asyncHandler(async (req, res) => {
  const reason = readReason(req, { required: true })
  const delta = Number(req.body?.delta)
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > POINTS_DELTA_MAX) {
    throw httpError(400, `จำนวนพอยท์ต้องเป็นจำนวนเต็มที่ไม่ใช่ 0 และไม่เกิน ${POINTS_DELTA_MAX}`)
  }
  try {
    await db.transaction(async (trx) => {
      await trx.raw('select * from adjust_points(?, ?, ?, ?)', [req.params.id, delta, reason, req.user.id])
      await logAction(trx, req.user.id, 'points.adjust', req.params.id, { delta, reason })
    })
  } catch (err) {
    if (err.code === 'PT402') throw httpError(400, 'พอยท์ของผู้ใช้ไม่พอให้หัก')
    if (err.code === 'US404') throw httpError(404, 'ไม่พบผู้ใช้ หรือบัญชีถูกลบแล้ว')
    throw err
  }
  await respondWithUser(res, req.params.id)
}))

adminUsersRouter.post('/:id/revoke-sessions', asyncHandler(async (req, res) => {
  await db.transaction(async (trx) => {
    const target = await lockUser(trx, req.params.id)
    const revoked = await revokeUserSessions(target.id, trx)
    await logAction(trx, req.user.id, 'user.revoke_sessions', target.id, { sessions: revoked })
  })
  await respondWithUser(res, req.params.id)
}))

adminUsersRouter.post('/:id/resend-verification', asyncHandler(async (req, res) => {
  const target = await db('users').where('id', req.params.id).first()
  if (!target) throw httpError(404, 'ไม่พบผู้ใช้')
  if (target.deleted_at || target.status !== 'active') throw httpError(409, 'ส่งอีเมลยืนยันให้บัญชีที่ถูกลบหรือถูกระงับไม่ได้')
  if (target.email_verified) throw httpError(409, 'บัญชีนี้ยืนยันอีเมลแล้ว')

  const rawToken = await createVerificationToken(target.id)
  try {
    await sendVerificationEmail(target.email, `${FRONTEND_ORIGIN}/confirm?token=${rawToken}`)
  } catch (err) {
    console.error(err)
    throw httpError(502, 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
  }
  await logAction(db, req.user.id, 'user.resend_verification', target.id)
  await respondWithUser(res, req.params.id)
}))
