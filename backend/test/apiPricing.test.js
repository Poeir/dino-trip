import test from 'node:test'
import assert from 'node:assert/strict'
import { SKUS, THB_PER_USD, grossCostThb, importPerPlaceThb, getCostEstimates } from '../src/lib/apiPricing.js'

test('grossCostThb: units x price per 1,000 x exchange rate, no free allowance deducted', () => {
  assert.equal(grossCostThb({}), 0)
  const usd = SKUS['places.details.enterprise'].usdPer1000
  assert.equal(grossCostThb({ 'places.details.enterprise': 1000 }), Math.round(usd * THB_PER_USD * 100) / 100)
  assert.equal(grossCostThb({ 'places.details.enterprise': 1 }), Math.round(usd / 1000 * THB_PER_USD * 100) / 100)
  assert.equal(grossCostThb({ 'unknown.sku': 5000 }), 0) // unknown SKU never invents a price
})

test('importPerPlaceThb: Details (Atmosphere) plus the maximum number of photos', () => {
  const expected = grossCostThb({ 'places.details.enterprise_atmosphere': 1, 'places.photo': 5 })
  assert.equal(importPerPlaceThb(), expected)
  assert.ok(expected > grossCostThb({ 'places.details.enterprise': 1 }))
})

test('getCostEstimates: every per-click figure is a non-negative number', () => {
  const e = getCostEstimates()
  for (const k of ['syncPerPlaceThb', 'importPerPlaceThb', 'describePerPlaceThb', 'textSearchThb', 'nearbySearchThb']) {
    assert.equal(typeof e[k], 'number', k)
    assert.ok(e[k] >= 0, k)
  }
  assert.ok(e.nearbySearchThb > e.syncPerPlaceThb) // Nearby (Enterprise, $35) costs more per call than Details ($20)
})
