import { useState } from 'react'
import thaiAddress from '../data/thaiAddress.json'
import Field from './Field.jsx'

const fieldStyle = { width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }
const fixedFieldStyle = { ...fieldStyle, background: '#F5F4EE', color: '#6d7a72', cursor: 'not-allowed' }

// This app only covers Khon Kaen (see areaScopeMeta in data/seed.js -- even
// "ทั่วขอนแก่น" is districts of this one province, e.g. ภูเวียง/อุบลรัตน์), so
// a full 77-province cascade like SignupPage.jsx's would be one extra,
// pointless step here -- จังหวัด is fixed and shown as such, not hidden.
// Composes into the same free-text `address` field the form already saves
// (no schema change); that field stays directly editable below for existing
// free-form text (Google-imported addresses especially) this doesn't try to
// parse back out.
const PROVINCE_NAME = 'ขอนแก่น'
const khonKaen = thaiAddress.find((p) => p.name === PROVINCE_NAME)

export default function AddressComposer({ onCompose }) {
  const [district, setDistrict] = useState('')
  const [subdistrict, setSubdistrict] = useState('')
  const [detail, setDetail] = useState('')

  const subdistrictOptions = khonKaen.districts.find((d) => d.name === district)?.subdistricts || []

  const apply = (d, sd, det) => {
    setDistrict(d)
    setSubdistrict(sd)
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
    onCompose(parts.join(' '))
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
            {khonKaen.districts.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
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
