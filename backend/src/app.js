import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { placesRouter } from './routes/places.routes.js'
import { eventsRouter } from './routes/events.routes.js'
import { knowledgeBaseRouter } from './routes/knowledgeBase.routes.js'
import { qrsRouter } from './routes/qrs.routes.js'
import { rewardsRouter } from './routes/rewards.routes.js'
import { authRouter } from './routes/auth.routes.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'

export const app = express()

// credentials:true + an explicit origin (not '*', which credentialed
// requests can't use) is required for the browser to accept/send the
// httpOnly session cookies /api/auth sets.
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(express.json())
app.use(cookieParser())

app.get('/', (req, res) => res.json({ name: 'Dino Khon Kaen API', docs: '/api' }))

app.use('/api/auth', authRouter)
app.use('/api/places', placesRouter)
app.use('/api/events', eventsRouter)
app.use('/api/knowledge-base', knowledgeBaseRouter)
app.use('/api/qrs', qrsRouter)
app.use('/api/rewards', rewardsRouter)

app.use(notFoundHandler)
app.use(errorHandler)
