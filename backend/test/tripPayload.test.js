import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTripPayload } from '../src/lib/tripPayload.js'

const slot = (overrides) => ({ arrivalTime: '16:20', departureTime: '16:20', ...overrides })
const body = (items) => ({ days: [{ date: '2026-08-03', items }] })

test('a trip_end slot keeps its own name and coordinates', () => {
  const { days } = parseTripPayload(body([
    slot({ kind: 'trip_end', placeName: 'ท่าอากาศยานขอนแก่น', lat: 16.46663, lng: 102.78368, status: 'End of Trip' }),
  ]))
  const [item] = days[0].items
  assert.equal(item.kind, 'trip_end')
  assert.equal(item.place_id, null)
  assert.equal(item.place_name, 'ท่าอากาศยานขอนแก่น')
  assert.equal(item.snapshot_lat, 16.46663)
})

test('a trip_end slot without coordinates is rejected', () => {
  assert.throws(() => parseTripPayload(body([slot({ kind: 'trip_end', placeName: 'สนามบิน' })])), /พิกัด/)
})

test('an unknown slot kind is still rejected', () => {
  assert.throws(() => parseTripPayload(body([slot({ kind: 'airport', placeName: 'x', lat: 1, lng: 1 })])), /ประเภท/)
})
