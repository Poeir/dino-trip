import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSubmission, summarize, interpret } from '../src/lib/surveyStats.js'
import { QUESTIONS } from '../src/lib/surveyQuestions.js'

const answersOf = (score) => Object.fromEntries(QUESTIONS.map((q) => [q.no, score]))
const validBody = (over = {}) => ({ gender: 'female', age: 25, occupation: 'student', planMethod: 'social', planTime: '1-3h', aiUsage: 'sometimes', khonKaenVisit: 'visited', answers: answersOf(4), ...over })

// A DB-shaped row (what summarize() receives), every question answered `score`.
const rowOf = (score, over = {}) => ({
  gender: 'female', age_group: '20-29', occupation: 'student',
  ...Object.fromEntries(QUESTIONS.map((q) => [`q${q.no}`, score])), ...over,
})

test('parseSubmission maps a valid body to table columns', () => {
  const row = parseSubmission(validBody({ strengths: '  ใช้ง่าย  ', improvements: '' }))
  assert.equal(row.gender, 'female')
  assert.equal(row.age_group, '20-29')
  assert.equal(row.occupation, 'student')
  assert.equal(row.q1, 4)
  assert.equal(row.q16, 4)
  assert.equal(row.exp_plan_method, 'social')
  assert.equal(row.exp_khonkaen, 'visited')
  assert.equal(row.strengths, 'ใช้ง่าย')
  assert.equal(row.improvements, null)
})

test('parseSubmission rejects unknown demographics and bad scores', () => {
  assert.throws(() => parseSubmission(validBody({ gender: 'x' })), { status: 400 })
  assert.throws(() => parseSubmission(validBody({ age: undefined })), { status: 400 })
  assert.throws(() => parseSubmission(validBody({ answers: { ...answersOf(3), 7: 6 } })), { status: 400 })
  assert.throws(() => parseSubmission(validBody({ answers: { ...answersOf(3), 7: 0 } })), { status: 400 })
  assert.throws(() => parseSubmission(validBody({ answers: { ...answersOf(3), 7: '5' } })), { status: 400 })
  const missing = answersOf(3)
  delete missing[9]
  assert.throws(() => parseSubmission(validBody({ answers: missing })), { status: 400 })
  assert.throws(() => parseSubmission(null), { status: 400 })
})

test('parseSubmission: "ยังไม่เคยใช้" (null) only for skippable questions', () => {
  const row = parseSubmission(validBody({ answers: { ...answersOf(4), 4: null, 9: null } }))
  assert.equal(row.q4, null)
  assert.equal(row.q9, null)
  assert.equal(row.q5, 4)
  // q1 is not skippable, and an absent key is unanswered, not "never used".
  assert.throws(() => parseSubmission(validBody({ answers: { ...answersOf(4), 1: null } })), { status: 400 })
  const missing = answersOf(4)
  delete missing[5]
  assert.throws(() => parseSubmission(validBody({ answers: missing })), { status: 400 })
})

test('parseSubmission: exact age fills the derived age group', () => {
  const group = (age) => parseSubmission(validBody({ age })).age_group
  assert.equal(group(19), 'under20')
  assert.equal(group(20), '20-29')
  assert.equal(group(39), '30-39')
  assert.equal(group(40), '40plus')
  assert.equal(parseSubmission(validBody({ age: 25 })).age, 25)
  for (const bad of [9, 100, 25.5, '25', null]) {
    assert.throws(() => parseSubmission(validBody({ age: bad })), { status: 400 })
  }
})

test('parseSubmission: occupation "other" needs a description', () => {
  assert.throws(() => parseSubmission(validBody({ occupation: 'other' })), { status: 400 })
  assert.throws(() => parseSubmission(validBody({ occupation: 'other', occupationOther: '   ' })), { status: 400 })
  assert.throws(() => parseSubmission(validBody({ occupation: 'other', occupationOther: 'ก'.repeat(101) })), { status: 400 })
  assert.equal(parseSubmission(validBody({ occupation: 'other', occupationOther: ' พนักงานบริษัท ' })).occupation_other, 'พนักงานบริษัท')
  // Ignored (not stored) when another occupation is picked.
  assert.equal(parseSubmission(validBody({ occupation: 'student', occupationOther: 'x' })).occupation_other, null)
})

test('parseSubmission: prior-experience answers are required and checked', () => {
  assert.throws(() => parseSubmission(validBody({ aiUsage: undefined })), { status: 400 })
  assert.throws(() => parseSubmission(validBody({ planMethod: 'telepathy' })), { status: 400 })
  assert.equal(parseSubmission(validBody({ planTime: 'gt3h' })).exp_plan_time, 'gt3h')
})

test('summarize: prior-experience distribution', () => {
  const rows = [rowOf(4, { exp_ai_usage: 'never' }), rowOf(4, { exp_ai_usage: 'never' }), rowOf(4, { exp_ai_usage: 'often' })]
  const ai = summarize(rows).experience.find((d) => d.key === 'aiUsage')
  assert.equal(ai.options.find((o) => o.value === 'never').count, 2)
  assert.equal(ai.options.find((o) => o.value === 'never').percent, 66.67)
})

