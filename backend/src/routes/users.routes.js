import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { db } from '../lib/db.js'

export const usersRouter = Router()

// Public, no auth -- mirrors the old public Supabase Storage bucket.
usersRouter.get('/:id/avatar', asyncHandler(async (req, res) => {
  const row = await db('users').select('avatar_data', 'avatar_mime').where('id', req.params.id).whereNull('deleted_at').first()
  if (!row?.avatar_data) return res.status(404).end()
  // The client appends ?v=<avatar_updated_at>, so a changed photo gets a new URL
  // and this can be cached hard. private: it's a personal photo, keep it out of
  // shared caches.
  res.set({ 'Content-Type': row.avatar_mime, 'Cache-Control': 'private, max-age=86400' }).send(row.avatar_data)
}))
