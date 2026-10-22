import { db } from '../lib/db.js'
import { hasPlaceholderDescription } from './placeBulkDescribe.js'

// The bar an imported place must clear to be published without an admin
// reading it first (the "places users asked for" import). Same checks the
// 2026-10-22 bulk import of 67 district places used; anything missing leaves
// the place a hidden draft and the problems are shown to the admin.
//
// Photos are counted from place_photos: importGooglePlace stores them there,
// not in places.img/images (an early version of this gate looked there and
// failed every place).

const MIN_DESCRIPTION_CHARS = 150
// The description prompt says not to write hours (the place has its own,
// synced field): a clock time in the text is a sign it did anyway, and the
// chat then quotes two different opening times (seen live).
const CLOCK_TIME_RE = /\b\d{1,2}[:.]\d{2}\s*(?:น\.|–|-|ถึง)/

export async function importQualityProblems(placeId) {
  const p = await db('places')
    .select('category', 'description', 'lat', 'lng', 'hours', 'business_status', 'province', 'district')
    .where('id', placeId).first()
  if (!p) return ['ไม่พบสถานที่']
  const { n } = await db('place_photos').where('place_id', placeId).count('* as n').first()

  const problems = []
  const desc = String(p.description ?? '')
  if (hasPlaceholderDescription(desc, p.category) || desc.length < MIN_DESCRIPTION_CHARS) problems.push('ยังไม่มีคำอธิบายจาก AI')
  else if (CLOCK_TIME_RE.test(desc)) problems.push('คำอธิบายมีเวลาเปิด-ปิดปนอยู่')
  if (p.lat == null || p.lng == null) problems.push('ไม่มีพิกัด')
  if (Number(n) === 0) problems.push('ไม่มีรูป')
  // Temples are usually open-access with no hours listed on Google.
  if (!p.hours && p.category !== 'วัด') problems.push('ไม่มีเวลาเปิด-ปิด')
  if (p.business_status && p.business_status !== 'OPERATIONAL') problems.push(`สถานะใน Google: ${p.business_status}`)
  if (p.province && !String(p.province).includes('ขอนแก่น')) problems.push(`อยู่นอกจังหวัดขอนแก่น (${p.province})`)
  if (!p.district) problems.push('ไม่มีอำเภอ')
  return problems
}
