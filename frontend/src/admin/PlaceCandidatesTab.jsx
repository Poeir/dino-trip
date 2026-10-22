import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import {
  fetchPlaceCandidates, fetchPlaceCandidateUsage, importPlaceCandidate, dismissPlaceCandidate, restorePlaceCandidate,
} from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { fmtDateTime } from '../lib/format.js'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import ReportQueueCard, { ReportQueue } from './ReportQueueCard.jsx'

const STATUS_FILTERS = [
  { key: 'pending', label: 'รอพิจารณา' },
  { key: 'imported', label: 'นำเข้าแล้ว' },
  { key: 'dismissed', label: 'ไม่สนใจ' },
]

function Detail({ label, children }) {
  if (children == null || children === '') return null
  return <div className="ad-fs-sm"><span className="ad-text-muted">{label}: </span>{children}</div>
}

// Google places the chatbot showed because our data for that area was thin
// (chatbot-service rag/google_fallback.py). The ones users keep asking about
// are worth importing: import writes an AI description, then publishes the
// place if it passes the quality check, else leaves it a hidden draft.
export default function PlaceCandidatesTab() {
  const { actions } = useApp()
  const [status, setStatus] = useState('pending')
  const paged = usePagedList(fetchPlaceCandidates, { pageSize: 10, extraParams: { status } })
  const [busyId, setBusyId] = useState('')
  const [results, setResults] = useState({})
  const [usage, setUsage] = useState(null)

  useEffect(() => {
    fetchPlaceCandidateUsage().then(setUsage).catch(() => setUsage(null))
  }, [])

  const run = async (gid, fn, done) => {
    setBusyId(gid)
    try {
      const out = await fn()
      done?.(out)
      paged.refetch()
    } catch (err) {
      actions.reportError('ดำเนินการไม่สำเร็จ: ', err)
      paged.refetch()
    } finally {
      setBusyId('')
    }
  }

  const doImport = (c) => run(c.googlePlaceId, () => importPlaceCandidate(c.googlePlaceId), (out) => {
    setResults((r) => ({ ...r, [c.googlePlaceId]: out }))
    if (!out.created) actions.showToast('สถานที่นี้มีในระบบอยู่แล้ว เชื่อมโยงให้แล้ว')
    else if (out.published) actions.showToast(`นำเข้าและเผยแพร่ “${c.name}” แล้ว`)
    else actions.showToast(`นำเข้า “${c.name}” เป็นฉบับร่าง (ยังไม่ผ่านเกณฑ์) ตรวจได้ที่แท็บ “สถานที่”`)
  })

  const usageText = usage
    ? `แชทบอทค้น Google วันนี้ ${usage.today} ครั้ง · เดือนนี้ ${usage.month} ครั้ง (ประมาณ ฿${usage.monthCostThb.toLocaleString('th-TH')})`
    : undefined

  // These places come from the chatbot's own Google search when our data is
  // thin, not from users naming them -- the wording says so.
  const subtitle = (
    <>
      แชทบอทค้นเพิ่มจาก Google เมื่อข้อมูลในระบบมีน้อย เลือกสถานที่ที่ควรเพิ่มเข้าระบบได้
      {usageText && <><br />{usageText}</>}
    </>
  )

  return (
    <ReportQueue
      title="สถานที่จาก Google ที่แชทบอทแนะนำ"
      subtitle={subtitle}
      countText={`${paged.total} รายการ`}
      filters={STATUS_FILTERS}
      status={status}
      onStatus={setStatus}
      paged={paged}
      errorText="โหลดรายการไม่สำเร็จ"
      emptyText={status === 'pending' ? 'ยังไม่มีสถานที่จาก Google ที่รอตรวจ' : 'ไม่มีรายการในสถานะนี้'}
    >
      {paged.rows.map((c) => {
        const busy = busyId === c.googlePlaceId
        const result = results[c.googlePlaceId]
        return (
          <ReportQueueCard
            key={c.googlePlaceId}
            title={c.name}
            badges={<Badge tone={c.askCount >= 3 ? 'warning' : 'neutral'}>แชทบอทแนะนำ {c.askCount} ครั้ง</Badge>}
            meta={<span className="ad-card__meta ad-card__push">ล่าสุด {fmtDateTime(c.lastAskedAt)}</span>}
          >
            <div className="ad-card__body">
              <Detail label="ผู้ใช้ถามถึงพื้นที่">{c.areaQuery}</Detail>
              <Detail label="ประเภท">{c.category}</Detail>
              <Detail label="คะแนน Google">{c.rating != null ? `${c.rating} (${c.reviewCount ?? 0} รีวิว)` : null}</Detail>
              <Detail label="ที่อยู่">{c.address}</Detail>
              {c.mapsUrl && <div className="ad-fs-sm"><a href={c.mapsUrl} target="_blank" rel="noopener noreferrer">ดูใน Google Maps</a></div>}

              {result && result.created && !result.published && result.problems?.length > 0 && (
                <div className="ad-fs-sm ad-text-danger">ยังไม่เผยแพร่ เพราะ: {result.problems.join(', ')}</div>
              )}
              {c.status === 'imported' && <div className="ad-fs-xs ad-text-muted">นำเข้าเมื่อ {fmtDateTime(c.decidedAt)} — แก้ไขได้ที่แท็บ “สถานที่”</div>}

              {c.status === 'pending' && (
                <div className="ad-actions ad-actions--top">
                  <Button disabled={!!busyId} loading={busy} onClick={() => doImport(c)}>
                    {busy ? 'กำลังนำเข้า (อาจใช้เวลา ~30 วินาที)...' : 'นำเข้า'}
                  </Button>
                  <Button variant="ghost" disabled={!!busyId} onClick={() => run(c.googlePlaceId, () => dismissPlaceCandidate(c.googlePlaceId), () => actions.showToast('ซ่อนจากคิวแล้ว'))}>ไม่สนใจ</Button>
                </div>
              )}
              {c.status === 'dismissed' && (
                <div className="ad-actions ad-actions--top">
                  <Button variant="secondary" disabled={!!busyId} onClick={() => run(c.googlePlaceId, () => restorePlaceCandidate(c.googlePlaceId), () => actions.showToast('นำกลับเข้าคิวแล้ว'))}>นำกลับเข้าคิว</Button>
                </div>
              )}
            </div>
          </ReportQueueCard>
        )
      })}
    </ReportQueue>
  )
}
