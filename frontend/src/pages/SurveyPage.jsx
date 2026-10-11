import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import { fetchSurveyQuestions, fetchSurveyStatus, submitSurvey } from '../lib/apiClient.js'
import { useSeo } from '../lib/useSeo.js'
import { MASCOT } from '../data/categoryImages.js'

// Anonymous satisfaction questionnaire for the project report. The questions
// come from the backend (GET /api/survey/questions) so the wording lives in one
// place -- see backend/src/lib/surveyQuestions.js.

const STORAGE_KEY = 'dino-survey-submitted'
const MAX_COMMENT = 1000

const card = { background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: '18px 20px', marginBottom: 16 }
const cardError = { borderColor: '#d9534f', boxShadow: '0 0 0 2px rgba(217,83,79,0.15)' }
const sectionTitle = { fontSize: 17, fontWeight: 800, color: '#1B5E20', margin: '28px 0 6px' }
const hint = { fontSize: 13, color: '#5f6a63', margin: '0 0 14px', lineHeight: 1.6 }

function rememberSubmitted() {
  try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* private mode: the notice is optional */ }
}
function wasSubmitted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

// Face and colour per score, so the five buttons read at a glance.
const LEVEL_STYLE = {
  1: { face: '😞', color: '#E57373' },
  2: { face: '🙁', color: '#FFB74D' },
  3: { face: '😐', color: '#FFD54F', dark: true },
  4: { face: '🙂', color: '#9CCC65' },
  5: { face: '😄', color: '#43A047' },
}

// One 1-5 rating question: five big tap targets, least to most satisfied
// (1 -> 5, left to right). Real radio inputs, so keyboard and screen readers
// work; the whole pill is the clickable label.
function LikertQuestion({ q, scale, value, onChange, invalid }) {
  const ordered = [...scale].sort((a, b) => a.value - b.value)
  return (
    <fieldset id={`q-${q.no}`} style={{ ...card, ...(invalid ? cardError : null), margin: '0 0 12px', minWidth: 0 }}>
      <legend style={{ padding: 0, fontSize: 14.5, fontWeight: 700, color: '#26332b', lineHeight: 1.5, float: 'left', width: '100%', marginBottom: 12 }}>
        <span style={{ color: '#388E3C', marginRight: 6 }}>{q.no}.</span>{q.text}
      </legend>
      <div style={{ clear: 'both', display: 'grid', gridTemplateColumns: `repeat(${scale.length}, minmax(0, 1fr))`, gap: 6 }}>
        {ordered.map((s) => {
          const active = value === s.value
          const lv = LEVEL_STYLE[s.value]
          return (
            <label
              key={s.value}
              style={{
                position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                padding: '10px 2px', borderRadius: 14, cursor: 'pointer', textAlign: 'center', minHeight: 74,
                border: `2px solid ${active ? lv.color : '#E3E0D0'}`,
                background: active ? lv.color : '#FBFAF4',
                color: active ? (lv.dark ? '#3b3000' : '#fff') : '#3d4a41',
                transform: active ? 'scale(1.04)' : 'none', boxShadow: active ? '0 4px 10px rgba(0,0,0,0.12)' : 'none',
                transition: 'background .12s, border-color .12s, transform .12s',
              }}
            >
              <input
                type="radio" name={`q${q.no}`} value={s.value} checked={active}
                onChange={() => onChange(q.no, s.value)}
                style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
              />
              <span style={{ fontSize: 22, lineHeight: 1.1 }} aria-hidden="true">{lv.face}</span>
              <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1 }}>{s.value}</span>
              <span style={{ fontSize: 11, lineHeight: 1.2 }}>{s.label}</span>
            </label>
          )
        })}
      </div>
      {q.skippable && (
        // null = "ยังไม่เคยใช้" (answered, but left out of the statistics); undefined = not answered yet.
        <label
          style={{
            position: 'relative', display: 'inline-block', marginTop: 10, padding: '6px 14px', borderRadius: 16, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            border: `1.5px solid ${value === null ? '#7a847d' : '#DCD8C6'}`,
            background: value === null ? '#EEF0EC' : '#fff', color: value === null ? '#26332b' : '#5f6a63',
          }}
        >
          <input
            type="radio" name={`q${q.no}`} value="" checked={value === null}
            onChange={() => onChange(q.no, null)}
            style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
          />
          ยังไม่เคยใช้ฟีเจอร์นี้
        </label>
      )}
    </fieldset>
  )
}

