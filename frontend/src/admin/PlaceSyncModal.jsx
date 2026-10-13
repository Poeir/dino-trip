import { Lock, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import Button from './ui/Button.jsx'
import Badge from './ui/Badge.jsx'
import FormSection, { FormError } from './ui/FormSection.jsx'
import { previewPlaceSync, startPlaceSyncJob, fetchPlaceSyncJob, cancelPlaceSyncJob, fetchPlaces } from '../lib/apiClient.js'
import { SYNC_FIELDS, SYNC_FIELD_LABEL, describeFieldValue } from '../data/placeSync.js'

const STATUS_LABEL = { updated: 'อัปเดตแล้ว', unchanged: 'ไม่มีการเปลี่ยนแปลง', skipped: 'ข้าม (ฟิลด์ถูกล็อก)', failed: 'ล้มเหลว' }
const STATUS_TONE = { updated: 'success', unchanged: 'neutral', skipped: 'warning', failed: 'danger' }
const JOB_STATUS_LABEL = { queued: 'รอเริ่ม', running: 'กำลังซิงก์', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิกแล้ว', failed: 'หยุดกะทันหัน' }

// Admin picks HOW MUCH to sync -- hand-picked places (searched right here), a
// filtered set, or every place -- then previews the count (each place is one billable Places API
// request) before anything runs. The run itself is a background job the
// server processes; this dialog polls its progress. Locked fields are never
// overwritten by any of these modes.
export default function PlaceSyncModal({ open, onClose, onFinished }) {
  const { actions, derived } = useApp()
  // 'picked' = hand-picked places; sent to the API as scope 'selected'.
  const [scope, setScope] = useState('picked')
  const [picked, setPicked] = useState([]) // [{ id, name }]
  const [pickQuery, setPickQuery] = useState('')
  const [pickResults, setPickResults] = useState([])
  const [pickLoading, setPickLoading] = useState(false)
  const [filters, setFilters] = useState({ staleDays: '30', hasPendingReports: false, hasGoogleDiff: false, includeInactive: false, district: '', category: '' })
  const [fields, setFields] = useState(SYNC_FIELDS)
  const [dryRun, setDryRun] = useState(false)
  const [maxItems, setMaxItems] = useState('100')
  const [preview, setPreview] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [job, setJob] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setScope('picked'); setPicked([]); setPickQuery(''); setPickResults([])
    setPreview(null); setConfirmed(false); setError(''); setJob(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Search the place list for the picker (debounced). Only Google-sourced
  // places can be synced, so others are filtered out of the results.
  useEffect(() => {
    if (!open || scope !== 'picked') return undefined
    let cancelled = false
    setPickLoading(true)
    const t = setTimeout(() => {
      fetchPlaces({ page: 1, limit: 30, search: pickQuery.trim() || undefined, sort: 'name', dir: 'asc' })
        .then(({ data }) => { if (!cancelled) setPickResults(data.filter((p) => p.googlePlaceId)) })
        .catch(() => { if (!cancelled) setPickResults([]) })
        .finally(() => { if (!cancelled) setPickLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [open, scope, pickQuery])

  const togglePick = (p) => {
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, { id: p.id, name: p.name }]))
    setPreview(null)
  }
  const pickAllShown = () => {
    setPicked((cur) => [...cur, ...pickResults.filter((p) => !cur.some((x) => x.id === p.id)).map((p) => ({ id: p.id, name: p.name }))])
    setPreview(null)
  }

  // Poll while a job is active; stop as soon as it reaches a terminal state.
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return undefined
    pollRef.current = setInterval(async () => {
      try {
        const next = await fetchPlaceSyncJob(job.id)
        setJob(next)
        if (!['queued', 'running'].includes(next.status)) { clearInterval(pollRef.current); onFinished?.() }
      } catch (err) {
        clearInterval(pollRef.current)
        if (!actions.handleSessionExpired(err)) setError('ติดตามความคืบหน้าไม่ได้ (งานยังอาจทำงานอยู่ เปิดหน้านี้ใหม่เพื่อดูผล)')
      }
    }, 2000)
    return () => clearInterval(pollRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status])

  const selection = () => ({
    scope: scope === 'picked' ? 'selected' : scope,
    ids: scope === 'picked' ? picked.map((p) => p.id) : undefined,
    filters: scope === 'filter' ? {
      staleDays: filters.staleDays === '' ? undefined : Number(filters.staleDays),
      hasPendingReports: filters.hasPendingReports || undefined,
      hasGoogleDiff: filters.hasGoogleDiff || undefined,
      includeInactive: filters.includeInactive || undefined,
      district: filters.district.trim() || undefined,
      category: filters.category || undefined,
    } : scope === 'all' ? { includeInactive: filters.includeInactive || undefined } : {},
    maxItems: maxItems === '' ? undefined : Number(maxItems),
  })

  const fail = (err) => {
    if (actions.handleSessionExpired(err)) return
    setError(err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)
  }

  const doPreview = async () => {
    setBusy(true); setError(''); setConfirmed(false)
    try { setPreview(await previewPlaceSync(selection())) } catch (err) { setPreview(null); fail(err) } finally { setBusy(false) }
  }

  const start = async () => {
    if (!fields.length) { setError('กรุณาเลือกอย่างน้อย 1 ฟิลด์'); return }
    setBusy(true); setError('')
    try {
      const created = await startPlaceSyncJob({ ...selection(), fields, dryRun, confirm: preview?.needsConfirm && confirmed ? true : undefined })
      setJob(created)
    } catch (err) { fail(err) } finally { setBusy(false) }
  }

  const cancel = async () => {
    try {
      await cancelPlaceSyncJob(job.id)
      // Refetch (rather than use the cancel response) so the per-place results
      // of what already ran are included.
      setJob(await fetchPlaceSyncJob(job.id))
      onFinished?.()
    } catch (err) { fail(err) }
  }

  const toggleField = (f) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))
  const setFilter = (k, v) => { setFilters((cur) => ({ ...cur, [k]: v })); setPreview(null) }
  const changeScope = (s) => { setScope(s); setPreview(null) }
  const running = job && ['queued', 'running'].includes(job.status)
  const canStart = preview && preview.count > 0 && (!preview.needsConfirm || confirmed)

  const footer = !job ? (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>ปิด</Button>
      <Button variant="soft" onClick={doPreview} loading={busy && !preview}>{busy && !preview ? 'กำลังตรวจสอบ...' : 'ตรวจสอบจำนวน'}</Button>
      <Button onClick={start} disabled={busy || !canStart}>{dryRun ? 'เริ่มทดลองรัน' : 'เริ่มซิงก์'}</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={running}>ปิด</Button>
      {running
        ? <Button variant="danger" onClick={cancel}>ยกเลิกงานที่เหลือ</Button>
        : <Button variant="soft" onClick={() => { setJob(null); setPreview(null) }}>ตั้งค่าใหม่</Button>}
    </>
  )

  return (
    <Modal open={open} onClose={running || busy ? () => {} : onClose} title="ซิงก์ข้อมูลจาก Google" maxWidth={720} footer={footer}>
      {!job ? (
        <>
          <p className="ad-sync-intro">
            <Lock size={14} aria-hidden="true" />
            <span>ดึงข้อมูลล่าสุดจาก Google Places มาอัปเดตสถานที่ ฟิลด์ที่แอดมินเคยแก้ไข (ล็อกไว้) จะไม่ถูกเขียนทับ — ถ้า Google มีค่าใหม่ จะแสดงให้เลือกภายหลัง</span>
          </p>

          <div className="ad-form-stack">
            <FormSection title="ต้องการซิงก์สถานที่ไหนบ้าง" first>
              <div className="ad-checks ad-checks--col" role="radiogroup" aria-label="ขอบเขตการซิงก์">
                <label className="ad-check"><input type="radio" name="sync-scope" checked={scope === 'picked'} onChange={() => changeScope('picked')} /> เลือกสถานที่เอง</label>
                <label className="ad-check"><input type="radio" name="sync-scope" checked={scope === 'filter'} onChange={() => changeScope('filter')} /> ตามเงื่อนไข (เช่น ไม่ได้ซิงก์นาน, มีรายงานค้าง)</label>
                <label className="ad-check"><input type="radio" name="sync-scope" checked={scope === 'all'} onChange={() => changeScope('all')} /> ทุกสถานที่ที่มาจาก Google</label>
              </div>

              {scope === 'picked' && (
                <div className="ad-sync-box">
                  <input className="ad-input" aria-label="ค้นหาสถานที่" value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="ค้นหาชื่อสถานที่เพื่อเพิ่มในรายการ..." />
                  <div className={`ad-sync-list${pickLoading ? ' is-loading' : ''}`}>
                    {pickResults.length === 0 && <div className="ad-sync-list__empty">{pickLoading ? 'กำลังค้นหา...' : 'ไม่พบสถานที่ที่ซิงก์ได้'}</div>}
                    {pickResults.map((p) => (
                      <label key={p.id} className="ad-sync-row">
                        <input type="checkbox" checked={picked.some((x) => x.id === p.id)} onChange={() => togglePick(p)} />
                        <span className="ad-sync-row__name">{p.name}</span>
                        <span className="ad-sync-row__meta">{p.lastSyncedAt ? `ซิงก์ ${new Date(p.lastSyncedAt).toLocaleDateString('th-TH', { dateStyle: 'medium' })}` : 'ยังไม่เคยซิงก์'}</span>
                      </label>
                    ))}
                  </div>
                  <div className="ad-sync-picked">
                    <span className="ad-sync-picked__count">เลือกแล้ว {picked.length} แห่ง</span>
                    {pickResults.length > 0 && <button type="button" className="ad-link-inline" onClick={pickAllShown}>เลือกทั้งหมดในรายการนี้</button>}
                    {picked.length > 0 && <button type="button" className="ad-link-inline is-danger" onClick={() => { setPicked([]); setPreview(null) }}>ล้างทั้งหมด</button>}
                  </div>
                  {picked.length > 0 && (
                    <div className="ad-chip-list">
                      {picked.map((p) => (
                        <span key={p.id} className="ad-tag">
                          {p.name}
                          <button type="button" onClick={() => togglePick(p)} aria-label={`เอา ${p.name} ออก`}><X size={14} strokeWidth={2.6} aria-hidden="true" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {scope === 'filter' && (
                <div className="ad-sync-box ad-sync-box--grid">
                  <label className="ad-field">
                    <span className="ad-field__label">ไม่ได้ซิงก์เกิน (วัน)</span>
                    <input className="ad-input" type="number" min={1} value={filters.staleDays} onChange={(e) => setFilter('staleDays', e.target.value)} placeholder="ว่าง = ไม่กรอง" />
                  </label>
                  <label className="ad-field">
                    <span className="ad-field__label">หมวดหมู่</span>
                    <select className="ad-select" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
                      <option value="">ทั้งหมด</option>
                      {derived.placeCategoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="ad-field">
                    <span className="ad-field__label">อำเภอ</span>
                    <input className="ad-input" value={filters.district} onChange={(e) => setFilter('district', e.target.value)} placeholder="เช่น เมืองขอนแก่น" />
                  </label>
                  <div className="ad-checks ad-checks--col">
                    <label className="ad-check"><input type="checkbox" checked={filters.hasPendingReports} onChange={(e) => setFilter('hasPendingReports', e.target.checked)} /> มีรายงานจากผู้ใช้ค้างอยู่</label>
                    <label className="ad-check"><input type="checkbox" checked={filters.hasGoogleDiff} onChange={(e) => setFilter('hasGoogleDiff', e.target.checked)} /> Google มีค่าใหม่ค้างอยู่</label>
                  </div>
                </div>
              )}
              {scope !== 'picked' && (
                <label className="ad-check"><input type="checkbox" checked={filters.includeInactive} onChange={(e) => setFilter('includeInactive', e.target.checked)} /> รวมสถานที่ที่ซ่อนอยู่ด้วย</label>
              )}
            </FormSection>

            <FormSection title="ฟิลด์ที่จะซิงก์">
              <div className="ad-checks">
                {SYNC_FIELDS.map((f) => <label key={f} className="ad-check"><input type="checkbox" checked={fields.includes(f)} onChange={() => { toggleField(f); setPreview(null) }} /> {SYNC_FIELD_LABEL[f]}</label>)}
              </div>
            </FormSection>

            <FormSection title="ตัวเลือก">
              <div className="ad-row">
                <label className="ad-check">จำนวนสูงสุดต่อครั้ง <input className="ad-input ad-input--sm" type="number" min={1} max={500} value={maxItems} onChange={(e) => { setMaxItems(e.target.value); setPreview(null) }} /></label>
                <label className="ad-check"><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> ทดลองรัน (ดูผลอย่างเดียว ไม่บันทึกลงฐานข้อมูล)</label>
              </div>
            </FormSection>

            {preview && (
              <div className="ad-sync-preview" aria-live="polite">
                {preview.count === 0 ? 'ไม่พบสถานที่ที่ตรงกับเงื่อนไข' : (
                  <>
                    จะซิงก์ <strong>{preview.count}</strong> แห่ง{preview.capped ? ` (ตรงเงื่อนไขทั้งหมด ${preview.matched} แห่ง — เลือกที่ซิงก์นานที่สุดก่อน)` : ''} · เรียก Google Places API ประมาณ {preview.count} ครั้ง (คิดค่าใช้จ่ายตามแพ็กเกจ API ของคุณ)
                    {preview.sample.length > 0 && <div className="ad-sync-preview__sample">เช่น {preview.sample.map((s) => s.name).join(', ')}{preview.count > preview.sample.length ? ' ...' : ''}</div>}
                    {preview.needsConfirm && (
                      <label className="ad-sync-preview__confirm">
                        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> ฉันยืนยันว่าจะซิงก์จำนวนมากนี้
                      </label>
                    )}
                  </>
                )}
              </div>
            )}
            <FormError>{error}</FormError>
          </div>
        </>
      ) : (
        <>
          <div className="ad-job__head">
            <div className="ad-job__status">{JOB_STATUS_LABEL[job.status]}{job.dryRun ? ' (ทดลองรัน — ยังไม่ได้บันทึก)' : ''}</div>
            <div className="ad-job__count">{job.done}/{job.total} แห่ง{job.failed ? ` · ล้มเหลว ${job.failed}` : ''}</div>
          </div>
          <progress className="ad-progress" value={job.done} max={job.total || 1} aria-label="ความคืบหน้าการซิงก์" />
          {error && <div className="ad-error-text ad-mb" role="alert">{error}</div>}
          {job.error && <div className="ad-error-text ad-mb" role="alert">{job.error}</div>}

          {!running && job.results && (
            <div className="ad-job__results">
              {job.results.map((r) => (
                <div key={r.placeId} className="ad-job__result">
                  <div className="ad-job__result-head">
                    <span className="ad-job__result-name">{r.placeName}</span>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </div>
                  {r.changedFields.length > 0 && (
                    <ul className="ad-job__changes">
                      {r.changedFields.map((f) => <li key={f}>{SYNC_FIELD_LABEL[f]}: {describeFieldValue(f, r.diff?.[f]?.current)} → {describeFieldValue(f, r.diff?.[f]?.google)}</li>)}
                    </ul>
                  )}
                  {r.skippedLocked.length > 0 && (
                    <div className="ad-job__note ad-text-warn">
                      <Lock size={13} aria-hidden="true" />
                      <span>ไม่ได้เขียนทับ: {r.skippedLocked.map((f) => SYNC_FIELD_LABEL[f]).join(', ')} (Google มีค่าใหม่รอให้เลือก)</span>
                    </div>
                  )}
                  {r.error && <div className="ad-job__note ad-text-danger">{r.error}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
