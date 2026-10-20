import { useMemo, useState } from 'react'
import { useThaiAddress } from '../lib/thaiAddress.js'
import Field from './Field.jsx'

const fieldStyle = { width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }
const fixedFieldStyle = { ...fieldStyle, background: '#F5F4EE', color: '#5f6a63', cursor: 'not-allowed' }

// This app only covers Khon Kaen (see areaScopeMeta in data/seed.js -- even
// "ทั่วขอนแก่น" is districts of this one province, e.g. ภูเวียง/อุบลรัตน์), so
// a full 77-province cascade like SignupPage.jsx's would be one extra,
// pointless step here -- จังหวัด is fixed and shown as such, not hidden.
// Composes the free-text `address` field the form saves, and reports the
// structured อำเภอ/ตำบล/จังหวัด too (onCompose's second argument) so the place's
// own district/subdistrict/province columns stay filled -- same bare names as
// thaiAddress.json, which is what places.district etc. are normalized to.
// `district`/`subdistrict` are controlled by the form (so an edited place shows
// its current area); the address field stays directly editable for existing
// free-form text (Google-imported addresses especially) this doesn't try to
// parse back out.
const PROVINCE_NAME = 'ขอนแก่น'

// The street part of an existing address: everything before the first ตำบล/อำเภอ
// ("437 บ้านโคกฟันโป่ง ตำบลบ้านเป็ด อำเภอ…" -> "437 บ้านโคกฟันโป่ง"), so editing the area
// of a saved place keeps its street instead of rebuilding the address without it.
const streetOf = (address) => (address || '').split(/\s*(?:ตำบล|อำเภอ)/)[0].trim()

export default function AddressComposer({ address = '', district = '', subdistrict = '', onCompose }) {
  const [detail, setDetail] = useState(() => streetOf(address))

  // The address table loads on demand (lib/thaiAddress.js): empty lists until it arrives.
  const thaiAddress = useThaiAddress()
  const districts = useMemo(() => thaiAddress.find((p) => p.name === PROVINCE_NAME)?.districts ?? [], [thaiAddress])
  const subdistrictOptions = districts.find((d) => d.name === district)?.subdistricts || []

  const apply = (d, sd, det) => {
    setDetail(det)
    // Matches the format Google-imported addresses actually use in the DB
    // (checked directly: "437 บ้านโคกฟันโป่ง ตำบลบ้านเป็ด อำเภอเมืองขอนแก่น
    // ขอนแก่น 40000") -- full words ตำบล/อำเภอ, no dots, bare province name
    // at the end with no จ. prefix. Keeps admin-added places consistent with
    // the 445 Google-imported ones instead of introducing a second style.
    const parts = []
    if (det.trim()) parts.push(det.trim())
    if (sd) parts.push(`ตำบล${sd}`)
    if (d) parts.push(`อำเภอ${d}`)
    parts.push(PROVINCE_NAME)
    onCompose(parts.join(' '), { district: d || null, subdistrict: sd || null, province: PROVINCE_NAME })
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <Field label="ที่อยู่ (บ้านเลขที่ / ถนน / หมู่บ้าน)">
        <input value={detail} onChange={(e) => apply(district, subdistrict, e.target.value)} placeholder="เช่น 123 ถนนมิตรภาพ" style={{ ...fieldStyle, marginBottom: 10 }} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
        <Field label="อำเภอ">
          <select value={district} onChange={(e) => apply(e.target.value, '', detail)} style={fieldStyle}>
            <option value="">-- เลือกอำเภอ --</option>
            {districts.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="ตำบล">
          <select value={subdistrict} onChange={(e) => apply(district, e.target.value, detail)} disabled={!district} style={district ? fieldStyle : fixedFieldStyle}>
            <option value="">-- เลือกตำบล --</option>
            {subdistrictOptions.map((sd) => <option key={sd} value={sd}>{sd}</option>)}
          </select>
        </Field>
        <Field label="จังหวัด">
          <input value={PROVINCE_NAME} disabled style={fixedFieldStyle} />
        </Field>
      </div>
    </div>
  )
}
