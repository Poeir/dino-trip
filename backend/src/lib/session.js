import { createAuthClient } from './supabaseAuthClient.js'
import { setSessionCookies, clearSessionCookies } from './authCookies.js'

// Resolves the Supabase user for the request's session cookies, silently
// refreshing an expired access token via the (much longer-lived) refresh
// token cookie when needed -- and reissuing both cookies on success, same
// as auth.routes.js's /me used to do inline. Returns the raw Supabase user,
// or null if there's no valid session; callers decide what that means
// (/me responds { user: null }, requireAuth throws 401).
export async function resolveSessionUser(req, res) {
  const accessToken = req.cookies?.sb_access_token
  const client = createAuthClient()

  if (accessToken) {
    const { data, error } = await client.auth.getUser(accessToken)
    if (!error && data.user) return data.user
  }

  const refreshToken = req.cookies?.sb_refresh_token
  if (!refreshToken) return null

  const refreshed = await client.auth.refreshSession({ refresh_token: refreshToken })
  if (refreshed.error) { clearSessionCookies(res); return null }

  setSessionCookies(res, refreshed.data.session)
  return refreshed.data.user
}
