import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY. Copy backend/.env.example to backend/.env and fill them in.')
  process.exit(1)
}

// Anon-key client for user-context Auth calls (signUp/signIn/refresh/
// getUser) -- the same calls the browser would make with supabase-js
// directly, except they happen here so the anon key (and the session
// tokens it produces) never ships to the browser. All other DB access
// still goes through supabaseClient.js's service-role client.
//
// A fresh client is created per call rather than exported as a shared
// singleton: this server handles concurrent requests from many different
// users, and supabase-js keeps "current session" as mutable state on the
// client instance -- a shared instance would let one user's login
// overwrite another's session state mid-request. persistSession/
// autoRefreshToken are also meaningless (and wasteful) outside a browser.
export function createAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