test('parseSubmission caps comment length', () => {
  assert.throws(() => parseSubmission(validBody({ strengths: 'ก'.repeat(1001) })), { status: 400 })
  assert.equal(parseSubmission(validBody({ strengths: 'ก'.repeat(1000) })).strengths.length, 1000)
})

test('interpret uses the 0.80-wide bands on the rounded mean', () => {
  assert.equal(interpret(5), 'มากที่สุด')
  assert.equal(interpret(4.21), 'มากที่สุด')
  assert.equal(interpret(4.2), 'มาก')
  assert.equal(interpret(4.205), 'มากที่สุด') // rounds to 4.21 first
  assert.equal(interpret(3.41), 'มาก')
  assert.equal(interpret(3.4), 'ปานกลาง')
  assert.equal(interpret(2.61), 'ปานกลาง')
  assert.equal(interpret(1.81), 'น้อย')
  assert.equal(interpret(1.8), 'น้อยที่สุด')
  assert.equal(interpret(null), null)
})

test('summarize: empty set has no means', () => {
  const s = summarize([])
  assert.equal(s.n, 0)
  assert.equal(s.overall.mean, null)
  assert.equal(s.questions.length, 16)
  assert.deepEqual(s.questions[0].counts, [0, 0, 0, 0, 0])
})

test('summarize: mean, sample S.D. and counts per question', () => {
  // q1 answered 5, 4, 3 -> mean 4, sample SD 1
  const rows = [rowOf(5), rowOf(4), rowOf(3)]
  const q1 = summarize(rows).questions[0]
  assert.equal(q1.mean, 4)
  assert.equal(q1.sd, 1)
  assert.deepEqual(q1.counts, [0, 0, 1, 1, 1])
  assert.equal(q1.level, 'มาก')
})

test('summarize: dimension stats average each respondent first', () => {
  // Respondent A: planner items (q7..q10) = 5,5,4,4 -> 4.5; B: 3,3,3,3 -> 3.
  const a = rowOf(5, { q9: 4, q10: 4 })
  const b = rowOf(3)
  const planner = summarize([a, b]).dimensions.find((d) => d.key === 'planner')
  assert.deepEqual(planner.questionNos, [7, 8, 9, 10])
  assert.equal(planner.mean, 3.75) // (4.5 + 3) / 2
  assert.equal(planner.sd, 1.06) // sample SD of 4.5 and 3
})

test('summarize: "ยังไม่เคยใช้" is left out, not counted as a score', () => {
  const never = { q4: null, q5: null, q6: null, q7: null, q8: null, q9: null, q10: null }
  const s = summarize([rowOf(5), rowOf(3), rowOf(1, never)])
  const q4 = s.questions.find((q) => q.no === 4)
  assert.equal(q4.answered, 2)
  assert.equal(q4.mean, 4) // (5 + 3) / 2, the third respondent skipped it
  assert.deepEqual(q4.counts, [0, 0, 1, 0, 1])
  assert.equal(s.questions.find((q) => q.no === 1).answered, 3)
  const chatbot = s.dimensions.find((d) => d.key === 'chatbot')
  assert.equal(chatbot.answered, 2)
  assert.equal(chatbot.mean, 4)
  // Respondent 3 still counts toward the overall mean through its other items.
  assert.equal(s.overall.mean, 3) // (5 + 3 + 1) / 3
})

test('summarize: a dimension nobody answered has no mean', () => {
  const never = { q7: null, q8: null, q9: null, q10: null }
  const planner = summarize([rowOf(4, never), rowOf(2, never)]).dimensions.find((d) => d.key === 'planner')
  assert.equal(planner.answered, 0)
  assert.equal(planner.mean, null)
  assert.equal(planner.level, null)
})

test('summarize: a single respondent has a mean but no S.D.', () => {
  const s = summarize([rowOf(5)])
  assert.equal(s.overall.mean, 5)
  assert.equal(s.overall.sd, null)
  assert.equal(s.overall.level, 'มากที่สุด')
})

test('summarize: demographic counts and percentages', () => {
  const rows = [rowOf(4), rowOf(4, { gender: 'male' }), rowOf(4), rowOf(4, { occupation: 'tourist' })]
  const s = summarize(rows)
  const gender = s.demographics.find((d) => d.key === 'gender')
  assert.equal(gender.options.find((o) => o.value === 'female').count, 3)
  assert.equal(gender.options.find((o) => o.value === 'female').percent, 75)
  assert.equal(gender.options.find((o) => o.value === 'male').percent, 25)
  const occ = s.demographics.find((d) => d.key === 'occupation')
  assert.equal(occ.options.find((o) => o.value === 'tourist').count, 1)
})
