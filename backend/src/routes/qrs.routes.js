import { crudRouter } from '../lib/crudRouter.js'
import { rowToQr, qrPayload } from '../lib/mappers.js'
import { db } from '../lib/db.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

export const qrsRouter = crudRouter({
  table: 'qrs',
  select: 'id, place_id, points',
  toRow: qrPayload,
  toResponse: rowToQr,
  mutateAuth: [requireAdmin],
})

// Claims the points a QR awards for the logged-in tourist. The points and
// place name are looked up server-side from :id inside claim_qr_scan() --
// never trusted from the scanned QR content, which only carries this
// opaque id (see QrTab.jsx's qrValue). The one-claim-per-user-per-QR rule
// and the balance credit both happen atomically in that DB function; see
// its definition in 20260823000001_qr_scans_and_redemptions.sql for why.
const SCAN_ERROR_STATUS = { QR404: 404, QR409: 409 }
const SCAN_ERROR_MESSAGE = { QR404: 'ไม่พบ QR นี้', QR409: 'คุณเคยสแกน QR นี้ไปแล้ว' }

qrsRouter.post('/:id/scan', requireAuth, asyncHandler(async (req, res) => {
  let rows
  try {
    ({ rows } = await db.raw('select * from claim_qr_scan(?, ?)', [req.user.id, req.params.id]))
  } catch (err) {
    throw httpError(SCAN_ERROR_STATUS[err.code] || 500, SCAN_ERROR_MESSAGE[err.code] || err.message)
  }
  const [result] = rows
  res.json({ points: result.points_awarded, placeName: result.place_name, balance: result.new_balance })
}))
