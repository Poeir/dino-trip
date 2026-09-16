import { useState } from 'react'

const parseList = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean)

// Picking from `options` (a fixed vocabulary) instead of typing free text
// avoids near-duplicate values that silently fail to match anywhere else in
// the app (see frontend/src/data/placeVocabulary.js for why). The custom
// "add" input stays as an escape hatch -- for a genuinely new value, and so
// existing free-text data (already in the comma-separated string) doesn't
// just disappear the moment this control replaces a plain text input.
//
// Selected and available options are shown in two separate blocks (not one
// flat wall of 24-30 chips) with a search box narrowing the available list --
// scanning a mixed pile that only grows as you pick more was the actual
// complaint this fixes.
export default function ChipMultiSelect({ value, onChange, options, addPlaceholder = 'เพิ่มเอง...' }) {
  const selected = parseList(value)
  const [customInput, setCustomInput] = useState('')
  const [search, setSearch] = useState('')

  const add = (opt) => { if (!selected.includes(opt)) onChange([...selected, opt].join(', ')) }
  const remove = (opt) => onChange(selected.filter((s) => s !== opt).join(', '))

  const addCustom = () => {
    const v = customInput.trim()
    setCustomInput('')
    if (v) add(v)
  }

  const q = search.trim().toLowerCase()
  const availableOptions = options.filter((opt) => !selected.includes(opt) && (!q || opt.toLowerCase().includes(q)))

  return (
    <div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 10, background: '#F1F8F2', border: '1px solid #CFE8D2', borderRadius: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#2E7D32', marginRight: 2 }}>เลือกแล้ว ({selected.length})</span>
          {selected.map((tag) => (
            <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#2E7D32', color: '#fff', borderRadius: 14, padding: '4px 6px 4px 12px', fontSize: 12.5, fontWeight: 600 }}>
              {tag}
              <button type="button" onClick={() => remove(tag)} aria-label={`ลบ ${tag}`} style={{ background: 'rgba(255,255,255,0.3)', border: 'none', borderRadius: '50%', width: 16, height: 16, cursor: 'pointer', color: '#fff', fontSize: 11, lineHeight: '16px', padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`ค้นหาจากทั้งหมด ${options.length} รายการ...`}
        style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: '7px 10px', fontSize: 13, marginBottom: 8 }}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 130, overflowY: 'auto', padding: 2, marginBottom: 10 }}>
        {availableOptions.length === 0
          ? <span style={{ fontSize: 12, color: '#8a938c', padding: '4px 2px' }}>{q ? `ไม่พบรายการที่ตรงกับ "${search}"` : 'เลือกครบทุกรายการแล้ว'}</span>
          : availableOptions.map((opt) => (
            <button key={opt} type="button" onClick={() => add(opt)} style={{ border: '1px solid #DCD8C6', background: '#fff', color: '#3c463f', borderRadius: 14, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer' }}>
              + {opt}
            </button>
          ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
          placeholder={addPlaceholder}
          style={{ flex: 1, border: '1px solid #DCD8C6', borderRadius: 8, padding: '7px 9px', fontSize: 13 }}
        />
        <button type="button" onClick={addCustom} style={{ border: '1px solid #DCD8C6', background: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, color: '#3c463f', cursor: 'pointer' }}>+ เพิ่ม</button>
      </div>
    </div>
  )
}
