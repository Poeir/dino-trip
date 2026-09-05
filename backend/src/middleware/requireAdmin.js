import { asyncHandler } from './asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { resolveSessionUser } from '../lib/session.js'
import { supabase } from '../lib/supabaseClient.js'

// Gates a route on a logged-in session whose `users.role` is 'admin'.
// Reuses the same tourist session cookies as requireAuth.js -- admins log
// in through the same /api/auth/login as tourists, just with a different
// role on their profile row.
export const requireAdmin = asyncHandler(async (req, res, next) => {
  const user = await resolveSessionUser(req, res)
  if (!user) throw httpError(401, 'กรุณาเข้าสู่ระบบก่อน')

  const { data, error } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (error || data?.role !== 'admin') throw httpError(403, 'ไม่มีสิทธิ์เข้าถึงส่วนนี้')

  req.user = { id: user.id, email: user.email, role: 'admin' }
  next()
})
