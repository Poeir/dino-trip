import { httpError } from '../middleware/errorHandler.js'

// Shared by signup (auth.routes.js) and the profile editor (profile.routes.js)
// so the two can never drift into accepting different things.

// Emails are stored lower-cased (see users_email_normalized_check), so every
// lookup has to normalise the same way or "A@x.com" would miss "a@x.com".
export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isValidEmail = (email) => email.length <= 254 && EMAIL_RE.test(email)

// Thai mobile numbers: 10 digits starting with 0 (e.g. 0812345678). This is
// a profile field for staff to look accounts up by at the redemption
// counter (UC-08), not a login credential, so it doesn't need to handle
// international formats the way a phone-based login would.
export const THAI_PHONE_RE = /^0\d{9}$/

// Mirrors PASSWORD_RULES in AppContext.jsx -- the client shows this checklist
// live as the visitor types, but the server re-checks it too since a client
// check alone isn't a real boundary.
export const PASSWORD_RULES = [
  { test: (p) => p.length >= 8, message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' },
  { test: (p) => /[A-Z]/.test(p), message: 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่ (A-Z) อย่างน้อย 1 ตัว' },
  { test: (p) => /[a-z]/.test(p), message: 'รหัสผ่านต้องมีตัวพิมพ์เล็ก (a-z) อย่างน้อย 1 ตัว' },
  { test: (p) => /[0-9]/.test(p), message: 'รหัสผ่านต้องมีตัวเลข (0-9) อย่างน้อย 1 ตัว' },
]

export const TITLE_VALUES = ['mr', 'mrs', 'miss']
export const GENDER_VALUES = ['male', 'female', 'unspecified']
export const OCCUPATION_VALUES = [
  'student', 'government', 'private_employee', 'business_owner',
  'farmer', 'freelance', 'homemaker', 'retired', 'unemployed', 'other',
]

const AVATAR_POSITION_RE = /^\d{1,3}% \d{1,3}%$/

export function assertPasswordStrong(password) {
  const failed = PASSWORD_RULES.find((r) => !r.test(password || ''))
  if (failed) throw httpError(400, failed.message)
}

// The personal-details block that signup collects and the profile page edits.
// Everything is required, same as signup. Returns the cleaned values.
export function readProfileFields(body) {
  const b = body || {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  const f = {
    title: str(b.title), firstName: str(b.firstName), lastName: str(b.lastName), phone: str(b.phone),
    gender: str(b.gender), province: str(b.province), district: str(b.district), subdistrict: str(b.subdistrict),
    birthdate: str(b.birthdate), occupation: str(b.occupation),
  }
  if (Object.values(f).some((v) => !v)) throw httpError(400, 'กรุณากรอกข้อมูลให้ครบถ้วน')
  if (f.firstName.length > 100 || f.lastName.length > 100) throw httpError(400, 'ชื่อหรือนามสกุลยาวเกินไป')
  if (f.province.length > 100 || f.district.length > 100 || f.subdistrict.length > 100) throw httpError(400, 'ข้อมูลที่อยู่ยาวเกินไป')
  if (!TITLE_VALUES.includes(f.title)) throw httpError(400, 'กรุณาเลือกคำนำหน้าให้ถูกต้อง')
  if (!THAI_PHONE_RE.test(f.phone)) throw httpError(400, 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (10 หลัก ขึ้นต้นด้วย 0)')
  if (!GENDER_VALUES.includes(f.gender)) throw httpError(400, 'กรุณาเลือกเพศให้ถูกต้อง')
  if (!OCCUPATION_VALUES.includes(f.occupation)) throw httpError(400, 'กรุณาเลือกอาชีพให้ถูกต้อง')
  if (Number.isNaN(Date.parse(f.birthdate)) || new Date(f.birthdate) > new Date()) throw httpError(400, 'กรุณากรอกวันเกิดให้ถูกต้อง')
  return f
}

// avatarUrl is optional -- "preset:<key>" picked from the built-in set
// (see PERSONA_AVATARS in AppContext.jsx). An uploaded photo comes through
// req.file instead, not this field. avatarPosition ("X% Y%", CSS
// object-position) and avatarScale (zoom, 1-3) only apply to an uploaded
// photo -- multer puts them in req.body as plain strings even though
// avatarScale is numeric on the wire.
export function readAvatarFields(body) {
  const { avatarUrl, avatarPosition, avatarScale } = body || {}
  if (avatarUrl != null && (typeof avatarUrl !== 'string' || avatarUrl.length > 500)) throw httpError(400, 'avatarUrl ไม่ถูกต้อง')
  if (avatarPosition != null && !AVATAR_POSITION_RE.test(avatarPosition)) throw httpError(400, 'avatarPosition ไม่ถูกต้อง')
  const scale = avatarScale != null ? Number(avatarScale) : null
  if (scale != null && (Number.isNaN(scale) || scale < 1 || scale > 3)) throw httpError(400, 'avatarScale ไม่ถูกต้อง')
  const preset = typeof avatarUrl === 'string' && avatarUrl.startsWith('preset:') ? avatarUrl.slice('preset:'.length) : null
  return { preset, position: avatarPosition || null, scale }
}
