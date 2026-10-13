import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { db } from '../lib/db.js'

export const pointsRouter = Router()

pointsRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const row = await db('users').select('points_balance').where('id', req.user.id).first()
  res.json({ balance: row.points_balance })
}))

// Redeeming is done by an admin at the counter -- see adminRedemptions.routes.js.
// There is deliberately no tourist-facing redeem endpoint.
