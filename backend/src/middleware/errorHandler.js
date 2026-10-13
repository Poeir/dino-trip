export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `Not found: ${req.method} ${req.originalUrl}` } })
}

// Postgres "undefined_column / undefined_function / undefined_table": the code
// is newer than the database, i.e. a migration hasn't been run yet.
const SCHEMA_OUT_OF_DATE_CODES = new Set(['42703', '42883', '42P01'])

export function errorHandler(err, req, res, next) {
  if (SCHEMA_OUT_OF_DATE_CODES.has(err.code)) {
    console.error(err)
    return res.status(503).json({ error: { message: 'ฐานข้อมูลยังไม่เป็นปัจจุบัน กรุณาให้ผู้ดูแลระบบรัน migration ล่าสุดก่อน' } })
  }
  // A malformed value (e.g. a non-uuid id in the URL) reaching a typed column.
  if (err.code === '22P02') return res.status(400).json({ error: { message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' } })
  // Errors we threw on purpose carry a status (httpError, body-parser, ...) and
  // a message written for the user. Anything without one is unexpected -- log
  // it, but don't leak raw driver/DB text to the client.
  if (!err.status) {
    console.error(err)
    return res.status(500).json({ error: { message: 'เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง' } })
  }
  if (err.status >= 500) console.error(err)
  res.status(err.status).json({ error: { message: err.message || 'Internal server error' } })
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}
