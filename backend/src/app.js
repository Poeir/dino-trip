import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import morgan from 'morgan'
import { placesRouter } from './routes/places.routes.js'
import { eventsRouter } from './routes/events.routes.js'
import { knowledgeBaseRouter } from './routes/knowledgeBase.routes.js'
import { qrsRouter } from './routes/qrs.routes.js'
import { rewardsRouter } from './routes/rewards.routes.js'
import { authRouter } from './routes/auth.routes.js'
import { pointsRouter } from './routes/points.routes.js'
import { tripsRouter } from './routes/trips.routes.js'
import { profileRouter } from './routes/profile.routes.js'
import { usersRouter } from './routes/users.routes.js'
import { adminUsersRouter } from './routes/adminUsers.routes.js'
import { adminRedemptionsRouter } from './routes/adminRedemptions.routes.js'
import { adminStatsRouter } from './routes/adminStats.routes.js'
import { adminTripsRouter } from './routes/adminTrips.routes.js'
import { reindexRouter } from './routes/reindex.routes.js'
import { placeReportsRouter, adminPlaceReportsRouter } from './routes/placeReports.routes.js'
import { adminPlaceSyncRouter } from './routes/adminPlaceSync.routes.js'
import { adminPlaceImportRouter } from './routes/adminPlaceImport.routes.js'
import { eventReportsRouter, adminEventReportsRouter } from './routes/eventReports.routes.js'
import { eventRequestsRouter, adminEventRequestsRouter } from './routes/eventRequests.routes.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'
import { db } from './lib/db.js'
import { rateLimit } from './lib/rateLimit.js'

export const app = express()

// Behind a host's reverse proxy (Render etc.) req.ip would otherwise be the
// proxy's address for everyone, so rateLimit() would put all anonymous users
// in one shared bucket.
app.set('trust proxy', 1)
app.disable('x-powered-by')

// credentials:true + an explicit origin (not '*', which credentialed
// requests can't use) is required for the browser to accept/send the
// httpOnly session cookies /api/auth sets.
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
app.use(express.json())
app.use(cookieParser())

app.get('/', (req, res) => res.json({ name: 'Dino Khon Kaen API', docs: '/api' }))

// For uptime pings / host health checks. Runs a real query so it also keeps
// the DB pool's connection warm, and returns 503 when the DB is unreachable.
// /api/health is the one reachable from outside when everything sits behind a
// single reverse proxy that forwards only /api/* to this service.
app.get(['/health', '/api/health'], async (req, res) => {
  try {
    await db.raw('select 1')
    res.json({ status: 'ok' })
  } catch (err) {
    res.status(503).json({ status: 'error' })
  }
})

// Coarse per-IP ceiling for the whole API (the specific limits on auth and
// writes sit below this). Public list endpoints run DB queries, so this is the
// backstop against flooding them. Loose enough for many users behind one NAT:
// one page load fires roughly ten requests.
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 1200, keyFn: (req) => req.ip }))

app.use('/api/auth', authRouter)
app.use('/api/places', placeReportsRouter)
app.use('/api/places', placesRouter)
app.use('/api/events', eventReportsRouter)
app.use('/api/events', eventsRouter)
app.use('/api/event-requests', eventRequestsRouter)
app.use('/api/knowledge-base', knowledgeBaseRouter)
app.use('/api/qrs', qrsRouter)
app.use('/api/rewards', rewardsRouter)
app.use('/api/points', pointsRouter)
app.use('/api/trips', tripsRouter)
app.use('/api/profile', profileRouter)
app.use('/api/users', usersRouter)
app.use('/api/admin/users', adminUsersRouter)
app.use('/api/admin/redemptions', adminRedemptionsRouter)
app.use('/api/admin/stats', adminStatsRouter)
app.use('/api/admin/trips', adminTripsRouter)
app.use('/api/admin/place-reports', adminPlaceReportsRouter)
app.use('/api/admin/event-reports', adminEventReportsRouter)
app.use('/api/admin/event-requests', adminEventRequestsRouter)
app.use('/api/admin/place-sync', adminPlaceSyncRouter)
app.use('/api/admin/place-import', adminPlaceImportRouter)
app.use('/api/reindex', reindexRouter)

app.use(notFoundHandler)
app.use(errorHandler)
