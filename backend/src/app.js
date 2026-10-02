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

export const app = express()

// credentials:true + an explicit origin (not '*', which credentialed
// requests can't use) is required for the browser to accept/send the
// httpOnly session cookies /api/auth sets.
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
app.use(express.json())
app.use(cookieParser())

app.get('/', (req, res) => res.json({ name: 'Dino Khon Kaen API', docs: '/api' }))

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
