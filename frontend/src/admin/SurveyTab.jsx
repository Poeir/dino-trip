import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Download, MessageSquareText, Smile, Star, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import LoadError from '../components/LoadError.jsx'
import PageControls from '../components/PageControls.jsx'
import { adminSurveyExportUrl, deleteAdminSurveyResponse, fetchAdminSurveyResponses, fetchAdminSurveySummary } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { fmtDateTime } from '../lib/format.js'
import AdminPageHeader from './ui/AdminPageHeader.jsx'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import DataTable from './ui/DataTable.jsx'
import FilterChips from './ui/FilterChips.jsx'
import ListState from './ui/ListState.jsx'
import StatCard from './ui/StatCard.jsx'
import { useConfirm } from './ui/ConfirmDialog.jsx'

// Satisfaction survey results (backend/src/routes/survey.routes.js): the
// x̄ / S.D. tables a project report quotes, plus the individual answers.

const LEVEL_TONE = { 'มากที่สุด': 'success', 'มาก': 'success', 'ปานกลาง': 'warning', 'น้อย': 'danger', 'น้อยที่สุด': 'danger' }
const num = (n) => Number(n).toLocaleString('th-TH')
const f2 = (n) => (n == null ? '-' : Number(n).toFixed(2))

const LevelBadge = ({ level }) => (level ? <Badge tone={LEVEL_TONE[level] || 'neutral'}>{level}</Badge> : <span className="ad-text-muted">-</span>)

function labelOf(demographics, key, value) {
  return demographics?.find((d) => d.key === key)?.options.find((o) => o.value === value)?.label || value
}

function HBars({ rows }) {
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div className="ad-bars">
      {rows.map((r, i) => (
        <div key={r.value} title={`${r.label}: ${num(r.count)} คน (${r.percent}%)`}>
          <div className="ad-bars__head">
            <span className="ad-ellipsis">{r.label}</span>
            <span className="ad-text-muted ad-nowrap">{num(r.count)} คน · {r.percent}%</span>
          </div>
          <div className="ad-bars__track">
            <div className="ad-bars__fill" style={{ width: `${(r.count / max) * 100}%`, '--i': i }}></div>
          </div>
        </div>
      ))}
    </div>
  )
}

const DIMENSION_COLUMNS = [
  { key: 'label', header: 'ด้าน', render: (d) => <span>{d.label} <span className="ad-text-muted ad-fs-xs">(ข้อ {d.questionNos[0]}–{d.questionNos[d.questionNos.length - 1]})</span></span> },
  { key: 'answered', header: 'จำนวนผู้ตอบ (คน)', nowrap: true, render: (d) => num(d.answered) },
  { key: 'mean', header: 'x̄', nowrap: true, render: (d) => f2(d.mean) },
  { key: 'sd', header: 'S.D.', nowrap: true, render: (d) => f2(d.sd) },
  { key: 'level', header: 'ระดับความพึงพอใจ', nowrap: true, render: (d) => <LevelBadge level={d.level} /> },
]

const QUESTION_COLUMNS = [
  { key: 'no', header: 'ข้อ', nowrap: true, render: (q) => q.no },
  { key: 'text', header: 'รายการประเมิน', render: (q) => q.text },
  { key: 'answered', header: 'จำนวนผู้ตอบ (คน)', nowrap: true, render: (q) => num(q.answered) },
  { key: 'mean', header: 'x̄', nowrap: true, render: (q) => f2(q.mean) },
  { key: 'sd', header: 'S.D.', nowrap: true, render: (q) => f2(q.sd) },
  { key: 'level', header: 'ระดับ', nowrap: true, render: (q) => <LevelBadge level={q.level} /> },
  // counts are ordered 1..5; shown 5..1 like the questionnaire's scale.
  { key: 'counts', header: 'จำนวนคนที่ตอบ 5 / 4 / 3 / 2 / 1', nowrap: true, render: (q) => [...q.counts].reverse().join(' / ') },
]

const RESPONSE_FILTERS = [
  { value: '', label: 'ทั้งหมด' },
  { value: '1', label: 'เฉพาะที่มีข้อเสนอแนะ' },
]

