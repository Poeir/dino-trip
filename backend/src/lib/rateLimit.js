import { httpError } from '../middleware/errorHandler.js'

// Small in-memory fixed-window limiter (no extra dependency). Counts are per
// process, so behind several instances the effective limit is max * instances --
// good enough to stop password guessing / mail spamming from one account; swap
// for a shared store if the API is ever scaled out.
//
// keyFn defaults to the logged-in user id (falls back to the IP), so put this
// after requireAuth on routes that need a per-account budget.
export function rateLimit({ windowMs, max, message = 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง', keyFn }) {
  const hits = new Map()
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
  }, windowMs)
  timer.unref()

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.user?.id || req.ip)
    const now = Date.now()
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      hits.set(key, entry)
    }
    entry.count += 1
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      return next(httpError(429, message))
    }
    next()
  }
}
