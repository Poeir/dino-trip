import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Field from '../components/Field.jsx'
import { useThaiAddress } from '../lib/thaiAddress.js'
import { updateProfile } from '../lib/apiClient.js'
import { Card, Notice, inputStyle, primaryBtn, ghostBtn, formGrid } from './ui.jsx'

const THAI_PHONE_RE = /^0\d{9}$/
const fromProfile = (p) => ({
  title: p.title || '', firstName: p.firstName || '', lastName: p.lastName || '', phone: p.phone || '',
  gender: p.gender || '', birthdate: p.birthdate || '', occupation: p.occupation || '',
  province: p.province || '', district: p.district || '', subdistrict: p.subdistrict || '',
})

export default function InfoTab({ profile, onSaved }) {
  const { derived } = useApp()
  const thaiAddress = useThaiAddress() // loaded on demand; [] until it arrives
  const [form, setForm] = useState(() => fromProfile(profile))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [touched, setTouched] = useState(false)

  const set = (key) => (e) => { setSaved(false); setForm((f) => ({ ...f, [key]: e.target.value })) }
  const setProvince = (e) => { setSaved(false); setForm((f) => ({ ...f, province: e.target.value, district: '', subdistrict: '' })) }
  const setDistrict = (e) => { setSaved(false); setForm((f) => ({ ...f, district: e.target.value, subdistrict: '' })) }

  const provinceData = thaiAddress.find((p) => p.name === form.province)
  const districtData = provinceData?.districts.find((d) => d.name === form.district)
  const districts = useMemo(() => provinceData?.districts.map((d) => d.name) ?? [], [provinceData])
  const subdistricts = districtData?.subdistricts ?? []

  const initial = fromProfile(profile)
  const dirty = Object.keys(initial).some((k) => initial[k] !== form[k])

  const errors = {
    firstName: !form.firstName.trim() && 'กรุณากรอกชื่อ',
    lastName: !form.lastName.trim() && 'กรุณากรอกนามสกุล',
    phone: !THAI_PHONE_RE.test(form.phone) && 'เบอร์โทรต้องมี 10 หลัก ขึ้นต้นด้วย 0',
    birthdate: (!form.birthdate || new Date(form.birthdate) > new Date()) && 'กรุณากรอกวันเกิดให้ถูกต้อง',
    title: !form.title && 'กรุณาเลือก', gender: !form.gender && 'กรุณาเลือก', occupation: !form.occupation && 'กรุณาเลือก',
    province: !form.province && 'กรุณาเลือก', district: !form.district && 'กรุณาเลือก', subdistrict: !form.subdistrict && 'กรุณาเลือก',
  }
  const hasErrors = Object.values(errors).some(Boolean)
  const show = (k) => (touched ? errors[k] || undefined : undefined)

  const submit = async (e) => {
    e.preventDefault()
    setTouched(true)
    if (hasErrors) return
    setSaving(true); setError(''); setSaved(false)
    try {
      const next = await updateProfile({ ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim() })
      onSaved(next)
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const options = (list) => list.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)

  return (
    <form onSubmit={submit} noValidate>
      <Card title="ข้อมูลส่วนตัว">
        <div style={formGrid}>
          <Field label="คำนำหน้า" required error={show('title')}>
            <select value={form.title} onChange={set('title')} style={inputStyle}><option value="">เลือก</option>{options(derived.titleOptions)}</select>
          </Field>
          <Field label="ชื่อจริง" required error={show('firstName')}><input value={form.firstName} onChange={set('firstName')} maxLength={100} style={inputStyle} /></Field>
          <Field label="นามสกุล" required error={show('lastName')}><input value={form.lastName} onChange={set('lastName')} maxLength={100} style={inputStyle} /></Field>
          <Field label="เพศ" required error={show('gender')}>
            <select value={form.gender} onChange={set('gender')} style={inputStyle}><option value="">เลือก</option>{options(derived.genderOptions)}</select>
          </Field>
          <Field label="วันเกิด" required error={show('birthdate')}>
            <input type="date" value={form.birthdate} onChange={set('birthdate')} max={new Date().toISOString().slice(0, 10)} style={inputStyle} />
          </Field>
          <Field label="อาชีพ" required error={show('occupation')}>
            <select value={form.occupation} onChange={set('occupation')} style={inputStyle}><option value="">เลือก</option>{options(derived.occupationOptions)}</select>
          </Field>
          <Field label="เบอร์โทรศัพท์" required error={show('phone')}>
            <input value={form.phone} onChange={set('phone')} inputMode="numeric" maxLength={10} placeholder="0812345678" style={inputStyle} />
          </Field>
        </div>
      </Card>

      <Card title="ที่อยู่">
        <div style={formGrid}>
          <Field label="จังหวัด" required error={show('province')}>
            <select value={form.province} onChange={setProvince} style={inputStyle}><option value="">เลือก</option>{options(thaiAddress.map((p) => p.name))}</select>
          </Field>
          <Field label="อำเภอ/เขต" required error={show('district')}>
            <select value={form.district} onChange={setDistrict} disabled={!form.province} style={inputStyle}><option value="">เลือก</option>{options(districts)}</select>
          </Field>
          <Field label="ตำบล/แขวง" required error={show('subdistrict')}>
            <select value={form.subdistrict} onChange={set('subdistrict')} disabled={!form.district} style={inputStyle}><option value="">เลือก</option>{options(subdistricts)}</select>
          </Field>
        </div>
      </Card>

      <Notice>{error}</Notice>
      <Notice kind="success">{saved && 'บันทึกข้อมูลเรียบร้อยแล้ว'}</Notice>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="submit" disabled={!dirty || saving} style={primaryBtn(!dirty || saving)}>{saving ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}</button>
        {dirty && <button type="button" onClick={() => { setForm(fromProfile(profile)); setTouched(false); setError('') }} style={ghostBtn}>ยกเลิกการแก้ไข</button>}
      </div>
      <p style={{ fontSize: 12, color: '#626863', marginTop: 14 }}>อีเมลแก้ไขได้ที่แท็บ “ความปลอดภัย”</p>
    </form>
  )
}
