import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { supabase } from '../lib/supabaseClient.js'

export const pointsRouter = Router()

pointsRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('users').select('points_balance').eq('id', req.user.id).single()
  if (error) throw httpError(500, error.message)
  res.json({ balance: data.points_balance })
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

  const { data, error } = await supabase.rpc('redeem_reward', { p_user_id: req.user.id, p_reward_id: rewardId })
  if (error) throw httpError(REDEEM_ERROR_STATUS[error.code] || 500, REDEEM_ERROR_MESSAGE[error.code] || error.message)

  const [result] = data
  res.json({ balance: result.new_balance })
}))
