import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import { previewPlaceSync, startPlaceSyncJob, fetchPlaceSyncJob, cancelPlaceSyncJob, fetchPlaces } from '../lib/apiClient.js'
import { SYNC_FIELDS, SYNC_FIELD_LABEL, describeFieldValue } from '../data/placeSync.js'

const STATUS_LABEL = { updated: 'อัปเดตแล้ว', unchanged: 'ไม่มีการเปลี่ยนแปลง', skipped: 'ข้าม (ฟิลด์ถูกล็อก)', failed: 'ล้มเหลว' }
const STATUS_COLOR = { updated: ['#E8F5E9', '#2E7D32'], unchanged: ['#f3f3f0', '#6d7a72'], skipped: ['#FFF8E1', '#7A5205'], failed: ['#fdecec', '#a33232'] }
const JOB_STATUS_LABEL = { queued: 'รอเริ่ม', running: 'กำลังซิงก์', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิกแล้ว', failed: 'หยุดกะทันหัน' }

const inputStyle = { border: '1px solid #DCD8C6', borderRadius: 8, padding: '7px 9px', fontSize: 13.5 }
const btn = (bg, color, border = 'none') => ({ background: bg, color, border, padding: '10px 18px', borderRadius: 16, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' })

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
  const running = job && ['queued', 'running'].includes(job.status)
  const canStart = preview && preview.count > 0 && (!preview.needsConfirm || confirmed)

  return (
    <Modal open={open} onClose={running || busy ? () => {} : onClose} title="ซิงก์ข้อมูลจาก Google" maxWidth={720}>
      {!job ? (
        <>
          <div style={{ fontSize: 13, color: '#6d7a72', lineHeight: 1.6, marginBottom: 14 }}>
            ดึงข้อมูลล่าสุดจาก Google Places มาอัปเดตสถานที่ ฟิลด์ที่แอดมินเคยแก้ไข (🔒) จะไม่ถูกเขียนทับ — ถ้า Google มีค่าใหม่ จะแสดงให้เลือกภายหลัง
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>ต้องการซิงก์สถานที่ไหนบ้าง</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            <label style={{ fontSize: 14 }}>
              <input type="radio" name="sync-scope" checked={scope === 'picked'} onChange={() => { setScope('picked'); setPreview(null) }} /> เลือกสถานที่เอง
            </label>
            <label style={{ fontSize: 14 }}>
              <input type="radio" name="sync-scope" checked={scope === 'filter'} onChange={() => { setScope('filter'); setPreview(null) }} /> ตามเงื่อนไข (เช่น ไม่ได้ซิงก์นาน, มีรายงานค้าง)
            </label>
            <label style={{ fontSize: 14 }}>
              <input type="radio" name="sync-scope" checked={scope === 'all'} onChange={() => { setScope('all'); setPreview(null) }} /> ทุกสถานที่ที่มาจาก Google
            </label>
          </div>

          {scope === 'picked' && (
            <div style={{ border: '1px solid #EFEBDB', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="ค้นหาชื่อสถานที่เพื่อเพิ่มในรายการ..." style={{ ...inputStyle, width: '100%', marginBottom: 8 }} />
              <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid #EFEBDB', borderRadius: 8, opacity: pickLoading ? 0.5 : 1 }}>
                {pickResults.length === 0 && <div style={{ padding: 12, fontSize: 13, color: '#8a938c' }}>{pickLoading ? 'กำลังค้นหา...' : 'ไม่พบสถานที่ที่ซิงก์ได้'}</div>}
                {pickResults.map((p) => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 13.5, cursor: 'pointer', borderTop: '1px solid #F5F2E6' }}>
                    <input type="checkbox" checked={picked.some((x) => x.id === p.id)} onChange={() => togglePick(p)} />
                    <span style={{ flex: 1 }}>{p.name}</span>
                    <span style={{ fontSize: 11.5, color: '#8a938c' }}>{p.lastSyncedAt ? `ซิงก์ ${new Date(p.lastSyncedAt).toLocaleDateString('th-TH', { dateStyle: 'medium' })}` : 'ยังไม่เคยซิงก์'}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: '#1565C0' }}>เลือกแล้ว {picked.length} แห่ง</span>
                {pickResults.length > 0 && <button onClick={pickAllShown} style={{ background: 'none', border: 'none', color: '#1565C0', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>เลือกทั้งหมดในรายการนี้</button>}
                {picked.length > 0 && <button onClick={() => { setPicked([]); setPreview(null) }} style={{ background: 'none', border: 'none', color: '#a33232', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>ล้างทั้งหมด</button>}
              </div>
              {picked.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {picked.map((p) => (
                    <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#E3F2FD', color: '#1565C0', borderRadius: 20, padding: '3px 4px 3px 10px', fontSize: 12.5, fontWeight: 600 }}>
                      {p.name}
                      <button onClick={() => togglePick(p)} aria-label={`เอา ${p.name} ออก`} style={{ background: 'none', border: 'none', color: '#1565C0', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 4px' }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {scope === 'filter' && (
            <div style={{ border: '1px solid #EFEBDB', borderRadius: 12, padding: 14, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
              <label style={{ fontSize: 13 }}>ไม่ได้ซิงก์เกิน (วัน)<br /><input type="number" min={1} value={filters.staleDays} onChange={(e) => setFilter('staleDays', e.target.value)} placeholder="ว่าง = ไม่กรอง" style={{ ...inputStyle, width: '100%' }} /></label>
              <label style={{ fontSize: 13 }}>หมวดหมู่<br />
                <select value={filters.category} onChange={(e) => setFilter('category', e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                  <option value="">ทั้งหมด</option>
                  {derived.placeCategoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>อำเภอ<br /><input value={filters.district} onChange={(e) => setFilter('district', e.target.value)} placeholder="เช่น เมืองขอนแก่น" style={{ ...inputStyle, width: '100%' }} /></label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <label><input type="checkbox" checked={filters.hasPendingReports} onChange={(e) => setFilter('hasPendingReports', e.target.checked)} /> มีรายงานจากผู้ใช้ค้างอยู่</label>
                <label><input type="checkbox" checked={filters.hasGoogleDiff} onChange={(e) => setFilter('hasGoogleDiff', e.target.checked)} /> Google มีค่าใหม่ค้างอยู่</label>
              </div>
            </div>
          )}
          {scope !== 'picked' && (
            <label style={{ fontSize: 13, display: 'block', marginBottom: 14 }}><input type="checkbox" checked={filters.includeInactive} onChange={(e) => setFilter('includeInactive', e.target.checked)} /> รวมสถานที่ที่ซ่อนอยู่ด้วย</label>
          )}

          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>ฟิลด์ที่จะซิงก์</div>
          <div style={{ display: 'flex', gap: '6px 16px', flexWrap: 'wrap', marginBottom: 14 }}>
            {SYNC_FIELDS.map((f) => <label key={f} style={{ fontSize: 13.5 }}><input type="checkbox" checked={fields.includes(f)} onChange={() => { toggleField(f); setPreview(null) }} /> {SYNC_FIELD_LABEL[f]}</label>)}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <label style={{ fontSize: 13 }}>จำนวนสูงสุดต่อครั้ง <input type="number" min={1} max={500} value={maxItems} onChange={(e) => { setMaxItems(e.target.value); setPreview(null) }} style={{ ...inputStyle, width: 80 }} /></label>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> ทดลองรัน (ดูผลอย่างเดียว ไม่บันทึกลงฐานข้อมูล)</label>
          </div>

          {preview && (
            <div style={{ background: '#FBF8EE', borderRadius: 12, padding: '12px 14px', fontSize: 13.5, color: '#3c463f', marginBottom: 14, lineHeight: 1.6 }}>
              {preview.count === 0 ? 'ไม่พบสถานที่ที่ตรงกับเงื่อนไข' : (
                <>
                  จะซิงก์ <strong>{preview.count}</strong> แห่ง{preview.capped ? ` (ตรงเงื่อนไขทั้งหมด ${preview.matched} แห่ง — เลือกที่ซิงก์นานที่สุดก่อน)` : ''} · เรียก Google Places API ประมาณ {preview.count} ครั้ง (คิดค่าใช้จ่ายตามแพ็กเกจ API ของคุณ)
                  {preview.sample.length > 0 && <div style={{ color: '#6d7a72', fontSize: 12.5 }}>เช่น {preview.sample.map((s) => s.name).join(', ')}{preview.count > preview.sample.length ? ' ...' : ''}</div>}
                  {preview.needsConfirm && (
                    <label style={{ display: 'block', marginTop: 8, fontWeight: 700, color: '#7A5205' }}>
                      <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> ฉันยืนยันว่าจะซิงก์จำนวนมากนี้
                    </label>
                  )}
                </>
              )}
            </div>
          )}
          {error && <div style={{ fontSize: 13, color: '#a33232', marginBottom: 12 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={doPreview} disabled={busy} style={btn('#fff', '#1B5E20', '1px solid #2E7D32')}>{busy && !preview ? 'กำลังตรวจสอบ...' : 'ตรวจสอบจำนวน'}</button>
            <button onClick={start} disabled={busy || !canStart} style={btn(canStart && !busy ? 'linear-gradient(135deg,#66BB6A,#388E3C)' : '#c9d2ca', '#fff')}>{dryRun ? 'เริ่มทดลองรัน' : 'เริ่มซิงก์'}</button>
            <button onClick={onClose} disabled={busy} style={btn('#fff', '#3c463f', '1px solid #DCD8C6')}>ปิด</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, color: '#1B5E20' }}>{JOB_STATUS_LABEL[job.status]}{job.dryRun ? ' (ทดลองรัน — ยังไม่ได้บันทึก)' : ''}</div>
            <div style={{ fontSize: 13, color: '#6d7a72' }}>{job.done}/{job.total} แห่ง{job.failed ? ` · ล้มเหลว ${job.failed}` : ''}</div>
          </div>
          <div style={{ height: 10, background: '#EFEBDB', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }} role="progressbar" aria-valuenow={job.done} aria-valuemax={job.total}>
            <div style={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%`, height: '100%', background: 'linear-gradient(135deg,#66BB6A,#388E3C)', transition: 'width 0.3s ease' }} />
          </div>
          {error && <div style={{ fontSize: 13, color: '#a33232', marginBottom: 12 }}>{error}</div>}
          {job.error && <div style={{ fontSize: 13, color: '#a33232', marginBottom: 12 }}>{job.error}</div>}

          {!running && job.results && (
            <div style={{ border: '1px solid #EFEBDB', borderRadius: 12, maxHeight: 340, overflowY: 'auto', marginBottom: 14 }}>
              {job.results.map((r) => {
                const [bg, color] = STATUS_COLOR[r.status]
                return (
                  <div key={r.placeId} style={{ padding: '9px 14px', borderTop: '1px solid #EFEBDB', fontSize: 13 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: '#1f2a24', flex: 1, minWidth: 160 }}>{r.placeName}</span>
                      <span style={{ background: bg, color, fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>{STATUS_LABEL[r.status]}</span>
                    </div>
                    {r.changedFields.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#3c463f' }}>
                        {r.changedFields.map((f) => <li key={f}>{SYNC_FIELD_LABEL[f]}: {describeFieldValue(f, r.diff?.[f]?.current)} → {describeFieldValue(f, r.diff?.[f]?.google)}</li>)}
                      </ul>
                    )}
                    {r.skippedLocked.length > 0 && <div style={{ color: '#7A5205', marginTop: 4 }}>🔒 ไม่ได้เขียนทับ: {r.skippedLocked.map((f) => SYNC_FIELD_LABEL[f]).join(', ')} (Google มีค่าใหม่รอให้เลือก)</div>}
                    {r.error && <div style={{ color: '#a33232', marginTop: 4 }}>{r.error}</div>}
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            {running
              ? <button onClick={cancel} style={btn('#fdecec', '#a33232')}>ยกเลิกงานที่เหลือ</button>
              : <button onClick={() => { setJob(null); setPreview(null) }} style={btn('#fff', '#1B5E20', '1px solid #2E7D32')}>ตั้งค่าใหม่</button>}
            <button onClick={onClose} disabled={running} style={btn('#fff', '#3c463f', '1px solid #DCD8C6')}>ปิด</button>
          </div>
        </>
      )}
    </Modal>
  )
}
