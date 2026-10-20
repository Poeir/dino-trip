import { db } from '../lib/db.js'
import { invalidateCache } from '../lib/crudRouter.js'
import { forwardToChatbotService } from '../lib/chatbotProxy.js'

// Optional step of the area-import job (placeAreaImport.js): right after a place is
// imported as a hidden draft, write its description with the same chatbot-service
// generator behind the place form's AI button (Google reviews + Search snippets ->
// LLM). Each call costs one Serper search + one LLM request, so the import job caps
// how many places may use it. The text lands on the hidden draft; the admin still
// reviews it before publishing.
export const MAX_DESCRIBE_PER_IMPORT = 20

// Imports without a Google summary get googlePlaceRow.js mapDesc's generic
// "<category>ในขอนแก่น คะแนนรีวิว ..." line; that (or nothing) is what's worth
// replacing. A real Google summary is left alone.
export function hasPlaceholderDescription(description, category) {
  const d = String(description ?? '').trim()
  if (!d) return true
  return d.startsWith(`${category}ในขอนแก่น `) && /คะแนนรีวิว/.test(d)
}

// Returns 'updated' | 'skipped' | 'failed' (+ reason for the last two). Never throws:
// a missing description must not fail the import that already succeeded.
export async function describeImportedPlace(placeId) {
  try {
    const row = await db('places')
      .select('id', 'name', 'category', 'district', 'tags', 'amenities', 'description', 'is_active')
      .where('id', placeId).first()
    if (!row) return { status: 'skipped', reason: 'ไม่พบสถานที่' }
    if (row.is_active) return { status: 'skipped', reason: 'เผยแพร่แล้ว ไม่แก้ข้อความที่แสดงอยู่' }
    if (!hasPlaceholderDescription(row.description, row.category)) return { status: 'skipped', reason: 'มีคำอธิบายจาก Google อยู่แล้ว' }

    const out = await forwardToChatbotService('/admin/places/describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: row.id, name: String(row.name).slice(0, 200), category: String(row.category).slice(0, 100),
        district: row.district ? String(row.district).slice(0, 100) : null,
        tags: (row.tags || []).filter((s) => typeof s === 'string').slice(0, 30),
        amenities: (row.amenities || []).filter((s) => typeof s === 'string').slice(0, 50),
      }),
    })
    // template_only = no reviews/search to go on: the "description" is a stock
    // sentence, no better than what's there, so leave it for the admin to write.
    if (!out?.description || out.source === 'template_only') return { status: 'skipped', reason: 'ข้อมูลไม่พอสำหรับสร้างคำอธิบาย' }

    // is_active re-checked in the UPDATE so a place published meanwhile isn't rewritten.
    // `embedding` is nulled like every other edit of an embedded field (see places.routes.js).
    const n = await db('places').where({ id: row.id, is_active: false }).update({ description: out.description, embedding: null })
    if (!n) return { status: 'skipped', reason: 'เผยแพร่แล้ว ไม่แก้ข้อความที่แสดงอยู่' }
    invalidateCache('places')
    return { status: 'updated' }
  } catch (err) {
    if (!err.status) console.error(`Describe after import failed for ${placeId}:`, err)
    return { status: 'failed', reason: (err.status ? err.message : 'สร้างคำอธิบายไม่สำเร็จ').slice(0, 300) }
  }
}
