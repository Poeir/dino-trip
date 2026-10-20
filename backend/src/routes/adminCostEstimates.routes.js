import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { getCostEstimates } from '../lib/apiPricing.js'

// Per-click cost ceilings for the admin buttons that call a paid API (Google Places,
// Serper, LLM). Static estimates from lib/apiPricing.js -- no DB, nothing recorded.
export const adminCostEstimatesRouter = Router()
adminCostEstimatesRouter.use(requireAdmin)

adminCostEstimatesRouter.get('/', (req, res) => {
  res.json(getCostEstimates())
})
