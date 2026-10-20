// Google addressComponents / Thai address text -> bare, consistently spelled
// อำเภอ / ตำบล / จังหวัด for the places.district / subdistrict / province
// columns. Mirrors the backfill in 20261020000001_place_admin_area_columns.sql
// -- keep the two in step. Names use the spelling of
// frontend/src/data/thaiAddress.json (what users.district comes from), so
// Mueang is "เมืองขอนแก่น", not "เมือง" / "Muang" / "อ.เมือง".
const THAI = /[ก-๛]/
const MUEANG = 'เมืองขอนแก่น'

const component = (comps, type) => (comps || []).find((c) => c.types?.includes(type))?.longText || ''
const stripPrefix = (text, prefix) => String(text || '').replace(/[​-‍﻿]/g, '').replace(prefix, '').trim()

export function normalizeDistrict(text) {
  const d = stripPrefix(text, /^(อำเภอ|อ\.|amphur|amphoe)\s*/i)
  if (!d) return null
  if (d === 'เมือง' || d === MUEANG || ['muang', 'mueang'].includes(d.toLowerCase())) return MUEANG
  return d
}

export function normalizeProvince(text, address = '') {
  const p = stripPrefix(text, /^จังหวัด\s*/)
  if (p === 'ขอนแก่น' || p.toLowerCase() === 'khon kaen') return 'ขอนแก่น'
  return /ขอนแก่น|khon kaen/i.test(address) ? 'ขอนแก่น' : null
}

// Google only returns a ตำบล component for some places (480/700 in our data,
// all in Mueang); the rest have it in the address text ("ตำบล วังสวาบ อำเภอ ...").
export function mapAdminArea(addressComponents, address = '') {
  const fromComp = stripPrefix(component(addressComponents, 'sublocality_level_1'), /^(ตำบล|ต\.|tumbon|tambon)\s*/i)
  const fromAddress = address.match(/ตำบล\s*([ก-๛]+)/)?.[1]
  const district = normalizeDistrict(component(addressComponents, 'administrative_area_level_2') || address.match(/อำเภอ\s*([ก-๛]+)/)?.[1])
  return {
    province: normalizeProvince(component(addressComponents, 'administrative_area_level_1'), address),
    district,
    subdistrict: (THAI.test(fromComp) ? fromComp : fromAddress) || null,
  }
}
