// One-off: fill places.subcategory for ร้านอาหาร / คาเฟ่ rows that don't have one.
//
// Three steps, nothing touches the DB until `apply`:
//   node scripts/classify-subcategory.mjs export <dir>
//       rule-based pass (lib/placeSubcategory.js) -> <dir>/rules.json, and the
//       rows no rule was sure about, with their context -> <dir>/unclassified.json
//   cd ../chatbot-service && python scripts/classify_subcategory.py --input <dir>/unclassified.json --output <dir>/llm.json
//       LLM pass over just those rows
//   node scripts/classify-subcategory.mjs review <dir>
//       merges both into <dir>/review.csv (edit the `subcategory` column freely)
//   node scripts/classify-subcategory.mjs apply <dir>/review.csv
//       writes the CSV's values to rows whose subcategory is still empty
//
// Run from backend/ with the DB env loaded, e.g. `node --env-file=.env scripts/classify-subcategory.mjs ...`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../src/lib/db.js'
import { classifySubcategory, isValidSubcategory, SUBCATEGORIES } from '../src/lib/placeSubcategory.js'

const FOOD = Object.keys(SUBCATEGORIES)
const [cmd, target] = process.argv.slice(2)
if (!cmd || !target) {
  console.error('usage: classify-subcategory.mjs <export|review|apply> <dir|file.csv>')
  process.exit(1)
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

// Minimal RFC-4180 parser (the review file is written by this script and may be
// re-saved by Excel, which keeps the quoting).
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

if (cmd === 'export') {
  mkdirSync(target, { recursive: true })
  const rows = await db('places').select('id', 'name', 'category', 'tags', 'description', 'amenities', 'reviews')
    .whereIn('category', FOOD).whereNull('subcategory').where('is_active', true).orderBy('id')
  const rules = {}
  const unclassified = []
  for (const r of rows) {
    const sub = classifySubcategory(r)
    if (sub) { rules[r.id] = sub; continue }
    unclassified.push({
      id: r.id, name: r.name, category: r.category, tags: r.tags || [],
      description: r.description || '', amenities: r.amenities || [],
      reviews: (Array.isArray(r.reviews) ? r.reviews : []).slice(0, 3).map((v) => String(v?.text ?? '').slice(0, 240)).filter(Boolean),
    })
  }
  writeFileSync(join(target, 'rules.json'), JSON.stringify(rules, null, 1))
  writeFileSync(join(target, 'unclassified.json'), JSON.stringify(unclassified, null, 1))
  console.log(`rows ${rows.length}: by rules ${Object.keys(rules).length}, left for LLM ${unclassified.length}`)
} else if (cmd === 'review') {
  const rules = JSON.parse(readFileSync(join(target, 'rules.json'), 'utf8'))
  let llm = {}
  try { llm = JSON.parse(readFileSync(join(target, 'llm.json'), 'utf8')) } catch { console.warn('llm.json not found -- review file will have rule results only') }
  const rows = await db('places').select('id', 'name', 'category', 'tags').whereIn('category', FOOD).whereNull('subcategory').where('is_active', true).orderBy(['category', 'id'])
  const lines = [['id', 'name', 'category', 'subcategory', 'source', 'confidence', 'reason', 'tags'].map(csvCell).join(',')]
  const counts = {}
  for (const r of rows) {
    let sub = '', source = '', confidence = '', reason = ''
    if (rules[r.id]) { sub = rules[r.id]; source = 'rule'; confidence = 'high' }
    else if (llm[r.id] && isValidSubcategory(r.category, llm[r.id].subcategory)) {
      ({ subcategory: sub, confidence, reason } = llm[r.id]); source = 'llm'
    } else { source = 'none'; confidence = 'low' }
    counts[`${r.category} / ${sub || '(ว่าง)'}`] = (counts[`${r.category} / ${sub || '(ว่าง)'}`] || 0) + 1
    lines.push([r.id, r.name, r.category, sub, source, confidence, reason, (r.tags || []).join('|')].map(csvCell).join(','))
  }
  // BOM so Excel opens the Thai text as UTF-8.
  writeFileSync(join(target, 'review.csv'), '﻿' + lines.join('\r\n') + '\r\n')
  console.log(counts)
  console.log(`wrote ${join(target, 'review.csv')} (${rows.length} rows; check the confidence/source columns)`)
} else if (cmd === 'apply') {
  const [header, ...body] = parseCsv(readFileSync(target, 'utf8').replace(/^﻿/, ''))
  const col = Object.fromEntries(header.map((h, i) => [h, i]))
  let written = 0, skipped = 0, invalid = []
  await db.transaction(async (trx) => {
    for (const r of body) {
      const id = r[col.id], category = r[col.category], sub = (r[col.subcategory] || '').trim()
      if (!sub) { skipped++; continue }
      if (!isValidSubcategory(category, sub)) { invalid.push(`${id} ${r[col.name]}: "${sub}" ไม่อยู่ในรายการของ ${category}`); continue }
      // Only fill empties (never overwrite an admin's choice); null the embedding so
      // the RAG reindex picks the row up with its new subcategory.
      written += await trx('places').where({ id, category }).whereNull('subcategory').update({ subcategory: sub, embedding: null })
    }
    if (invalid.length) throw new Error(`ค่าไม่ถูกต้อง ${invalid.length} แถว -- ไม่เขียนอะไรเลย:\n${invalid.slice(0, 10).join('\n')}`)
  })
  console.log(`updated ${written} rows, skipped ${skipped} empty`)
  console.log('ต่อไป: รัน reindex (ปุ่มในแอดมิน หรือ cd chatbot-service && python scripts/embed_content.py) -- ระหว่างนี้ร้านเหล่านี้จะยังไม่ถูกค้นเจอในแชทบอท')
} else {
  console.error(`unknown command: ${cmd}`)
  process.exitCode = 1
}
await db.destroy()
