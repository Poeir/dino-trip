import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortPlacesByRanking } from '../src/services/placeRanking.js'

const rows = [
  { name: 'ร้านดาวเด่น', category: 'ร้านอาหาร', rating: 4.9, review_count: 580 },
  { name: 'ตลาดดัง', category: 'ตลาด', rating: 4.6, review_count: 7000 },
  { name: 'วัดเล็ก', category: 'วัด', rating: 5.0, review_count: 3 },
  { name: 'จุดปักหมุด', category: 'วัด', rating: 4.0, review_count: 10, is_featured: true },
  { name: 'ไม่มีคะแนน', category: 'สถานที่ท่องเที่ยว', rating: null, review_count: 0 },
]
const names = (list) => list.map((r) => r.name)

test('recommended: featured first, then well-known beats high-rated-but-obscure', () => {
  const out = names(sortPlacesByRanking(rows, {}))
  assert.equal(out[0], 'จุดปักหมุด')
  assert.ok(out.indexOf('ตลาดดัง') < out.indexOf('ร้านดาวเด่น'))
  assert.ok(out.indexOf('ตลาดดัง') < out.indexOf('วัดเล็ก'))
  assert.equal(out.at(-1), 'ไม่มีคะแนน')
})

test('popular: by review count', () => {
  assert.equal(names(sortPlacesByRanking(rows, { sort: 'popular' }))[0], 'ตลาดดัง')
})

test('topRated: weighted rating does not let a 3-review 5.0 win', () => {
  const out = names(sortPlacesByRanking(rows, { sort: 'topRated' }))
  assert.notEqual(out[0], 'วัดเล็ก')
})
