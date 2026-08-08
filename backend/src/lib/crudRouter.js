import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { supabase } from './supabaseClient.js'

// Builds a GET(list)/POST/PUT/DELETE router for a single Supabase table.
// toRow maps a request body (camelCase) to a DB row payload (snake_case);
// toResponse maps a DB row back to the camelCase shape the frontend expects.
// `order` may be a single { column, ascending } or an array of them, applied
// in order (e.g. rating desc, then review_count desc as a tiebreaker).
// `sortRows`, if given, overrides `order`: it receives the full fetched row
// array and returns it sorted, for rankings DB-side `.order()` can't express
// (e.g. a score blending multiple columns).
export function crudRouter({ table, select, order, sortRows, toRow, toResponse }) {
  const router = Router()
  const mapRow = toResponse || ((row) => row)
  const orderRules = order ? (Array.isArray(order) ? order : [order]) : []

  router.get('/', asyncHandler(async (req, res) => {
    let query = supabase.from(table).select(select)
    if (!sortRows) {
      for (const rule of orderRules) {
        query = query.order(rule.column, { ascending: rule.ascending !== false, nullsFirst: false })
      }
    }
    const { data, error } = await query
    if (error) throw httpError(500, error.message)
    const rows = sortRows ? sortRows(data) : data
    res.json(rows.map(mapRow))
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
