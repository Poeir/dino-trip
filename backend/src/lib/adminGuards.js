import { httpError } from '../middleware/errorHandler.js'

// Refuses to take the last usable admin out of service (suspend or delete),
// which would leave nobody able to sign in to the admin area. Locks the other
// admins' rows too, so two admins acting on each other at the same moment
// can't both pass the check.
export async function assertNotLastAdmin(trx, target) {
  if (target.role !== 'admin') return
  const others = await trx('users')
    .where({ role: 'admin', status: 'active' })
    .whereNull('deleted_at')
    .whereNot('id', target.id)
    .forUpdate()
    .select('id')
  if (!others.length) throw httpError(409, 'ต้องมี admin ที่ใช้งานได้อย่างน้อย 1 คน จึงดำเนินการกับบัญชีนี้ไม่ได้')
}
