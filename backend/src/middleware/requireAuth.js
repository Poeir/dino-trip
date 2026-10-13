import { asyncHandler } from './asyncHandler.js'
import { httpError } from './errorHandler.js'
import { resolveSessionUser } from '../lib/session.js'

// Gates a route on a logged-in tourist session, same cookie-based session
// auth.routes.js uses. Sets req.user so handlers never have to trust a
// user id passed in the request body/params -- see qrs.routes.js's scan
// endpoint and points.routes.js.
export const requireAuth = asyncHandler(async (req, res, next) => {
  const user = await resolveSessionUser(req, res)
  if (!user) throw httpError(401, 'กรุณาเข้าสู่ระบบก่อน')
  req.user = { id: user.id, email: user.email, role: user.role }
  next()
})
