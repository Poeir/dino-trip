import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { db } from '../lib/db.js'

// Counter redemption: an admin hands the reward over and deducts the points.
// Points, stock and the redemption row change together inside the
// admin_redeem_reward() / admin_cancel_redemption() SQL functions.
export const adminRedemptionsRouter = Router()
adminRedemptionsRouter.use(requireAdmin)

const REDEEM_ERRORS = {
  US404: [404, 'ไม่พบผู้ใช้'],
  US403: [409, 'บัญชีนี้ถูกระงับหรือถูกลบ แลกของรางวัลให้ไม่ได้'],
  RW404: [404, 'ไม่พบของรางวัล'],
  RW409: [409, 'ของรางวัลหมดแล้ว'],
  PT402: [402, 'พอยท์ของผู้ใช้ไม่พอ'],
  '22P02': [400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง'],
}
const CANCEL_ERRORS = {
  RD404: [404, 'ไม่พบรายการแลกนี้'],
  RD409: [409, 'รายการนี้ถูกยกเลิกไปแล้ว'],
  '22P02': [400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง'],
}

const mapDbError = (err, table) => {
  const hit = table[err.code]
  return hit ? httpError(hit[0], hit[1]) : err
}

const audit = (trx, adminId, action, targetId, details) =>
  trx('admin_audit_log').insert({ admin_id: adminId, action, target_user_id: targetId, details: JSON.stringify(details) })

// Latest 100, newest first. ?status=completed|cancelled narrows it.
adminRedemptionsRouter.get('/', asyncHandler(async (req, res) => {
  const query = db('redemptions as r')
    .leftJoin('users as u', 'u.id', 'r.user_id')
    .leftJoin('users as a', 'a.id', 'r.admin_id')
    .leftJoin('rewards as w', 'w.id', 'r.reward_id')
    .select(
      'r.id', 'r.user_id', 'r.cost', 'r.redeemed_at', 'r.status', 'r.cancelled_at', 'r.cancel_reason',
      db.raw('coalesce(r.reward_name, w.name) as reward_name'),
      'u.display_name as user_name', 'u.email as user_email', 'u.phone as user_phone',
      'a.display_name as admin_name', 'a.email as admin_email',
    )
    .orderBy('r.redeemed_at', 'desc')
    .limit(100)
  if (req.query.status === 'completed' || req.query.status === 'cancelled') query.where('r.status', req.query.status)

  const rows = await query
  res.json(rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userName: r.user_name || r.user_email || '-',
    userPhone: r.user_phone || null,
    rewardName: r.reward_name || '(ของรางวัลถูกลบแล้ว)',
    cost: r.cost,
    redeemedAt: r.redeemed_at,
    status: r.status,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    adminName: r.admin_name || r.admin_email || null,
  })))
}))

adminRedemptionsRouter.post('/', asyncHandler(async (req, res) => {
  const { userId, rewardId } = req.body || {}
  if (!userId || !rewardId) throw httpError(400, 'ต้องระบุผู้ใช้และของรางวัล')
  try {
    const result = await db.transaction(async (trx) => {
      const { rows: [r] } = await trx.raw('select * from admin_redeem_reward(?, ?, ?)', [userId, rewardId, req.user.id])
      await audit(trx, req.user.id, 'redemption.create', userId, { redemptionId: r.redemption_id, reward: r.reward_name, rewardId })
      return r
    })
    res.status(201).json({
      redemptionId: result.redemption_id,
      balance: result.new_balance,
      remainingStock: result.remaining_stock,
      rewardName: result.reward_name,
    })
  } catch (err) {
    throw mapDbError(err, REDEEM_ERRORS)
  }
}))

adminRedemptionsRouter.post('/:id/cancel', asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason ?? '').trim()
  if (!reason) throw httpError(400, 'กรุณาระบุเหตุผลที่ยกเลิก')
  if (reason.length > 500) throw httpError(400, 'เหตุผลยาวเกินไป (ไม่เกิน 500 ตัวอักษร)')
  try {
    const result = await db.transaction(async (trx) => {
      const { rows: [r] } = await trx.raw('select * from admin_cancel_redemption(?, ?, ?)', [req.params.id, req.user.id, reason])
      await audit(trx, req.user.id, 'redemption.cancel', r.user_id, { redemptionId: req.params.id, reason })
      return r
    })
    res.json({ balance: result.new_balance, userId: result.user_id })
  } catch (err) {
    throw mapDbError(err, CANCEL_ERRORS)
  }
}))
