import express from 'express'
import cors from 'cors'
import { placesRouter } from './routes/places.routes.js'
import { eventsRouter } from './routes/events.routes.js'
import { knowledgeBaseRouter } from './routes/knowledgeBase.routes.js'
import { qrsRouter } from './routes/qrs.routes.js'
import { rewardsRouter } from './routes/rewards.routes.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'

export const app = express()

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => res.json({ name: 'Dino Khon Kaen API', docs: '/api' }))

app.use('/api/places', placesRouter)
app.use('/api/events', eventsRouter)
app.use('/api/knowledge-base', knowledgeBaseRouter)
app.use('/api/qrs', qrsRouter)
app.use('/api/rewards', rewardsRouter)

app.use(notFoundHandler)
app.use(errorHandler)