function ChoiceGroup({ demo, value, onChange, invalid }) {
  return (
    <fieldset id={`demo-${demo.key}`} style={{ ...card, ...(invalid ? cardError : null), minWidth: 0 }}>
      <legend style={{ padding: 0, fontSize: 14.5, fontWeight: 700, color: '#26332b', float: 'left', width: '100%', marginBottom: 10 }}>{demo.label}</legend>
      <div style={{ clear: 'both', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {demo.options.map((o) => {
          const active = value === o.value
          return (
            <label
              key={o.value}
              style={{
                position: 'relative', padding: '8px 16px', borderRadius: 20, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                border: `1.5px solid ${active ? '#388E3C' : '#DCD8C6'}`,
                background: active ? '#E8F5E9' : '#FBFAF4', color: active ? '#1B5E20' : '#3d4a41',
              }}
            >
              <input
                type="radio" name={demo.key} value={o.value} checked={active}
                onChange={() => onChange(demo.key, o.value)}
                style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
              />
              {o.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default function SurveyPage() {
  useSeo({ title: 'แบบสอบถามความพึงพอใจ', description: 'ร่วมตอบแบบสอบถามความพึงพอใจต่อระบบ Dino เที่ยวขอนแก่น', noindex: true })

  const [meta, setMeta] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [form, setForm] = useState({ gender: '', age: '', occupation: '', occupationOther: '', planMethod: '', planTime: '', aiUsage: '', khonKaenVisit: '', answers: {}, strengths: '', improvements: '', website: '' })
  const [missing, setMissing] = useState(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState(false)
  // One answer per browser: set from this device's flag at once, and from the
  // server's cookie check (survives clearing localStorage, and is the real gate).
  const [blocked, setBlocked] = useState(wasSubmitted)

  const load = () => {
    setLoadError(false)
    fetchSurveyQuestions().then(setMeta).catch(() => setLoadError(true))
  }
  useEffect(load, [])
  useEffect(() => {
    fetchSurveyStatus().then((s) => { if (s?.submitted) setBlocked(true) }).catch(() => { /* the POST still enforces it */ })
  }, [])

  // gender, age, occupation (the derived age group has no input of its own)
  const demoInputs = useMemo(() => (meta ? meta.demographics.filter((d) => !d.derived) : []), [meta])
  const experience = meta ? meta.experience : []
  const total = meta ? demoInputs.length + 1 + experience.length + meta.questions.length : 0
  const answered = useMemo(() => {
    if (!meta) return 0
    return demoInputs.filter((d) => form[d.key]).length + (form.age ? 1 : 0) + experience.filter((d) => form[d.key]).length + meta.questions.filter((q) => form.answers[q.no] !== undefined).length
  }, [meta, form, demoInputs, experience])

  if (loadError) return <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}><LoadError message="โหลดแบบสอบถามไม่สำเร็จ" onRetry={load} /></main>
  if (!meta) return <LoadingSpinner size={36} label="กำลังโหลดแบบสอบถาม..." />

  if (blocked && !done) {
    return (
      <main style={{ maxWidth: 520, margin: '0 auto', padding: 'var(--page-pv-center) var(--page-gutter)', textAlign: 'center' }}>
        <div style={{ ...card, padding: 32 }}>
          <img src={MASCOT.celebrate} alt="" width={88} height={88} style={{ width: 88, height: 'auto', marginBottom: 8 }} />
          <h1 data-font="culture" style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: '0 0 10px' }}>ท่านตอบแบบสอบถามนี้แล้ว</h1>
          <p style={{ ...hint, margin: '0 0 20px' }}>ขอบคุณที่สละเวลาช่วยกันนะครับ แบบสอบถามนี้ตอบได้เครื่องละ 1 ครั้ง</p>
          <Link to="/" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', padding: '10px 28px', borderRadius: 20, fontWeight: 800, fontSize: 14.5 }}>กลับหน้าแรก</Link>
        </div>
      </main>
    )
  }

  if (done) {
    return (
      <main style={{ maxWidth: 520, margin: '0 auto', padding: 'var(--page-pv-center) var(--page-gutter)', textAlign: 'center' }}>
        <div style={{ ...card, padding: 32 }}>
          <h1 data-font="culture" style={{ fontSize: 24, fontWeight: 800, color: '#1B5E20', margin: '0 0 10px' }}>ขอบคุณที่ร่วมตอบแบบสอบถาม</h1>
          <p style={{ ...hint, margin: '0 0 20px' }}>คำตอบของท่านถูกบันทึกแล้ว และจะนำไปใช้เพื่อปรับปรุงระบบให้ดียิ่งขึ้น</p>
          <Link to="/" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', padding: '10px 28px', borderRadius: 20, fontWeight: 800, fontSize: 14.5 }}>กลับหน้าแรก</Link>
        </div>
      </main>
    )
  }

  const setDemo = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setMissing((m) => { const n = new Set(m); n.delete(`demo-${key}`); return n })
  }
  const setAnswer = (no, value) => {
    setForm((f) => ({ ...f, answers: { ...f.answers, [no]: value } }))
    setMissing((m) => { const n = new Set(m); n.delete(`q-${no}`); return n })
  }

  const submit = async (e) => {
    e.preventDefault()
    if (submitting) return
    const gaps = [
      ...demoInputs.filter((d) => !form[d.key]).map((d) => `demo-${d.key}`),
      ...(form.age ? [] : ['demo-age']),
      ...experience.filter((d) => !form[d.key]).map((d) => `demo-${d.key}`),
      ...(form.occupation === 'other' && !form.occupationOther.trim() ? ['demo-occupationOther'] : []),
      ...meta.questions.filter((q) => form.answers[q.no] === undefined).map((q) => `q-${q.no}`),
    ]
    if (gaps.length) {
      setMissing(new Set(gaps))
      setSubmitError(`กรุณาตอบให้ครบทุกข้อ (ยังเหลือ ${gaps.length} ข้อ)`)
      document.getElementById(gaps[0])?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setSubmitError('')
    setSubmitting(true)
    try {
      await submitSurvey({
        gender: form.gender, age: Number(form.age), occupation: form.occupation, occupationOther: form.occupationOther,
        planMethod: form.planMethod, planTime: form.planTime, aiUsage: form.aiUsage, khonKaenVisit: form.khonKaenVisit,
        answers: form.answers, strengths: form.strengths, improvements: form.improvements, website: form.website,
      })
      rememberSubmitted()
      setDone(true)
      window.scrollTo({ top: 0 })
    } catch (err) {
      if (err.status === 409) { rememberSubmitted(); setBlocked(true); return }
      setSubmitError(err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' : err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const pct = total ? Math.round((answered / total) * 100) : 0

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 'var(--page-pv-center) var(--page-gutter)' }}>
      <div style={{ textAlign: 'center' }}>
        <img src={MASCOT.wave} alt="" width={88} height={88} style={{ width: 88, height: 'auto', marginBottom: 6 }} />
      </div>
      <h1 data-font="culture" style={{ fontSize: 24, fontWeight: 800, color: '#1B5E20', margin: '0 0 8px', textAlign: 'center' }}>ช่วยบอกน้องไดโนหน่อยนะ</h1>
      <p style={{ ...hint, textAlign: 'center', margin: '0 auto 12px', maxWidth: 560, fontSize: 14 }}>
        ความคิดเห็นของคุณช่วยให้ระบบวางแผนเที่ยวขอนแก่นดีขึ้นกว่าเดิม ใช้เวลาไม่เกิน 5 นาที
        และเป็นการตอบแบบไม่ระบุตัวตน ไม่มีถูกไม่มีผิด ตอบตามความรู้สึกได้เลย (ตอบได้ 1 ครั้งต่อเครื่อง)
      </p>
      <div style={{ background: '#E8F5E9', border: '1px solid #C8E6C9', borderRadius: 14, padding: '10px 14px', margin: '0 auto 18px', maxWidth: 560, fontSize: 13, color: '#2e4a33', lineHeight: 1.6, textAlign: 'center' }}>
        💡 ถ้ายังไม่ได้ลอง ลองถามแชทบอท 1 คำถาม และสร้างแผนเที่ยว 1 ทริปก่อน แล้วค่อยกลับมาตอบนะ
      </div>

      <form onSubmit={submit} noValidate>
        {/* Honeypot: people never see or fill this; bots that fill every input do. */}
        <input
          type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
          value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
          style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }}
        />

        <h2 style={sectionTitle}>ตอนที่ 1 ข้อมูลทั่วไป</h2>
        {demoInputs.map((d) => (
          <Fragment key={d.key}>
            <ChoiceGroup demo={d} value={form[d.key]} onChange={setDemo} invalid={missing.has(`demo-${d.key}`)} />
            {d.key === 'gender' && (
              <div id="demo-age" style={{ ...card, ...(missing.has('demo-age') ? cardError : null) }}>
                <label htmlFor="age" style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#26332b', marginBottom: 10 }}>อายุ</label>
                <select
                  id="age" value={form.age} onChange={(e) => setDemo('age', e.target.value)}
                  style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: '8px 12px', fontSize: 14, background: '#FBFAF4', minWidth: 160 }}
                >
                  <option value="">เลือกอายุ</option>
                  {Array.from({ length: meta.age.max - meta.age.min + 1 }, (_, i) => meta.age.min + i).map((a) => (
                    <option key={a} value={a}>{a} ปี</option>
                  ))}
                </select>
              </div>
            )}
            {d.key === 'occupation' && form.occupation === 'other' && (
              <div id="demo-occupationOther" style={{ ...card, ...(missing.has('demo-occupationOther') ? cardError : null) }}>
                <label htmlFor="occupationOther" style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#26332b', marginBottom: 8 }}>โปรดระบุอาชีพ</label>
                <input
                  id="occupationOther" type="text" maxLength={meta.occupationOtherMax} value={form.occupationOther}
                  onChange={(e) => setDemo('occupationOther', e.target.value)}
                  placeholder="เช่น พนักงานบริษัท, เจ้าของธุรกิจ, ข้าราชการ"
                  style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: '9px 12px', fontSize: 14, fontFamily: 'inherit' }}
                />
              </div>
            )}
          </Fragment>
        ))}

        <h2 style={sectionTitle}>ตอนที่ 2 ประสบการณ์ก่อนใช้งาน Dino</h2>
        <p style={hint}>คำถามสั้น ๆ 4 ข้อ เกี่ยวกับวิธีวางแผนเที่ยวของท่านก่อนที่จะใช้ระบบนี้</p>
        {experience.map((d) => (
          <ChoiceGroup key={d.key} demo={d} value={form[d.key]} onChange={setDemo} invalid={missing.has(`demo-${d.key}`)} />
        ))}

        <h2 style={sectionTitle}>ตอนที่ 3 ความพึงพอใจต่อระบบ</h2>
        <p style={hint}>
          แตะหน้ายิ้มที่ตรงกับความรู้สึกของท่านในแต่ละข้อ — 1 = น้อยที่สุด ไปจนถึง 5 = มากที่สุด
          หากยังไม่เคยใช้แชทบอทหรือตัวช่วยวางแผนเที่ยว ให้เลือก “ยังไม่เคยใช้ฟีเจอร์นี้” ในข้อนั้น
        </p>
        {meta.dimensions.map((dim, i) => {
          const items = meta.questions.filter((q) => q.dimension === dim.key)
          if (!items.length) return null
          return (
            <section key={dim.key} aria-label={dim.label} style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#26332b', margin: '0 0 10px', padding: '6px 12px', background: '#E8F5E9', borderRadius: 10 }}>
                {i + 1}. {dim.label}
              </h3>
              {items.map((q) => (
                <LikertQuestion key={q.no} q={q} scale={meta.scale} value={form.answers[q.no]} onChange={setAnswer} invalid={missing.has(`q-${q.no}`)} />
              ))}
            </section>
          )
        })}

        <h2 style={sectionTitle}>ตอนที่ 4 ข้อเสนอแนะ <span style={{ fontWeight: 500, fontSize: 13, color: '#5f6a63' }}>(ไม่บังคับ)</span></h2>
        {meta.comments.map((c) => (
          <div key={c.key} style={card}>
            <label htmlFor={`c-${c.key}`} style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#26332b', marginBottom: 8 }}>{c.label}</label>
            <textarea
              id={`c-${c.key}`} rows={3} maxLength={MAX_COMMENT} value={form[c.key]}
              onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
              style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 10, fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ textAlign: 'right', fontSize: 11.5, color: '#7a847d' }}>{form[c.key].length}/{MAX_COMMENT}</div>
          </div>
        ))}

        {submitError && <div role="alert" style={{ background: '#fdecec', color: '#a33232', fontSize: 13.5, padding: '10px 14px', borderRadius: 10, marginBottom: 14 }}>{submitError}</div>}

        {/* Sticks to the bottom so the progress and the send button are always in reach on a long form. */}
        <div style={{ position: 'sticky', bottom: 0, background: 'rgba(255,253,246,0.96)', padding: '10px 0 12px', borderTop: '1px solid #E7E3D2', zIndex: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#5f6a63', marginBottom: 6 }}>
            <span>ตอบแล้ว {answered} / {total} ข้อ</span><span>{pct}%</span>
          </div>
          <div style={{ height: 6, background: '#E7E3D2', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#66BB6A,#388E3C)', transition: 'width .2s' }} />
          </div>
          <button
            type="submit" disabled={submitting}
            style={{ width: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: 12, borderRadius: 20, fontWeight: 800, fontSize: 15, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? 'กำลังส่ง...' : 'ส่งแบบสอบถาม'}
          </button>
        </div>
      </form>
    </main>
  )
}
