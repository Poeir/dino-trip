import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { db } from '../lib/db.js'

export const usersRouter = Router()

// Public, no auth -- mirrors the old public Supabase Storage bucket.
usersRouter.get('/:id/avatar', asyncHandler(async (req, res) => {
  const row = await db('users').select('avatar_data', 'avatar_mime').where('id', req.params.id).first()
  if (!row?.avatar_data) return res.status(404).end()
  res.set('Content-Type', row.avatar_mime).send(row.avatar_data)
}))
