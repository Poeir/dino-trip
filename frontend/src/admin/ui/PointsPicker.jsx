import { useState } from 'react'
import FilterChips from './FilterChips.jsx'

// Preset chips + a "custom" chip that reveals a number input -- so admins pick a level instead of
// inventing a number, while any value stays possible. Shared by the QR and reward forms.
export default function PointsPicker({ value, onChange, presets, hint, label = 'จำนวนพอยท์' }) {
  const [customMode, setCustomMode] = useState(false)
  const num = Number(value)
  const isCustom = customMode || (value !== '' && value != null && !presets.includes(num))
  const options = [...presets.map((p) => ({ value: p, label: String(p) })), { value: 'custom', label: 'กำหนดเอง' }]

  const pick = (v) => {
    if (v === 'custom') { setCustomMode(true); return }
    setCustomMode(false)
    onChange(String(v))
  }

  return (
    <div className="ad-picker">
      <FilterChips label={label} options={options} value={isCustom ? 'custom' : num} onChange={pick} />
      {isCustom && (
        <input
          className="ad-input"
          aria-label={`${label} (กำหนดเอง)`}
          value={value ?? ''}
          inputMode="numeric"
          placeholder="พิมพ์จำนวนพอยท์"
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        />
      )}
      {hint && <div className="ad-hint">{hint}</div>}
    </div>
  )
}
