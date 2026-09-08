// Session token lives only in an httpOnly cookie -- the frontend never sees
// it, so there's nothing for XSS/devtools to steal and no credential ships
// in the browser bundle at all.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function setSessionCookie(res, rawToken) {
  res.cookie('session_token', rawToken, { ...COOKIE_OPTS, maxAge: SESSION_TTL_MS })
}

export function clearSessionCookie(res) {
  res.clearCookie('session_token', COOKIE_OPTS)
}
