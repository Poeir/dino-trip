import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { db } from '../lib/db.js'

export const pointsRouter = Router()

pointsRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const row = await db('users').select('points_balance').where('id', req.user.id).first()
  res.json({ balance: row.points_balance })
}))

// Debits the reward's cost and credits redemption history atomically in
// redeem_reward() -- see 20260823000001_qr_scans_and_redemptions.sql. The
// balance check happens DB-side (not here) so two concurrent redeems can't
// both read "balance is enough" and both go through.
const REDEEM_ERROR_STATUS = { RW404: 404, PT402: 402 }
const REDEEM_ERROR_MESSAGE = { RW404: 'ไม่พบของรางวัลนี้', PT402: 'พอยท์ไม่เพียงพอ' }

pointsRouter.post('/redeem', requireAuth, asyncHandler(async (req, res) => {
  const { rewardId } = req.body
  if (!rewardId) throw httpError(400, 'ต้องระบุของรางวัล')

  let rows
  try {
    ({ rows } = await db.raw('select * from redeem_reward(?, ?)', [req.user.id, rewardId]))
  } catch (err) {
    throw httpError(REDEEM_ERROR_STATUS[err.code] || 500, REDEEM_ERROR_MESSAGE[err.code] || err.message)
  }
  const [result] = rows
  res.json({ balance: result.new_balance })
}))
