import 'dotenv/config'
import { app } from './app.js'
import { db } from './lib/db.js'
import { startCleanupJob } from './lib/cleanup.js'

const PORT = process.env.PORT || 4000

// Opens/authenticates the pool's first connection at boot instead of on the
// first real request -- see db.js's pool.min for why a cold connection is
// otherwise a multi-second tax on whoever happens to hit the API first.
db.raw('select 1')
  .catch((err) => console.error('DB warmup query failed:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Dino Khon Kaen API listening on http://localhost:${PORT}`)
      startCleanupJob()
    })
  })
