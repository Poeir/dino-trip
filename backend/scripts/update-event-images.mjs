// One-time backfill: attach real Wikimedia Commons photos to the four
// seeded events (previously img: null). Run once; safe to re-run (idempotent
// name-match update).
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const updates = [
  { match: 'เทศกาลไหมนานาชาติ', img: 'https://upload.wikimedia.org/wikipedia/commons/a/a3/Traditional_Thai_silk_making.jpg' },
  { match: 'สงกรานต์อีสาน', img: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Grand_songkran_%28Thai_New_Year_%29_Water_Festival.jpg' },
  { match: 'ลอยกระทง', img: 'https://upload.wikimedia.org/wikipedia/commons/4/46/Phra_Mahathat_Kaen_Nakhon_temple%2C_Khon_Kaen%2C_Thailand.jpg' },
  { match: 'พระธาตุขามแก่น', img: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Phra_That_Kham_Kaen_9102.jpg' },
]

const { data: events, error } = await supabase.from('events').select('id, name')
if (error) { console.error(error); process.exit(1) }

for (const u of updates) {
  const ev = events.find((e) => e.name.includes(u.match))
  if (!ev) { console.log('NO MATCH for', u.match); continue }
  const { error: updErr } = await supabase.from('events').update({ img: u.img }).eq('id', ev.id)
  console.log(ev.name, '->', updErr ? updErr.message : 'OK')
}
