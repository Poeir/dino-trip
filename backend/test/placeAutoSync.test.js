import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateSettingsPatch, shouldRunNow, nextRunAt, bangkokDayStart, bangkokMonthStart, estimateCostThb, PRICING,
} from '../src/services/placeAutoSync.js'

test('validateSettingsPatch: maps camelCase to columns and keeps only what was sent', () => {
  assert.deepEqual(validateSettingsPatch({ enabled: true, monthlyCallCap: 900, ignored: 'x' }), { enabled: true, monthly_call_cap: 900 })
  assert.deepEqual(validateSettingsPatch({ runHour: 0, normalIntervalDays: 365 }), { run_hour: 0, normal_interval_days: 365 })
})

test('validateSettingsPatch: rejects out-of-range, non-integer, non-boolean and empty input', () => {
  for (const bad of [
    { runHour: 24 }, { runHour: -1 }, { normalIntervalDays: 0 }, { priorityIntervalDays: 366 },
    { monthlyCallCap: 100_001 }, { monthlyCallCap: 1.5 }, { monthlyCallCap: '900' }, { dailyMaxItems: 0 }, { dailyMaxItems: 501 },
    { enabled: 'true' }, { autoHideClosed: 1 },
    {}, null, { unknown: 1 },
  ]) {
    assert.throws(() => validateSettingsPatch(bad), (err) => err.status === 400, JSON.stringify(bad))
  }
  assert.doesNotThrow(() => validateSettingsPatch({ monthlyCallCap: 0 })) // 0 = effectively paused
})

// 2026-10-20 03:30 Asia/Bangkok == 2026-10-19 20:30 UTC
const at = (bangkokIso) => new Date(`${bangkokIso}+07:00`)

test('Bangkok calendar helpers use Thai time, not UTC', () => {
  assert.equal(bangkokDayStart(at('2026-10-20T03:30:00')).toISOString(), '2026-10-19T17:00:00.000Z')
  // 00:30 Bangkok on the 1st is still the previous day in UTC
  assert.equal(bangkokMonthStart(at('2026-11-01T00:30:00')).toISOString(), '2026-10-31T17:00:00.000Z')
  assert.equal(bangkokMonthStart(at('2026-10-31T23:59:00')).toISOString(), '2026-09-30T17:00:00.000Z')
})

test('shouldRunNow: runs at/after run_hour once per day, never when disabled', () => {
  const s = { enabled: true, runHour: 3 }
  assert.equal(shouldRunNow(s, at('2026-10-20T02:59:00'), false), false)
  assert.equal(shouldRunNow(s, at('2026-10-20T03:00:00'), false), true)
  assert.equal(shouldRunNow(s, at('2026-10-20T15:00:00'), false), true) // catch-up after a restart
  assert.equal(shouldRunNow(s, at('2026-10-20T15:00:00'), true), false)
  assert.equal(shouldRunNow({ ...s, enabled: false }, at('2026-10-20T15:00:00'), false), false)
})

test('nextRunAt: today if not yet run, now if overdue, tomorrow if done, null if disabled', () => {
  const s = { enabled: true, runHour: 3 }
  const before = at('2026-10-20T01:00:00')
  assert.equal(nextRunAt(s, before, false).toISOString(), at('2026-10-20T03:00:00').toISOString())
  const late = at('2026-10-20T10:00:00')
  assert.equal(nextRunAt(s, late, false).getTime(), late.getTime())
  assert.equal(nextRunAt(s, late, true).toISOString(), at('2026-10-21T03:00:00').toISOString())
  assert.equal(nextRunAt({ ...s, enabled: false }, late, false), null)
})

test('estimateCostThb: the free allowance is deducted, then billed per 1,000', () => {
  assert.equal(estimateCostThb(0), 0)
  assert.equal(estimateCostThb(PRICING.freeCallsPerMonth), 0)
  const expected = Math.round(1000 / 1000 * PRICING.usdPer1000 * PRICING.thbPerUsd)
  assert.equal(estimateCostThb(PRICING.freeCallsPerMonth + 1000), expected)
})
