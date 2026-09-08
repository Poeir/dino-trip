import crypto from 'crypto'
import { db } from './db.js'
import { clearSessionCookie } from './authCookies.js'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex')

export async function createSession(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex')
  await db('sessions').insert({ user_id: userId, token_hash: hash(rawToken), expires_at: new Date(Date.now() + SESSION_TTL_MS) })
  return rawToken
}

export async function resolveSessionUser(req, res) {
  const rawToken = req.cookies?.session_token
  if (!rawToken) return null
  const user = await db('sessions').join('users', 'users.id', 'sessions.user_id')
    .where('sessions.token_hash', hash(rawToken)).andWhere('sessions.expires_at', '>', new Date())
    .select('users.*').first()
  if (!user) { clearSessionCookie(res); return null }
  return user
}

export async function destroySession(rawToken) {
  if (rawToken) await db('sessions').where('token_hash', hash(rawToken)).delete()
}
