import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { httpError } from '../middleware/errorHandler.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { rateLimit } from '../lib/rateLimit.js'
import { db } from '../lib/db.js'
import { APP_VERSION } from '../lib/version.js'
import { AGE_MAX, AGE_MIN, COMMENT_FIELDS, DEMOGRAPHICS, EXPERIENCE, OCCUPATION_OTHER_MAX, DIMENSIONS, QUESTIONS, QUESTION_COLUMNS, SCALE } from '../lib/surveyQuestions.js'
import { parseSubmission, summarize } from '../lib/surveyStats.js'

// ---------------------------------------------------------------------------
// Respondent side: mounted at /api/survey (no login -- the survey is anonymous)
// ---------------------------------------------------------------------------
export const surveyRouter = Router()

// Classmates answering from one campus network share an IP, so this is loose;
// it is only meant to stop a script from flooding the table.
const submitLimit = rateLimit({
  windowMs: 60 * 60 * 1000, max: 40, keyFn: (req) => req.ip,
  message: 'ส่งแบบสอบถามบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
})

surveyRouter.get('/questions', (req, res) => {
  res.json({ scale: SCALE, dimensions: DIMENSIONS, questions: QUESTIONS, demographics: DEMOGRAPHICS, experience: EXPERIENCE, comments: COMMENT_FIELDS, age: { min: AGE_MIN, max: AGE_MAX }, occupationOtherMax: OCCUPATION_OTHER_MAX })
})

// One answer per browser. The survey is anonymous (no account, no IP stored), so
// "one per person" can only be a cookie set once a response is saved. It stops
// repeat taps and casual re-submits; someone who clears cookies or switches
// browser can still answer again, which is the price of staying anonymous.
const DONE_COOKIE = 'survey_done'
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000
const alreadyAnswered = (req) => req.cookies?.[DONE_COOKIE] === '1'

surveyRouter.get('/status', (req, res) => {
  res.json({ submitted: alreadyAnswered(req) })
})

surveyRouter.post('/', submitLimit, asyncHandler(async (req, res) => {
  // Honeypot: the form renders a hidden "website" field no person fills in.
  // Pretend success so a bot gets no signal, but store nothing.
  if (typeof req.body?.website === 'string' && req.body.website.trim()) return res.status(201).json({ ok: true })
  if (alreadyAnswered(req)) throw httpError(409, 'เครื่องนี้ตอบแบบสอบถามแล้ว ขอบคุณที่ร่วมตอบ')
  const row = parseSubmission(req.body)
  await db('survey_responses').insert({ ...row, app_version: APP_VERSION })
  res.cookie(DONE_COOKIE, '1', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: ONE_YEAR_MS,
  })
  res.status(201).json({ ok: true })
}))

// ---------------------------------------------------------------------------
// Admin side: mounted at /api/admin/survey
// ---------------------------------------------------------------------------
export const adminSurveyRouter = Router()
adminSurveyRouter.use(requireAdmin)

const DEMOGRAPHIC_COLUMNS = [...DEMOGRAPHICS, ...EXPERIENCE].map((d) => d.column)

adminSurveyRouter.get('/summary', asyncHandler(async (req, res) => {
  const rows = await db('survey_responses').select(...QUESTION_COLUMNS, ...DEMOGRAPHIC_COLUMNS)
  const withComments = await db('survey_responses')
    .whereRaw("(coalesce(btrim(strengths), '') <> '' or coalesce(btrim(improvements), '') <> '')")
    .count('id as c').first()
  res.json({ ...summarize(rows), withComments: Number(withComments.c) })
}))

// Individual responses, newest first; `comments=1` keeps only the ones with a
// free-text answer (what the report's open-ended section is written from).
adminSurveyRouter.get('/responses', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const filtered = () => {
    const b = db('survey_responses')
    return req.query.comments === '1'
      ? b.whereRaw("(coalesce(btrim(strengths), '') <> '' or coalesce(btrim(improvements), '') <> '')")
      : b
  }
  const { c } = await filtered().count('id as c').first()
  const rows = await filtered()
    .select('id', 'strengths', 'improvements', 'created_at', 'age', 'occupation_other', ...QUESTION_COLUMNS, ...DEMOGRAPHIC_COLUMNS)
    .orderBy('created_at', 'desc').limit(pageSize).offset((page - 1) * pageSize)
  const total = Number(c)
  res.json({
    data: rows.map((r) => {
      const scores = QUESTION_COLUMNS.map((col) => r[col]).filter((v) => v != null) // 16 answers minus any "ยังไม่เคยใช้"
      return {
        id: r.id,
        gender: r.gender, age: r.age, ageGroup: r.age_group, occupation: r.occupation, occupationOther: r.occupation_other,
        average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100,
        strengths: r.strengths, improvements: r.improvements, createdAt: r.created_at,
      }
    }),
    total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
}))

// Test submissions can be removed so they don't skew the report.
adminSurveyRouter.delete('/:id', asyncHandler(async (req, res) => {
  const n = await db('survey_responses').where('id', req.params.id).delete()
  if (!n) throw httpError(404, 'ไม่พบข้อมูล')
  res.status(204).end()
}))

// CSV of every response (one row each, Q1..Q16 as numbers) for SPSS / Excel.
// The BOM makes Excel read the Thai text as UTF-8. Cells that start with a
// formula character get a leading apostrophe so a comment can't run as one.
const csvCell = (v) => {
  if (v == null) return ''
  let s = v instanceof Date ? v.toISOString() : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

adminSurveyRouter.get('/export', asyncHandler(async (req, res) => {
  const rows = await db('survey_responses')
    .select('id', 'created_at', 'gender', 'age', 'age_group', 'occupation', 'occupation_other', ...EXPERIENCE.map((d) => d.column), ...QUESTION_COLUMNS, 'strengths', 'improvements', 'app_version')
    .orderBy('created_at', 'asc')
  const header = ['id', 'submitted_at', 'gender', 'age', 'age_group', 'occupation', 'occupation_other', ...EXPERIENCE.map((d) => d.column), ...QUESTION_COLUMNS.map((c) => c.toUpperCase()), 'strengths', 'improvements', 'app_version']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([r.id, r.created_at, r.gender, r.age, r.age_group, r.occupation, r.occupation_other, ...EXPERIENCE.map((d) => r[d.column]), ...QUESTION_COLUMNS.map((c) => r[c]), r.strengths, r.improvements, r.app_version].map(csvCell).join(','))
  }
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', 'attachment; filename="survey-responses.csv"')
  res.send(`﻿${lines.join('\r\n')}\r\n`)
}))
