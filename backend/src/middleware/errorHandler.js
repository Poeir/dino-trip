export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `Not found: ${req.method} ${req.originalUrl}` } })
}

export function errorHandler(err, req, res, next) {
  const status = err.status || 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: { message: err.message || 'Internal server error' } })
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}
