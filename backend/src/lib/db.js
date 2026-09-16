import 'dotenv/config'
import knex from 'knex'
import pg from 'pg'

// pg's default DATE (oid 1082) parser returns a JS Date -- fine for
// timestamptz columns, but a plain `date` column (e.g. events.event_start_date)
// has no time/timezone component, and building a Date from it re-introduces
// one, which then serializes back out as a full ISO datetime and can shift
// the calendar day depending on the server's local timezone. Keep it as the
// plain 'YYYY-MM-DD' string Postgres sent -- that's also directly what
// <input type="date"> and lexicographic date comparisons expect.
pg.types.setTypeParser(1082, (val) => val)

export const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: { min: 0, max: 10 },
})
