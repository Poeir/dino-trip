import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data, error } = await supabase.from('places').select('name, category, source').limit(10)
if (error) { console.error('ERROR', error.message); process.exit(1) }
console.log(data)
const { data: cats } = await supabase.from('places').select('category')
const byCat = {}
cats.forEach(r => byCat[r.category] = (byCat[r.category]||0)+1)
console.log('by category:', byCat)
