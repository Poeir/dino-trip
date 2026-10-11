import { httpError } from '../middleware/errorHandler.js'
import {
  AGE_MAX, AGE_MIN, COMMENT_FIELDS, DEMOGRAPHICS, DIMENSIONS, EXPERIENCE, MAX_COMMENT_LENGTH, OCCUPATION_OTHER_MAX, QUESTIONS, ageGroupOf,
} from './surveyQuestions.js'

// Validates a submitted questionnaire and returns the row to insert. Anything
// unexpected is a 400 -- the form only ever sends values from the lists in
// surveyQuestions.js, so a mismatch means a stale or hand-made request.
export function parseSubmission(body) {
  const b = body && typeof body === 'object' ? body : {}
  const row = {}

  for (const d of [...DEMOGRAPHICS, ...EXPERIENCE]) {
    if (d.derived) continue
    const value = b[d.key]
    if (!d.options.some((o) => o.value === value)) throw httpError(400, `กรุณาเลือก${d.label}`)
    row[d.column] = value
  }

  if (!Number.isInteger(b.age) || b.age < AGE_MIN || b.age > AGE_MAX) throw httpError(400, 'กรุณาเลือกอายุ')
  row.age = b.age
  row.age_group = ageGroupOf(b.age)

  // "อื่น ๆ" asks the respondent to say what; any other occupation stores nothing.
  row.occupation_other = null
  if (row.occupation === 'other') {
    const text = typeof b.occupationOther === 'string' ? b.occupationOther.trim() : ''
    if (!text) throw httpError(400, 'กรุณาระบุสถานภาพ')
    if (text.length > OCCUPATION_OTHER_MAX) throw httpError(400, `สถานภาพยาวเกินไป (ไม่เกิน ${OCCUPATION_OTHER_MAX} ตัวอักษร)`)
    row.occupation_other = text
  }

  const answers = b.answers && typeof b.answers === 'object' ? b.answers : {}
  for (const q of QUESTIONS) {
    const v = answers[q.no]
    // "ยังไม่เคยใช้" arrives as an explicit null; a missing key is still unanswered.
    if (v === null && q.skippable) { row[`q${q.no}`] = null; continue }
    if (!Number.isInteger(v) || v < 1 || v > 5) throw httpError(400, `กรุณาให้คะแนนข้อ ${q.no}`)
    row[`q${q.no}`] = v
  }

  for (const f of COMMENT_FIELDS) {
    const raw = b[f.key]
    if (raw == null || raw === '') { row[f.column] = null; continue }
    if (typeof raw !== 'string') throw httpError(400, 'ข้อเสนอแนะไม่ถูกต้อง')
    const text = raw.trim()
    if (text.length > MAX_COMMENT_LENGTH) throw httpError(400, `ข้อเสนอแนะยาวเกินไป (ไม่เกิน ${MAX_COMMENT_LENGTH} ตัวอักษร)`)
    row[f.column] = text || null
  }
  return row
}

const round2 = (n) => Math.round(n * 100) / 100

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

// Sample standard deviation (n - 1), the S.D. SPSS and Excel's STDEV report;
// null for fewer than two answers.
function stdev(xs) {
  if (xs.length < 2) return null
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

// Interpretation bands: width (5 - 1) / 5 = 0.80 (Best, 1981). Applied to the
// mean rounded to two decimals, as the report tables show it.
export function interpret(m) {
  if (m == null) return null
  const v = round2(m)
  if (v >= 4.21) return 'มากที่สุด'
  if (v >= 3.41) return 'มาก'
  if (v >= 2.61) return 'ปานกลาง'
  if (v >= 1.81) return 'น้อย'
  return 'น้อยที่สุด'
}

function stat(xs) {
  if (!xs.length) return { mean: null, sd: null, level: null }
  const m = mean(xs)
  const sd = stdev(xs)
  return { mean: round2(m), sd: sd == null ? null : round2(sd), level: interpret(m) }
}

// rows: survey_responses rows (needs q1..q16 and the demographic / experience columns).
// Per question: mean / S.D. / answer counts over the people who answered it
// (`answered`; "ยังไม่เคยใช้" is null and left out). Per dimension: each
// respondent's average over the items they answered, then mean / S.D. across
// respondents (the usual way a dimension row is reported); a respondent with
// no answer in the dimension is skipped. `overall` does the same over all 16.
export function summarize(rows) {
  const n = rows.length

  const questions = QUESTIONS.map((q) => {
    const values = rows.map((r) => r[`q${q.no}`]).filter((v) => v != null)
    const counts = [1, 2, 3, 4, 5].map((score) => values.filter((v) => v === score).length)
    return { no: q.no, dimension: q.dimension, text: q.text, skippable: !!q.skippable, answered: values.length, ...stat(values), counts }
  })

  const respondentAverages = (nos) => rows
    .map((r) => nos.map((no) => r[`q${no}`]).filter((v) => v != null))
    .filter((answers) => answers.length > 0)
    .map(mean)

  const dimensions = DIMENSIONS.map((d) => {
    const nos = QUESTIONS.filter((q) => q.dimension === d.key).map((q) => q.no)
    const averages = respondentAverages(nos)
    return { key: d.key, label: d.label, questionNos: nos, answered: averages.length, ...stat(averages) }
  })

  const overall = stat(respondentAverages(QUESTIONS.map((q) => q.no)))

  const distribution = (d) => ({
    key: d.key,
    label: d.label,
    options: d.options.map((o) => {
      const count = rows.filter((r) => r[d.column] === o.value).length
      return { value: o.value, label: o.label, count, percent: n ? round2((count / n) * 100) : 0 }
    }),
  })
  const demographics = DEMOGRAPHICS.map(distribution)
  const experience = EXPERIENCE.map(distribution)

  return { n, overall, dimensions, questions, demographics, experience }
}
