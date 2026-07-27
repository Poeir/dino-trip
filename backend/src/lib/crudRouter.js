import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { supabase } from './supabaseClient.js'

// Builds a GET(list)/POST/PUT/DELETE router for a single Supabase table.
// toRow maps a request body (camelCase) to a DB row payload (snake_case);
// toResponse maps a DB row back to the camelCase shape the frontend expects.
export function crudRouter({ table, select, order, toRow, toResponse }) {
  const router = Router()
  const mapRow = toResponse || ((row) => row)

  router.get('/', asyncHandler(async (req, res) => {
    let query = supabase.from(table).select(select)
    if (order) query = query.order(order.column, { ascending: order.ascending !== false })
    const { data, error } = await query
    if (error) throw httpError(500, error.message)
    res.json(data.map(mapRow))
  }))

  router.post('/', asyncHandler(async (req, res) => {
    const payload = toRow ? toRow(req.body) : req.body
    const { data, error } = await supabase.from(table).insert(payload).select(select).single()
    if (error) throw httpError(400, error.message)
    res.status(201).json(mapRow(data))
  }))

  router.put('/:id', asyncHandler(async (req, res) => {
    const payload = toRow ? toRow(req.body) : req.body
    const { data, error } = await supabase.from(table).update(payload).eq('id', req.params.id).select(select).single()
    if (error) throw httpError(400, error.message)
    res.json(mapRow(data))
  }))

  router.delete('/:id', asyncHandler(async (req, res) => {
    const { error } = await supabase.from(table).delete().eq('id', req.params.id)
    if (error) throw httpError(400, error.message)
    res.status(204).end()
  }))

  return router
}