export default function SurveyTab() {
  const { actions } = useApp()
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState(false)
  const [commentsOnly, setCommentsOnly] = useState('')
  const paged = usePagedList(fetchAdminSurveyResponses, { pageSize: 20, extraParams: { comments: commentsOnly || undefined } })
  const { confirm, confirmDialog } = useConfirm()

  const loadSummary = useCallback(() => {
    setSummaryError(false)
    fetchAdminSurveySummary()
      .then(setSummary)
      .catch((err) => { if (!actions.handleSessionExpired(err)) setSummaryError(true) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { loadSummary() }, [loadSummary])

  const handleDelete = async (row) => {
    const res = await confirm({
      title: 'ลบคำตอบนี้?',
      message: 'คำตอบนี้จะถูกลบถาวรและไม่ถูกนับในสถิติ ใช้สำหรับลบข้อมูลทดสอบหรือคำตอบที่ไม่เหมาะสม',
      confirmLabel: 'ลบคำตอบ',
      danger: true,
      run: async () => {
        try {
          await deleteAdminSurveyResponse(row.id)
        } catch (err) {
          if (actions.handleSessionExpired(err)) err.silent = true
          throw err
        }
      },
    })
    if (!res) return
    actions.showToast('ลบคำตอบแล้ว')
    if (paged.rows.length === 1 && paged.page > 1) paged.setPage(paged.page - 1)
    paged.refetch()
    loadSummary()
  }

  const responseColumns = [
    { key: 'createdAt', header: 'ส่งเมื่อ', nowrap: true, render: (r) => fmtDateTime(r.createdAt) },
    {
      key: 'who', header: 'ผู้ตอบ',
      render: (r) => `${labelOf(summary?.demographics, 'gender', r.gender)} · ${r.age != null ? `${r.age} ปี` : labelOf(summary?.demographics, 'ageGroup', r.ageGroup)} · ${r.occupation === 'other' && r.occupationOther ? r.occupationOther : labelOf(summary?.demographics, 'occupation', r.occupation)}`,
    },
    { key: 'average', header: 'คะแนนเฉลี่ย', nowrap: true, render: (r) => f2(r.average) },
    {
      key: 'comments', header: 'ข้อเสนอแนะ',
      render: (r) => (r.strengths || r.improvements ? (
        <div>
          {r.strengths && <div><span className="ad-text-muted">พึงพอใจ: </span>{r.strengths}</div>}
          {r.improvements && <div><span className="ad-text-muted">ควรปรับปรุง: </span>{r.improvements}</div>}
        </div>
      ) : <span className="ad-text-muted">-</span>),
    },
    {
      key: 'actions', header: '',
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => handleDelete(r)} aria-label="ลบคำตอบนี้" title="ลบคำตอบนี้"><Trash2 size={14} aria-hidden="true" /></Button>
      ),
    },
  ]

  return (
    <>
      <AdminPageHeader
        title="ความพึงพอใจ"
        subtitle="ผลแบบสอบถามความพึงพอใจของผู้ใช้ (หน้าแบบสอบถาม: /survey)"
        actions={(
          <a className="ad-btn ad-btn--secondary ad-btn--md" href={adminSurveyExportUrl()} download>
            <Download size={15} aria-hidden="true" /> ดาวน์โหลด CSV
          </a>
        )}
      />

      {summaryError ? (
        <LoadError message="โหลดสรุปผลแบบสอบถามไม่สำเร็จ" onRetry={loadSummary} />
      ) : !summary ? (
        <ListState loading />
      ) : summary.n === 0 ? (
        <ListState empty emptyText="ยังไม่มีผู้ตอบแบบสอบถาม" />
      ) : (
        <>
          <div className="ad-stat-grid ad-stat-grid--sm">
            <StatCard icon={<ClipboardList size={20} />} value={summary.n} label="ผู้ตอบแบบสอบถาม (คน)" tone="success" />
            <StatCard icon={<Star size={20} />} value={f2(summary.overall.mean)} label={`ค่าเฉลี่ยรวม (S.D. ${f2(summary.overall.sd)})`} tone="warning" />
            <StatCard icon={<Smile size={20} />} value={summary.overall.level || '-'} label="ระดับความพึงพอใจโดยรวม" tone="info" />
            <StatCard icon={<MessageSquareText size={20} />} value={summary.withComments} label="คำตอบที่มีข้อเสนอแนะ" tone="neutral" />
          </div>

          <section className="ad-section" aria-labelledby="survey-dims">
            <h2 id="survey-dims" className="ad-section__title">สรุปรายด้าน</h2>
            <DataTable
              label="สรุปความพึงพอใจรายด้าน" rowKey="key" columns={DIMENSION_COLUMNS} rows={summary.dimensions}
              mobile="scroll"
            />
            <p className="ad-fs-xs ad-text-muted">
              x̄ และ S.D. รายด้านคำนวณจากค่าเฉลี่ยของผู้ตอบแต่ละคนในข้อของด้านนั้น (S.D. ของกลุ่มตัวอย่าง, n − 1)
              · ข้อ 4–10 ไม่นับผู้ที่เลือก “ยังไม่เคยใช้” จึงมีจำนวนผู้ตอบน้อยกว่าข้ออื่นได้
              · เกณฑ์แปลผล: 4.21–5.00 มากที่สุด, 3.41–4.20 มาก, 2.61–3.40 ปานกลาง, 1.81–2.60 น้อย, 1.00–1.80 น้อยที่สุด
            </p>
          </section>

          <section className="ad-section" aria-labelledby="survey-questions">
            <h2 id="survey-questions" className="ad-section__title">สรุปรายข้อ</h2>
            <DataTable label="สรุปความพึงพอใจรายข้อ" rowKey="no" columns={QUESTION_COLUMNS} rows={summary.questions} mobile="scroll" />
          </section>

          <section className="ad-section" aria-labelledby="survey-demo">
            <h2 id="survey-demo" className="ad-section__title">ข้อมูลทั่วไปและประสบการณ์ก่อนใช้งานของผู้ตอบ</h2>
            <div className="ad-card-grid">
              {[...summary.demographics, ...summary.experience].map((d) => (
                <div key={d.key} className="ad-panel ad-panel--tight">
                  <h3 className="ad-panel__title">{d.label}</h3>
                  <HBars rows={d.options} />
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="ad-section" aria-labelledby="survey-responses">
        <div className="ad-section__head">
          <h2 id="survey-responses" className="ad-section__title">คำตอบรายคน</h2>
          <FilterChips label="กรองคำตอบ" options={RESPONSE_FILTERS} value={commentsOnly} onChange={setCommentsOnly} />
        </div>
        {paged.error ? (
          <LoadError message="โหลดรายการคำตอบไม่สำเร็จ" onRetry={paged.refetch} />
        ) : (
          <>
            <DataTable
              label="รายการคำตอบ" columns={responseColumns} rows={paged.rows} loading={paged.loading}
              empty={commentsOnly ? 'ยังไม่มีคำตอบที่มีข้อเสนอแนะ' : 'ยังไม่มีผู้ตอบแบบสอบถาม'}
            />
            <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
          </>
        )}
      </section>
      {confirmDialog}
    </>
  )
}
