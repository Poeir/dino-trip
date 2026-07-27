import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy backend/.env.example to backend/.env and fill them in.')
  process.exit(1)
}

// Service-role client: bypasses RLS. All privileged DB access for the API
// layer goes through this single client so that when auth/RLS lockdown
// eventually happens, only this file + route middleware need to change.
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
