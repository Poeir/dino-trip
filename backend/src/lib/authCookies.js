// Supabase session tokens live only in httpOnly cookies -- the frontend
// never sees them, so there's nothing for XSS/devtools to steal and no
// Supabase credential ships in the browser bundle at all.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
}

// session: the object returned as data.session by supabase.auth.signUp /
// signInWithPassword / refreshSession.
export function setSessionCookies(res, session) {
  res.cookie('sb_access_token', session.access_token, { ...COOKIE_OPTS, maxAge: session.expires_in * 1000 })
  res.cookie('sb_refresh_token', session.refresh_token, { ...COOKIE_OPTS, maxAge: 30 * 24 * 60 * 60 * 1000 })
}

export function clearSessionCookies(res) {
  res.clearCookie('sb_access_token', COOKIE_OPTS)
  res.clearCookie('sb_refresh_token', COOKIE_OPTS)
}
