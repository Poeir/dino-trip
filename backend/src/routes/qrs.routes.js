import { crudRouter } from '../lib/crudRouter.js'
import { rowToQr, qrPayload } from '../lib/mappers.js'

export const qrsRouter = crudRouter({
  table: 'qrs',
  select: 'id, place_id, points',
  toRow: qrPayload,
  toResponse: rowToQr,
})
