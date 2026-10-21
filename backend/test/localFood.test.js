import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLocalFood, LOCAL_FOOD_TAG } from '../src/lib/localFood.js'

const food = (name, tags = [], subcategory = undefined) => isLocalFood({ name, category: 'ร้านอาหาร', tags, subcategory })

test('Isan dishes in the name are local, whatever else the name says', () => {
  assert.equal(food('หมีส้ม TUM ส้มตำ'), true)
  assert.equal(food('ซอยถี่ ขอนแก่น ลาบ ก้อย ซอยจุ๊ แจ่วฮ้อน'), true)
  assert.equal(food('ร้านกุ้งแจ่วฮ้อน หมูกระทะบุฟเฟ่ต์'), true)
  assert.equal(food('อัมพรแหนมเนือง ต้นตำรับ'), true)
})

test('chains, buffets, hot pot, Japanese and Korean are not', () => {
  assert.equal(food('สุกี้ตี๋น้อย โลตัส ขอนแก่น2', [LOCAL_FOOD_TAG, 'สุกี้']), false)
  assert.equal(food('Sukishi @Central Khonkaen', [LOCAL_FOOD_TAG, 'อาหารเกาหลี']), false)
  assert.equal(food('โอกิ ยากินิคุแอนด์อิซากายะ'), false)
  assert.equal(food('ฟู่หยวนหม่าล่าเสฉวน'), false)
  assert.equal(food('ร้านเฮฮาหมูย่างเกาหลี'), false)        // a หมูกระทะ grill, not Isan pork
  assert.equal(food('เทียนเทียนติ่มซำ', [], 'อาหารเช้า'), false)
})

test('"ตำ" inside other words is not ส้มตำ', () => {
  assert.equal(food('ร้านเกาะกลาง ตำบลในเมือง'), false)
  assert.equal(food('ก๋วยเตี๋ยวเรือรสนิยมต้นตำรับ'), true)  // local, but for the noodles
})

test('everyday Thai food and local subcategories count', () => {
  assert.equal(food('ทองแดงก๋วยเตี๋ยวเนื้อ'), true)
  assert.equal(food('กับข้าวกับปลานวลหง ร8'), true)
  assert.equal(food('ร้านลักษณ์อาหารเช้า', [], 'อาหารเช้า'), true)
  assert.equal(food('ร้านเดอะวัน', ['อาหารไทย']), true)
})

test('nothing to go on means not local; the tag itself is never evidence', () => {
  assert.equal(food('Seasons 27 at Ad Lib Khon Kaen', [LOCAL_FOOD_TAG, 'ครอบครัว']), false)
  assert.equal(food('BUONO Italian Restaurant', ['อาหารอิตาเลียน']), false)
})

test('only restaurants', () => {
  assert.equal(isLocalFood({ name: 'ตลาดส้มตำ', category: 'ตลาด', tags: [] }), false)
})
