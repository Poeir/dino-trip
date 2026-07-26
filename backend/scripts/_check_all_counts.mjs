import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const tables = ['places', 'events', 'knowledge', 'rewards', 'qrs']
for (const t of tables) {
  const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true })
  console.log(t, error ? 'ERROR: '+error.message : count)
}
