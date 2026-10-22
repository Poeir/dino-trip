import { db } from '../lib/db.js'
import { invalidateCache } from '../lib/crudRouter.js'
import { forwardToChatbotService } from '../lib/chatbotProxy.js'
import { SUBCATEGORIES } from '../lib/placeSubcategory.js'

// Optional step of the area-import job (placeAreaImport.js): when the rule-based
// mapping (scripts/place-category.js, lib/placeSubcategory.js) left a new draft's
// category -- or a restaurant/cafe's subcategory -- empty, ask the chatbot-service
// LLM to pick one (one LLM request per place, no web search). Only empty fields are
// filled, and only on a hidden draft.

export function needsClassify(row) {
  if (!row.category) return true
  return !!SUBCATEGORIES[row.category] && !row.subcategory
}

const reviewText = (r) => r?.text?.text || r?.originalText?.text || ''

// Returns { status: 'updated'|'skipped'|'failed', category?, subcategory?, confidence?, reason? }.
// Never throws: a missing category must not fail the import that already succeeded.
export async function classifyImportedPlace(placeId) {
  try {
    const row = await db('places').select('id', 'name', 'category', 'subcategory', 'is_active', 'raw_data').where('id', placeId).first()
    if (!row) return { status: 'skipped', reason: 'ไม่พบสถานที่' }
    if (row.is_active) return { status: 'skipped', reason: 'เผยแพร่แล้ว' }
    if (!needsClassify(row)) return { status: 'skipped', reason: 'ระบบจัดหมวดได้เองแล้ว' }

    const g = row.raw_data || {}
    const out = await forwardToChatbotService('/admin/places/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(row.name).slice(0, 200),
        fixedCategory: row.category || null,
        primaryType: g.primaryType ? String(g.primaryType).slice(0, 100) : null,
        types: (g.types || []).filter((t) => typeof t === 'string').slice(0, 40),
        summary: g.editorialSummary?.text ? String(g.editorialSummary.text).slice(0, 2000) : null,
        reviews: (g.reviews || []).map(reviewText).filter(Boolean).slice(0, 5).map((t) => t.slice(0, 1000)),
      }),
    })

    const patch = {}
    if (!row.category && out?.category) patch.category = out.category
    const category = row.category || patch.category
    if (!row.subcategory && out?.subcategory && SUBCATEGORIES[category]?.includes(out.subcategory)) patch.subcategory = out.subcategory
    if (!Object.keys(patch).length) return { status: 'skipped', reason: out?.reason || 'AI ไม่แน่ใจว่าเข้าหมวดใด', confidence: out?.confidence }

    // Category/subcategory are embedded fields (chatbot-service embedder), so null
    // the embedding like any other edit. is_active re-checked: a published place isn't touched.
    const n = await db('places').where({ id: row.id, is_active: false }).update({ ...patch, embedding: null, updated_at: db.fn.now() })
    if (!n) return { status: 'skipped', reason: 'เผยแพร่แล้ว' }
    invalidateCache('places')
    return { status: 'updated', category: patch.category, subcategory: patch.subcategory, confidence: out.confidence, reason: out.reason }
  } catch (err) {
    if (!err.status) console.error(`Classify after import failed for ${placeId}:`, err)
    return { status: 'failed', reason: (err.status ? err.message : 'AI จัดหมวดไม่สำเร็จ').slice(0, 300) }
  }
}
