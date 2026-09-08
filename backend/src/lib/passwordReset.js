import crypto from 'crypto'
import { db } from './db.js'

const TOKEN_TTL_MS = 60 * 60 * 1000

export async function createPasswordResetToken(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await db('password_reset_tokens').insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
  return rawToken
}

// Deleted on use, unlike email-verification tokens: a reset token is only
// ever redeemed by an explicit form submission (never auto-fired on page
// load), so there's no email-scanner-prefetch case to protect against here
// -- single-use is strictly safer for something this sensitive.
export async function consumePasswordResetToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const [row] = await db('password_reset_tokens').where('token_hash', tokenHash).delete().returning('*')
  if (!row || new Date(row.expires_at) < new Date()) return null
  return row
}
