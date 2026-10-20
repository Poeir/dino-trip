import test from 'node:test'
import assert from 'node:assert/strict'
import { mapAdminArea, normalizeDistrict } from '../src/lib/placeAdminArea.js'

const comp = (longText, ...types) => ({ longText, types })

test('normalizeDistrict unifies every Mueang spelling and strips prefixes', () => {
  for (const v of ['อำเภอเมืองขอนแก่น', 'เมือง', 'อ.เมือง', 'Muang', 'muang', 'Amphur mueang']) {
    assert.equal(normalizeDistrict(v), 'เมืองขอนแก่น', v)
  }
  assert.equal(normalizeDistrict('อำเภอ ภูผาม่าน'), 'ภูผาม่าน')
  assert.equal(normalizeDistrict('อำเภอชุมแพ'), 'ชุมแพ')
  assert.equal(normalizeDistrict('\u200b'), null)
  assert.equal(normalizeDistrict(null), null)
})

test('mapAdminArea prefers the Google ตำบล component', () => {
  const r = mapAdminArea([
    comp('ตำบลในเมือง', 'sublocality_level_1', 'sublocality', 'political'),
    comp('อำเภอเมืองขอนแก่น', 'administrative_area_level_2', 'political'),
    comp('ขอนแก่น', 'administrative_area_level_1', 'political'),
  ], '1 ถนนมิตรภาพ ตำบลศิลา อำเภอเมืองขอนแก่น ขอนแก่น 40000')
  assert.deepEqual(r, { province: 'ขอนแก่น', district: 'เมืองขอนแก่น', subdistrict: 'ในเมือง' })
})

test('mapAdminArea falls back to the address text for ตำบล and a non-Thai component', () => {
  const addr = 'บ้านวังมน ต JQRR+GH8 ตำบล วังสวาบ อำเภอ ภูผาม่าน ขอนแก่น 40350'
  assert.equal(mapAdminArea([], addr).subdistrict, 'วังสวาบ')
  assert.equal(mapAdminArea([], addr).district, 'ภูผาม่าน')
  assert.equal(mapAdminArea([comp('Nai Muang', 'sublocality_level_1')], 'ตำบล ศิลา อำเภอเมืองขอนแก่น ขอนแก่น').subdistrict, 'ศิลา')
})

test('mapAdminArea returns nulls when nothing is known', () => {
  assert.deepEqual(mapAdminArea(undefined, ''), { province: null, district: null, subdistrict: null })
})

test('placePayload stores อำเภอ/ตำบล/จังหวัด bare and only when sent', async () => {
  const { placePayload } = await import('../src/lib/mappers.js')
  const base = { name: 'ร้านทดสอบ', category: 'ร้านอาหาร' }
  const withArea = placePayload({ ...base, district: 'อำเภอเมือง', subdistrict: 'ตำบลศิลา', province: 'จังหวัดขอนแก่น' })
  assert.equal(withArea.district, 'เมืองขอนแก่น')
  assert.equal(withArea.subdistrict, 'ศิลา')
  assert.equal(withArea.province, 'ขอนแก่น')
  assert.equal(placePayload({ ...base, district: '', subdistrict: '' }).district, null)
  const omitted = placePayload(base)
  assert.ok(!('district' in omitted) && !('subdistrict' in omitted) && !('province' in omitted))
})
