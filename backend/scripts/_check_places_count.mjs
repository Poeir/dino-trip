import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { count, error } = await supabase.from('places').select('*', { count: 'exact', head: true })
if (error) { console.error('ERROR', error.message); process.exit(1) }
console.log('places row count:', count)
