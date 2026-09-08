import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { db } from './db.js'

export function crudRouter({ table, select, order, sortRows, toRow, toResponse, mutateAuth = [] }) {
  const router = Router()
  const mapRow = toResponse || ((row) => row)
  const orderRules = order ? (Array.isArray(order) ? order : [order]) : []
  const columns = select ? select.split(',').map((s) => s.trim()) : '*'

  router.get('/', asyncHandler(async (req, res) => {
    let query = db(table).select(columns)
    if (!sortRows) {
      for (const rule of orderRules) query = query.orderBy(rule.column, rule.ascending === false ? 'desc' : 'asc')
    }
    const data = await query
    const rows = sortRows ? sortRows(data) : data
    res.json(rows.map(mapRow))
  }))

  router.post('/', mutateAuth, asyncHandler(async (req, res) => {
    const payload = toRow ? toRow(req.body) : req.body
    const [row] = await db(table).insert(payload).returning(columns)
    res.status(201).json(mapRow(row))
  }))

  router.put('/:id', mutateAuth, asyncHandler(async (req, res) => {
    const payload = toRow ? toRow(req.body) : req.body
    const [row] = await db(table).where('id', req.params.id).update(payload).returning(columns)
    if (!row) throw httpError(404, 'ไม่พบข้อมูล')
    res.json(mapRow(row))
  }))

  router.delete('/:id', mutateAuth, asyncHandler(async (req, res) => {
    const count = await db(table).where('id', req.params.id).delete()
    if (!count) throw httpError(404, 'ไม่พบข้อมูล')
    res.status(204).end()
  }))

  return router
}
