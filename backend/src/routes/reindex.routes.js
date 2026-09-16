import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { forwardToChatbotService } from '../lib/chatbotProxy.js'

// Proxies to chatbot-service's /admin/reindex endpoints (see
// chatbot-service/src/api/routes_admin.py). requireAdmin here is what
// actually gates who can trigger a reindex; the browser never calls
// chatbot-service directly for this.

export const reindexRouter = Router()

reindexRouter.post('/', requireAdmin, asyncHandler(async (req, res) => {
  res.json(await forwardToChatbotService('/admin/reindex', { method: 'POST' }))
}))

reindexRouter.get('/status', requireAdmin, asyncHandler(async (req, res) => {
  res.json(await forwardToChatbotService('/admin/reindex/status'))
}))
