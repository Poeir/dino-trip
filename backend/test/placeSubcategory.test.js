import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySubcategory, isValidSubcategory, SUBCATEGORIES } from '../src/lib/placeSubcategory.js'

const food = (name, tags = []) => classifySubcategory({ name, category: 'ร้านอาหาร', tags })
const cafe = (name, tags = []) => classifySubcategory({ name, category: 'คาเฟ่', tags })

test('restaurant cuisines from the name', () => {
  assert.equal(food('ก๋วยเตี๋ยวเนื้อเซ้งฮง'), 'ก๋วยเตี๋ยว')
  assert.equal(food('ร้านเตี๋ยวเรือเมืองขอน'), 'ก๋วยเตี๋ยว')
  assert.equal(food('ส้มตำฟินแลนด์ - Somtum FINLAND'), 'อาหารอีสาน')
  assert.equal(food('ลาบโต๊ะแดง'), 'อาหารอีสาน')
  assert.equal(food('ร้านเฝอท่าบ่อ'), 'เวียดนาม')
  assert.equal(food('6AM อาหารเช้า'), 'อาหารเช้า')
})

test('specific cuisines win over the broad grill group', () => {
  assert.equal(food('WANG korean BBQ khonkaen'), 'ญี่ปุ่น/เกาหลี')
  assert.equal(food('Yakiniku Kintsugi (ยากินิคุ คินสึงิ)'), 'ญี่ปุ่น/เกาหลี')
  assert.equal(food('ทอมมี่ หมูย่างเกาหลี'), 'ญี่ปุ่น/เกาหลี')
  assert.equal(food('หมีกะหมู ชาบู&ปิ้งย่าง'), 'ปิ้งย่าง/ชาบู')
})

test('a noisy Japanese tag does not make a grill shop Japanese', () => {
  assert.equal(food('บุญดีหมูกะทะ', ['อาหารพื้นถิ่น', 'ครอบครัว', 'อาหารญี่ปุ่น']), 'ปิ้งย่าง/ชาบู')
  assert.equal(food('ร้านทั่วไปไม่มีคำบอก', ['อาหารญี่ปุ่น']), null)
})

test('specific tags are trusted when the name says nothing', () => {
  assert.equal(food('ครัวบ้านนา', ['ส้มตำ']), 'อาหารอีสาน')
  assert.equal(food('AKA สาขาเซ็นทรัล', ['บุฟเฟต์']), 'ปิ้งย่าง/ชาบู')
})

test('cafe sub-types', () => {
  assert.equal(cafe('SEP Cafe and Bar'), 'บาร์/bistro')
  assert.equal(cafe('043 Milk Bar (Feat. Cocoa more)'), null)
  assert.equal(cafe('Crusty Bakehouse – Homemade Bakery & Coffee'), 'เบเกอรี่/ของหวาน')
  assert.equal(cafe('ศรีจันทร์นมสด', ['ของหวาน']), 'เบเกอรี่/ของหวาน')
  assert.equal(cafe('Vector Coffee Roaster'), null)
})

test('other categories are never classified; validity check', () => {
  assert.equal(classifySubcategory({ name: 'ก๋วยเตี๋ยว', category: 'วัด', tags: [] }), null)
  assert.ok(isValidSubcategory('ร้านอาหาร', 'ก๋วยเตี๋ยว'))
  assert.ok(!isValidSubcategory('คาเฟ่', 'ก๋วยเตี๋ยว'))
  assert.ok(Object.values(SUBCATEGORIES).every((l) => l.length > 0))
})
