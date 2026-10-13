import multer from 'multer'
import { httpError } from '../middleware/errorHandler.js'

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('รองรับเฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)'))
  cb(null, true)
}

export const createImageUploadMiddleware = (fieldName, maxBytes = DEFAULT_MAX_BYTES) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes }, fileFilter }).single(fieldName)
  // Wrapped so a rejected/oversized upload surfaces as a normal 400 through
  // errorHandler.js instead of an unhandled MulterError (which has no
  // `.status` and would otherwise fall through as a raw 500).
  return (req, res, next) => {
    upload(req, res, (err) => {
      if (!err) return next()
      if (err.code === 'LIMIT_FILE_SIZE') return next(httpError(400, `ไฟล์ใหญ่เกินไป (จำกัด ${Math.round(maxBytes / 1024 / 1024)}MB)`))
      next(httpError(400, err.message))
    })
  }
}
