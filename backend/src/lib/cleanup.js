import { db } from './db.js'

const ONE_HOUR_MS = 60 * 60 * 1000

// Sessions and tokens are only ever checked against their expiry, never
// removed when it passes, so the tables would grow forever.
export async function purgeExpired() {
  const now = new Date()
  const [sessions, verification, reset] = await Promise.all([
    db('sessions').where('expires_at', '<', now).delete(),
    db('email_verification_tokens').where('expires_at', '<', now).delete(),
    db('password_reset_tokens').where('expires_at', '<', now).delete(),
  ])
  return { sessions, verification, reset }
}

export function startCleanupJob() {
  const run = () => purgeExpired()
    .then((r) => { if (r.sessions || r.verification || r.reset) console.log('Purged expired rows:', JSON.stringify(r)) })
    .catch((err) => console.error('Expired-row cleanup failed:', err.message))
  run()
  // unref: the timer alone must never keep the process alive.
  setInterval(run, ONE_HOUR_MS).unref()
}
