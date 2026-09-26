import crypto from 'crypto'
import { db } from './db.js'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex')

// One pending request per user: asking again replaces the previous one.
export async function createEmailChangeToken(userId, newEmail) {
  const rawToken = crypto.randomBytes(32).toString('hex')
  const row = { user_id: userId, new_email: newEmail, token_hash: hash(rawToken), expires_at: new Date(Date.now() + TOKEN_TTL_MS), created_at: new Date() }
  await db('email_change_tokens').insert(row).onConflict('user_id').merge()
  return rawToken
}

export const findPendingEmailChange = (userId) =>
  db('email_change_tokens').where('user_id', userId).andWhere('expires_at', '>', new Date()).first()

export const cancelEmailChange = (userId) => db('email_change_tokens').where('user_id', userId).delete()

// Single-use: deleted in the same statement that reads it.
export async function consumeEmailChangeToken(rawToken, trx = db) {
  const [row] = await trx('email_change_tokens').where('token_hash', hash(rawToken)).delete().returning('*')
  if (!row || new Date(row.expires_at) < new Date()) return null
  return row
}
