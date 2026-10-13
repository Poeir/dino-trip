// One-off: rewrite events.date_range to the canonical spelling ("4-8 พ.ย. 2569") wherever it only
// restates event_start_date..event_end_date in another month spelling. Schedule-style text
// ("ทุกวันเสาร์...") and events without dates are left alone.
//
//   node scripts/normalize-event-dates.js            # dry run: print what would change
//   node scripts/normalize-event-dates.js --apply    # write changes (old values printed as JSON)
//
// date_range is part of each event's embedding text -- after --apply run
// `python scripts/embed_content.py` in chatbot-service so chatbot search matches.
import 'dotenv/config'
import { db } from '../src/lib/db.js'
import { eventDateLabel } from '../src/lib/eventDate.js'

const apply = process.argv.includes('--apply')
const rows = await db('events').select('id', 'name', 'date_range', 'event_start_date', 'event_end_date')

const changes = rows
  .map((r) => ({ id: r.id, name: r.name, before: r.date_range, after: eventDateLabel(r) }))
  .filter((c) => c.before && c.after && c.before !== c.after)

if (!changes.length) console.log('Nothing to change.')
for (const c of changes) console.log(`${c.name}: "${c.before}" -> "${c.after}"`)

if (apply && changes.length) {
  console.log('\nBackup (old values):')
  console.log(JSON.stringify(changes.map(({ id, before }) => ({ id, date_range: before }))))
  await db.transaction(async (trx) => {
    for (const c of changes) await trx('events').where('id', c.id).update({ date_range: c.after })
  })
  console.log(`\nUpdated ${changes.length} events.`)
} else if (changes.length) {
  console.log(`\nDry run: ${changes.length} of ${rows.length} events would change. Re-run with --apply.`)
}
await db.destroy()
