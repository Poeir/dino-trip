import test from 'node:test'
import assert from 'node:assert/strict'
import { hasPlaceholderDescription } from '../src/services/placeBulkDescribe.js'

test('hasPlaceholderDescription: empty and the import fallback line count as placeholders', () => {
  assert.equal(hasPlaceholderDescription('', 'คาเฟ่'), true)
  assert.equal(hasPlaceholderDescription(null, 'คาเฟ่'), true)
  assert.equal(hasPlaceholderDescription('คาเฟ่ในขอนแก่น คะแนนรีวิว 4.5 ดาว จากผู้ใช้ Google Maps 120 คน', 'คาเฟ่'), true)
  assert.equal(hasPlaceholderDescription('คาเฟ่ในขอนแก่น ยังไม่มีคะแนนรีวิว', 'คาเฟ่'), true)
})

test('hasPlaceholderDescription: real text is never replaced', () => {
  assert.equal(hasPlaceholderDescription('คาเฟ่บรรยากาศสวนร่มรื่น เหมาะกับนั่งทำงาน', 'คาเฟ่'), false)
  // Same sentence shape but a different category: not this place's fallback line.
  assert.equal(hasPlaceholderDescription('คาเฟ่ในขอนแก่น คะแนนรีวิว 4.5 ดาว', 'ร้านอาหาร'), false)
})
