// One-off: re-derive the "อาหารพื้นถิ่น" tag on every active restaurant with
// lib/localFood.js (until 2026-10-21 every restaurant had it).
//
//   node --env-file=.env scripts/retag-local-food.mjs preview <file.csv>
//       nothing is written to the DB: prints a summary and writes every
//       restaurant whose tag would change to <file.csv> (edit the `local`
//       column -- yes/no -- to override a row)
//   node --env-file=.env scripts/retag-local-food.mjs apply <file.csv>
//       sets the tag as the CSV says, and clears `embedding` on the changed
//       rows (tags are part of the embedded text). Then re-embed:
//       cd ../chatbot-service && python scripts/embed_content.py
//
// Non-restaurants that carry the tag are only listed, never changed.
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '../src/lib/db.js'
import { isLocalFood, LOCAL_FOOD_TAG } from '../src/lib/localFood.js'

const [cmd, file] = process.argv.slice(2)
if (!['preview', 'apply'].includes(cmd) || !file) {
  console.error('usage: retag-local-food.mjs <preview|apply> <file.csv>')
  process.exit(1)
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

try {
  if (cmd === 'preview') {
    const rows = await db('places').select('id', 'name', 'category', 'subcategory', 'tags')
      .where('is_active', true).orderBy('name')
    const restaurants = rows.filter((r) => r.category === 'ร้านอาหาร')
    const changes = []
    let keep = 0
    for (const r of restaurants) {
      const has = (r.tags || []).includes(LOCAL_FOOD_TAG)
      const want = isLocalFood(r)
      if (want) keep++
      if (has !== want) changes.push({ ...r, want })
    }
    const others = rows.filter((r) => r.category !== 'ร้านอาหาร' && (r.tags || []).includes(LOCAL_FOOD_TAG))

    console.log(`restaurants: ${restaurants.length}, local food after the change: ${keep}`)
    console.log(`tag removed: ${changes.filter((c) => !c.want).length}, tag added: ${changes.filter((c) => c.want).length}`)
    const bySub = {}
    for (const r of restaurants) {
      const k = r.subcategory || '(none)'
      bySub[k] ??= { local: 0, not: 0 }
      bySub[k][isLocalFood(r) ? 'local' : 'not']++
    }
    console.log('by subcategory (local / not):')
    for (const [k, v] of Object.entries(bySub)) console.log(`  ${k}: ${v.local} / ${v.not}`)
    if (others.length) {
      console.log('non-restaurants with the tag (left as they are):')
      for (const r of others) console.log(`  ${r.name} [${r.category}]`)
    }

    const lines = [['id', 'name', 'subcategory', 'tags', 'local'].map(csvCell).join(',')]
    for (const c of changes) {
      lines.push([c.id, c.name, c.subcategory, (c.tags || []).join('|'), c.want ? 'yes' : 'no'].map(csvCell).join(','))
    }
    writeFileSync(file, '﻿' + lines.join('\n') + '\n')
    console.log(`wrote ${changes.length} rows to ${file}`)
  } else {
    const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
    const rows = text.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
      const cells = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'))
      return { id: cells[0], local: (cells[4] || '').trim().toLowerCase() }
    })
    let changed = 0
    await db.transaction(async (trx) => {
      for (const { id, local } of rows) {
        if (local !== 'yes' && local !== 'no') throw new Error(`row ${id}: local must be yes or no, got "${local}"`)
        const row = await trx('places').select('tags', 'category').where({ id }).first()
        if (!row || row.category !== 'ร้านอาหาร') continue
        const tags = (row.tags || []).filter((t) => t !== LOCAL_FOOD_TAG)
        if (local === 'yes') tags.unshift(LOCAL_FOOD_TAG)
        if (tags.length === (row.tags || []).length && tags.every((t, i) => t === row.tags[i])) continue
        await trx('places').where({ id }).update({ tags, embedding: null })
        changed++
      }
    })
    console.log(`updated ${changed} restaurants; now run: cd ../chatbot-service && python scripts/embed_content.py`)
  }
} finally {
  await db.destroy()
}
