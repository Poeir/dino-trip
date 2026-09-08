import multer from 'multer'

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export const createImageUploadMiddleware = (maxBytes = DEFAULT_MAX_BYTES) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes } }).single('avatarFile')
