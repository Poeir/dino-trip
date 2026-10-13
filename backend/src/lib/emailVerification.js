import crypto from 'crypto'
import { db } from './db.js'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export async function createVerificationToken(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await db('email_verification_tokens').insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
  return rawToken
}

// Not deleted on use -- gated only by expiry. A single-use-then-delete token
// breaks the moment a corporate email gateway or Outlook "Safe Links"
// prefetches the confirmation link before the real user clicks it.
export async function findVerificationToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const row = await db('email_verification_tokens').where('token_hash', tokenHash).first()
  if (!row || new Date(row.expires_at) < new Date()) return null
  return row
}
