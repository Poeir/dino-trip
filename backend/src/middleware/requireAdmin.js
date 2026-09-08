import { asyncHandler } from './asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { resolveSessionUser } from '../lib/session.js'

// Gates a route on a logged-in session whose role is 'admin'. Reuses the
// same tourist session cookie as requireAuth.js -- admins log in through
// the same /api/auth/login as tourists, just with a different role on
// their row. resolveSessionUser already joins the users row, so this needs
// no separate role lookup.
export const requireAdmin = asyncHandler(async (req, res, next) => {
  const user = await resolveSessionUser(req, res)
  if (!user) throw httpError(401, 'กรุณาเข้าสู่ระบบก่อน')
  if (user.role !== 'admin') throw httpError(403, 'ไม่มีสิทธิ์เข้าถึงส่วนนี้')

  req.user = { id: user.id, email: user.email, role: 'admin' }
  next()
})
