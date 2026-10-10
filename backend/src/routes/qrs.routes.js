import { crudRouter } from '../lib/crudRouter.js'
import { rowToQr, qrPayload } from '../lib/mappers.js'
import { db } from '../lib/db.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { rateLimit } from '../lib/rateLimit.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rowToPlace } from '../lib/mappers.js'
import { PLACE_COLUMNS, attachUploadedPhotos } from './places.routes.js'

export const qrsRouter = crudRouter({
  table: 'qrs',
  select: 'id, place_id, points, is_active, expires_at, radius_m',
  toRow: qrPayload,
  toResponse: rowToQr,
  mutateAuth: [requireAdmin],
  uniqueViolationMessage: 'สถานที่นี้มี QR อยู่แล้ว (ได้ 1 QR ต่อสถานที่)',
})

// Scan count + total points handed out per QR, for the admin QR list. Two
// path segments so it can't collide with crudRouter's GET /:id.
qrsRouter.get('/meta/stats', requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await db.raw(
    'select qr_id, count(*)::int as scans, coalesce(sum(points_awarded), 0)::int as points_total from qr_scans group by qr_id'
  )
  res.json(rows.map((r) => ({ qrId: r.qr_id, scans: r.scans, pointsTotal: r.points_total })))
}))

// Places a tourist can really earn points at right now: one row per QR that
// is active and unexpired, on an active place, with `qrPoints` taken from the
// QR itself (what claim_qr_scan() actually awards) rather than the display-only
// places.qr_points. Public, like the places list -- PointsPage's logged-out
// intro shows it too.
qrsRouter.get('/meta/places', asyncHandler(async (req, res) => {
  const qrs = await db('qrs')
    .select('place_id', 'points', 'radius_m', 'expires_at')
    .where('is_active', true)
    .where((b) => b.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now()))
  if (!qrs.length) return res.json([])
  const qrByPlace = new Map(qrs.map((q) => [q.place_id, q]))
  const rows = await db('places').select(db.raw(PLACE_COLUMNS)).whereIn('id', [...qrByPlace.keys()]).where('is_active', true).orderBy('name')
  const withPhotos = await attachUploadedPhotos(rows)
  res.json(withPhotos.map((r) => {
    const q = qrByPlace.get(r.id)
    // radiusM only matters when the place has coordinates (claim_qr_scan skips the distance check otherwise).
    return { ...rowToPlace(r), hasQR: true, qrPoints: q.points, qrRadiusM: r.lat != null && r.lng != null ? q.radius_m : null, qrExpiresAt: q.expires_at ? new Date(q.expires_at).toISOString() : null }
  }))
}))

// Claims the points a QR awards for the logged-in tourist. The points and
// place name are looked up server-side from :id inside claim_qr_scan() --
// never trusted from the scanned QR content, which only carries this
// opaque id (see QrTab.jsx's qrValue). The one-claim-per-user-per-QR rule
// and the balance credit both happen atomically in that DB function; see
// its definition in 20260823000001_qr_scans_and_redemptions.sql for why.
// 22P02 = a malformed (non-uuid) id in the URL.
const SCAN_ERROR_STATUS = { QR404: 404, '22P02': 404, QR403: 403, QR409: 409, QR410: 410, QR422: 422, QR451: 403, US403: 403 }
const SCAN_ERROR_MESSAGE = {
  QR404: 'ไม่พบ QR นี้',
  '22P02': 'ไม่พบ QR นี้',
  QR403: 'QR นี้ปิดใช้งานอยู่',
  QR409: 'คุณเคยสแกน QR นี้ไปแล้ว',
  QR410: 'QR นี้หมดอายุแล้ว',
  QR422: 'ต้องเปิดการเข้าถึงตำแหน่งเพื่อสแกน QR นี้',
  US403: 'บัญชีนี้ไม่สามารถใช้งานได้ กรุณาติดต่อผู้ดูแลระบบ',
}

// The browser-reported position is optional in the request (a place without
// coordinates doesn't need one), but if present it must be a real coordinate.
function parseCoordinate(value, limit) {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n) || Math.abs(n) > limit) throw httpError(400, 'ตำแหน่งที่ส่งมาไม่ถูกต้อง')
  return n
}

// A scan awards points, so cap how fast one account can hit this (keyed by
// user id because it runs after requireAuth) -- stops scripted point farming
// and probing the radius check with many guessed coordinates.
const scanLimit = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'สแกนบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' })

qrsRouter.post('/:id/scan', requireAuth, scanLimit, asyncHandler(async (req, res) => {
  const lat = parseCoordinate(req.body?.lat, 90)
  const lng = parseCoordinate(req.body?.lng, 180)
  let rows
  try {
    ({ rows } = await db.raw('select * from claim_qr_scan(?, ?, ?, ?)', [req.user.id, req.params.id, lat, lng]))
  } catch (err) {
    if (err.code === 'QR451') {
      const [dist, radius] = String(err.detail || '').split('|')
      throw httpError(403, dist && radius
        ? `คุณอยู่ห่างจากสถานที่ประมาณ ${dist} เมตร ต้องอยู่ภายใน ${radius} เมตรจึงจะสแกนได้`
        : 'คุณอยู่ไกลจากสถานที่เกินไป')
    }
    // Anything unmapped (connection loss, missing migration, ...) goes to the
    // global errorHandler, which logs it and hides the raw driver message.
    if (!SCAN_ERROR_STATUS[err.code]) throw err
    throw httpError(SCAN_ERROR_STATUS[err.code], SCAN_ERROR_MESSAGE[err.code])
  }
  const [result] = rows
  res.json({ points: result.points_awarded, placeName: result.place_name, balance: result.new_balance })
}))
