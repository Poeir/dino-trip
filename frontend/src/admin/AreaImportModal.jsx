import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import Button from './ui/Button.jsx'
import Badge from './ui/Badge.jsx'
import FormSection, { FormError } from './ui/FormSection.jsx'
import { searchGooglePlacesByArea, startPlaceImportBatch, fetchPlaceImportBatch, cancelPlaceImportBatch } from '../lib/apiClient.js'

const CATEGORIES = [
  { value: 'cafe', label: 'คาเฟ่' },
  { value: 'restaurant', label: 'ร้านอาหาร' },
  { value: 'attraction', label: 'สถานที่ท่องเที่ยว' },
  { value: 'shopping', label: 'ช้อปปิ้ง' },
]
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]))
const RADIUS_OPTIONS = [1000, 3000, 5000, 10000]
// Mirrors MAX_BATCH in backend/src/services/placeAreaImport.js.
const MAX_BATCH = 50
// Mirrors MAX_DESCRIBE_PER_IMPORT in backend/src/services/placeBulkDescribe.js.
const MAX_DESCRIBE = 20
const DESCRIPTION_LABEL = { updated: 'สร้างคำอธิบายแล้ว', skipped: 'ข้ามคำอธิบาย', failed: 'สร้างคำอธิบายไม่สำเร็จ' }
const RESULT_LABEL = { created: 'นำเข้าแล้ว', exists: 'มีในระบบแล้ว', failed: 'ล้มเหลว' }
const RESULT_TONE = { created: 'success', exists: 'neutral', failed: 'danger' }
const JOB_STATUS_LABEL = { running: 'กำลังนำเข้า', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิกแล้ว', failed: 'หยุดกะทันหัน' }

// Admin names an area, ticks categories, reviews the nearby Google results and
// imports the ticked ones as hidden drafts (published later from the places
// list). Searching lists names only; the billable Details call happens per
// ticked place when the import job runs.
export default function AreaImportModal({ open, onClose, onFinished }) {
  const { actions } = useApp()
  const [area, setArea] = useState('')
  const [radius, setRadius] = useState(3000)
  const [categories, setCategories] = useState(['cafe', 'restaurant'])
  const [minReviews, setMinReviews] = useState('5')
  const [found, setFound] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [describe, setDescribe] = useState(false)
  const [searching, setSearching] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [job, setJob] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    if (open) { setFound(null); setPicked(new Set()); setError(''); setJob(null) }
  }, [open])

  const running = job?.status === 'running'

  useEffect(() => {
    if (!running) return undefined
    pollRef.current = setInterval(async () => {
      try {
        const next = await fetchPlaceImportBatch(job.id)
        setJob(next)
        if (next.status !== 'running') { clearInterval(pollRef.current); onFinished?.() }
      } catch (err) {
        clearInterval(pollRef.current)
        if (!actions.handleSessionExpired(err)) setError('ติดตามความคืบหน้าไม่ได้ (งานอาจยังทำงานอยู่ ปิดแล้วเปิดดูรายการสถานที่ได้)')
      }
    }, 2000)
    return () => clearInterval(pollRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, running])

  const fail = (err) => {
    if (actions.handleSessionExpired(err)) return
    setError(err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)
  }

  const toggleCategory = (c) => setCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))

  const search = async (e) => {
    e.preventDefault()
    setSearching(true); setError(''); setFound(null); setPicked(new Set())
    try {
      const data = await searchGooglePlacesByArea({
        area: area.trim(), radius, categories,
        minReviews: minReviews === '' ? undefined : Number(minReviews),
      })
      setFound(data)
      // Pre-tick the new ones so the common case is one click, capped at the batch limit.
      setPicked(new Set(data.results.filter((r) => !r.existingPlaceId).slice(0, MAX_BATCH).map((r) => r.googlePlaceId)))
    } catch (err) { fail(err) } finally { setSearching(false) }
  }

  const togglePick = (id) => setPicked((cur) => {
    const next = new Set(cur)
    if (next.has(id)) next.delete(id)
    else if (next.size < MAX_BATCH) next.add(id)
    return next
  })

  // Off by default: each description is a Serper search + an LLM request per new place.
  const describeAllowed = picked.size <= MAX_DESCRIBE
  const describeOk = describe && describeAllowed
  const importable = found?.results.filter((r) => !r.existingPlaceId) || []
  const allTicked = importable.length > 0 && importable.slice(0, MAX_BATCH).every((r) => picked.has(r.googlePlaceId))
  const toggleAll = () => setPicked(allTicked ? new Set() : new Set(importable.slice(0, MAX_BATCH).map((r) => r.googlePlaceId)))

  const start = async () => {
    setStarting(true); setError('')
    try { setJob(await startPlaceImportBatch([...picked], { describe: describeOk })) } catch (err) { fail(err) } finally { setStarting(false) }
  }

  const cancel = async () => {
    try { setJob(await cancelPlaceImportBatch(job.id)) } catch (err) { fail(err) }
  }

  const nameOf = (gid) => found?.results.find((r) => r.googlePlaceId === gid)?.name || gid

  const footer = job ? (
    <>
      <Button variant="secondary" onClick={onClose} disabled={running}>ปิด</Button>
      {running
        ? <Button variant="danger" onClick={cancel}>ยกเลิกที่เหลือ</Button>
        : <Button variant="soft" onClick={() => setJob(null)}>กลับไปรายการ</Button>}
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={searching || starting}>ปิด</Button>
      <Button onClick={start} loading={starting} disabled={searching || starting || picked.size === 0}>
        {starting ? 'กำลังเริ่ม...' : `นำเข้า ${picked.size} แห่ง`}
      </Button>
    </>
  )

  return (
    <Modal open={open} onClose={running || starting ? () => {} : onClose} title="นำเข้าสถานที่ตามพื้นที่" maxWidth={720} footer={footer}>
      {!job ? (
        <div className="ad-form-stack">
          <form onSubmit={search}>
            <FormSection title="ค้นหาบริเวณ" first>
              <label className="ad-field">
                <span className="ad-field__label">ชื่อพื้นที่</span>
                <input className="ad-input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="เช่น พระลับ ขอนแก่น" autoFocus />
              </label>
              <div className="ad-row">
                <label className="ad-check">รัศมี
                  <select className="ad-select" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
                    {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>{r / 1000} กม.</option>)}
                  </select>
                </label>
                <label className="ad-check">รีวิวอย่างน้อย
                  <input className="ad-input ad-input--sm" type="number" min={0} value={minReviews} onChange={(e) => setMinReviews(e.target.value)} />
                </label>
              </div>
              <div className="ad-checks" role="group" aria-label="หมวดหมู่">
                {CATEGORIES.map((c) => (
                  <label key={c.value} className="ad-check"><input type="checkbox" checked={categories.includes(c.value)} onChange={() => toggleCategory(c.value)} /> {c.label}</label>
                ))}
              </div>
              <p className="ad-hint ad-hint--block">การค้นหาแสดงเฉพาะรายชื่อ (ยังไม่ดึงรายละเอียด) แต่ละหมวดได้สูงสุด 20 แห่ง ค่าใช้จ่ายหลักเกิดตอนกดนำเข้า — แห่งละ 1 คำขอ</p>
              <div>
                <Button type="submit" variant="soft" loading={searching} disabled={searching || area.trim().length < 2 || categories.length === 0}>{searching ? 'กำลังค้นหา...' : 'ค้นหา'}</Button>
              </div>
            </FormSection>
          </form>

          <FormError>{error}</FormError>

          {found && (
            <FormSection title={`ผลการค้นหา ${found.results.length} แห่ง`}>
              <p className="ad-hint ad-hint--block" aria-live="polite">
                ศูนย์กลาง: {found.center.label}{found.center.address ? ` (${found.center.address})` : ''} · รัศมี {found.radius / 1000} กม.
                {found.hiddenClosed > 0 && ` · ซ่อนที่ปิดถาวร ${found.hiddenClosed}`}
                {found.hiddenFewReviews > 0 && ` · ซ่อนที่รีวิวน้อย ${found.hiddenFewReviews}`}
              </p>
              {found.results.length === 0
                ? <div className="ad-state">ไม่พบสถานที่ที่ตรงเงื่อนไข ลองขยายรัศมี ลดจำนวนรีวิวขั้นต่ำ หรือเพิ่มหมวดหมู่</div>
                : (
                  <>
                    <div className="ad-sync-picked">
                      <span className="ad-sync-picked__count">เลือกแล้ว {picked.size}/{Math.min(importable.length, MAX_BATCH)} แห่ง (สูงสุด {MAX_BATCH} ต่อครั้ง)</span>
                      {importable.length > 0 && <button type="button" className="ad-link-inline" onClick={toggleAll}>{allTicked ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}</button>}
                    </div>
                    <div className="ad-sync-list">
                      {found.results.map((r) => (
                        <label key={r.googlePlaceId} className="ad-sync-row">
                          <input type="checkbox" checked={picked.has(r.googlePlaceId)} disabled={!!r.existingPlaceId} onChange={() => togglePick(r.googlePlaceId)} />
                          <span className="ad-sync-row__name">
                            {r.name}
                            <span className="ad-card__meta">{r.address}</span>
                          </span>
                          <span className="ad-sync-row__meta">
                            {r.existingPlaceId ? <Badge>มีในระบบแล้ว</Badge> : `${CATEGORY_LABEL[r.category]} · ${r.rating != null ? `★${r.rating}` : '-'} (${r.reviewCount})`}
                          </span>
                        </label>
                      ))}
                    </div>
                    <label className="ad-check">
                      <input type="checkbox" checked={describeOk} disabled={!describeAllowed} onChange={(e) => setDescribe(e.target.checked)} />
                      สร้างคำอธิบายด้วย AI ให้แห่งที่นำเข้าใหม่
                    </label>
                    <p className="ad-hint ad-hint--block">
                      {describeAllowed
                        ? 'สรุปจากรีวิวและผลค้นหา Google ทำเฉพาะแห่งที่ Google ไม่มีคำอธิบายให้ (ใช้ Serper + LLM แห่งละ 1 ครั้ง และใช้เวลานานขึ้น) ผลอยู่ในฉบับร่างให้ตรวจก่อนเผยแพร่'
                        : `ตัวเลือกนี้ใช้ได้เมื่อเลือกไม่เกิน ${MAX_DESCRIBE} แห่ง (ตอนนี้เลือก ${picked.size})`}
                    </p>
                  </>
                )}
            </FormSection>
          )}
        </div>
      ) : (
        <>
          <div className="ad-job__head">
            <div className="ad-job__status">{JOB_STATUS_LABEL[job.status]}</div>
            <div className="ad-job__count">{job.done}/{job.total} แห่ง{job.failed ? ` · ล้มเหลว ${job.failed}` : ''}</div>
          </div>
          <progress className="ad-progress" value={job.done} max={job.total || 1} aria-label="ความคืบหน้าการนำเข้า" />
          {error && <div className="ad-error-text ad-mb" role="alert">{error}</div>}
          {!running && (
            <p className="ad-hint ad-hint--block">นำเข้าเป็นฉบับร่างที่ซ่อนอยู่ {job.created} แห่ง{job.describe ? ` (สร้างคำอธิบายแล้ว ${job.described})` : ''} — ตรวจแก้ในรายการสถานที่แล้วเผยแพร่เมื่อพร้อม</p>
          )}
          <div className="ad-job__results">
            {job.results.map((r) => (
              <div key={r.googlePlaceId} className="ad-job__result">
                <div className="ad-job__result-head">
                  <span className="ad-job__result-name">{nameOf(r.googlePlaceId)}</span>
                  <Badge tone={RESULT_TONE[r.status]}>{RESULT_LABEL[r.status]}</Badge>
                </div>
                {r.error && <div className="ad-job__note ad-text-danger">{r.error}</div>}
                {r.description && (
                  <div className={`ad-job__note${r.description === 'failed' ? ' ad-text-danger' : ''}`}>
                    {DESCRIPTION_LABEL[r.description]}{r.descriptionNote ? ` — ${r.descriptionNote}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
