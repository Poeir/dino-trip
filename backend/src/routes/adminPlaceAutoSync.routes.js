import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rateLimit } from '../lib/rateLimit.js'
import { getAutoSyncStatus, saveSettings, runAutoSync, SKIP_MESSAGE } from '../services/placeAutoSync.js'

// Admin settings + status for the scheduled Google sync (services/placeAutoSync.js).
export const adminPlaceAutoSyncRouter = Router()
adminPlaceAutoSyncRouter.use(requireAdmin)

// "Run now" spends real Places API requests (bounded by the monthly cap), so budget it.
const runLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 6, message: 'สั่งซิงก์ทันทีบ่อยเกินไป กรุณารอสักครู่' })

adminPlaceAutoSyncRouter.get('/', asyncHandler(async (req, res) => {
  res.json(await getAutoSyncStatus())
}))

adminPlaceAutoSyncRouter.put('/', asyncHandler(async (req, res) => {
  await saveSettings(req.body, req.user.id)
  res.json(await getAutoSyncStatus())
}))

// Starts one scheduled-style run immediately (same selection, daily limit and cap).
adminPlaceAutoSyncRouter.post('/run', runLimit, asyncHandler(async (req, res) => {
  const result = await runAutoSync({ runNow: true })
  if (!result.started && result.reason === 'busy') throw httpError(409, SKIP_MESSAGE.busy)
  res.status(result.started ? 202 : 200).json({ ...result, message: result.started ? undefined : SKIP_MESSAGE[result.reason] })
}))
