import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import Button from './ui/Button.jsx'
import Badge from './ui/Badge.jsx'
import FormSection, { FormError } from './ui/FormSection.jsx'
import { useCostEstimates, costTag, FREE_ALLOWANCE_NOTE } from './hooks/useCostEstimates.js'
import { fetchAutoSyncStatus, saveAutoSyncSettings, runAutoSyncNow } from '../lib/apiClient.js'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const RUN_STATUS_LABEL = { queued: 'รอเริ่ม', running: 'กำลังซิงก์', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิกแล้ว', failed: 'หยุดกะทันหัน' }
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
const baht = (n) => `฿${Number(n).toLocaleString('th-TH')}`

// Form state keeps the numbers as strings so a half-typed value doesn't fight the input;
// they're converted on save (the server validates the ranges and answers in Thai).
const toDraft = (s) => ({
  ...s,
  normalIntervalDays: String(s.normalIntervalDays), priorityIntervalDays: String(s.priorityIntervalDays),
  monthlyCallCap: String(s.monthlyCallCap), dailyMaxItems: String(s.dailyMaxItems),
})
const toPayload = (d) => ({
  enabled: d.enabled, runHour: Number(d.runHour),
  normalIntervalDays: Number(d.normalIntervalDays), priorityIntervalDays: Number(d.priorityIntervalDays),
  priorityFeatured: d.priorityFeatured, priorityQr: d.priorityQr, priorityWithReports: d.priorityWithReports,
  monthlyCallCap: Number(d.monthlyCallCap), dailyMaxItems: Number(d.dailyMaxItems),
  autoHideClosed: d.autoHideClosed, includeInactive: d.includeInactive,
})

// Admin controls for the scheduled Google sync: on/off, how often, which places count
// as priority, and the monthly request cap that keeps the Places API bill bounded.
export default function AutoSyncSettingsModal({ open, onClose, onChanged }) {
  const { actions } = useApp()
  const [status, setStatus] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const est = useCostEstimates()

  const apply = (next) => { setStatus(next); setDraft(toDraft(next.settings)) }
  const fail = (err) => {
    if (actions.handleSessionExpired(err)) return
    setError(err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)
  }

  useEffect(() => {
    if (!open) return
    setStatus(null); setDraft(null); setError(''); setNotice(''); setLoading(true)
    fetchAutoSyncStatus().then(apply).catch(fail).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (key, value) => { setDraft((d) => ({ ...d, [key]: value })); setNotice('') }

  const save = async () => {
    setSaving(true); setError(''); setNotice('')
    try { apply(await saveAutoSyncSettings(toPayload(draft))); setNotice('บันทึกแล้ว') } catch (err) { fail(err) } finally { setSaving(false) }
  }

  const runNow = async () => {
    setRunning(true); setError(''); setNotice('')
    try {
      const r = await runAutoSyncNow()
      setNotice(r.started ? `เริ่มซิงก์ ${r.total} แห่งแล้ว (ทำงานเบื้องหลัง)` : r.message)
      apply(await fetchAutoSyncStatus())
      if (r.started) onChanged?.()
    } catch (err) { fail(err) } finally { setRunning(false) }
  }

  const u = status?.usage
  const pct = u && u.cap > 0 ? Math.min(100, Math.round((u.usedThisMonth / u.cap) * 100)) : 0
  const dirty = status && draft && JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(toDraft(status.settings)))
  const busy = saving || running
  // "Sync now" does one scheduled-style batch: what's due, within the daily and monthly limits.
  const runNowCount = status ? Math.min(status.dueNow, status.settings.dailyMaxItems, status.usage.remaining) : 0

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>ปิด</Button>
      <Button variant="soft" onClick={runNow} loading={running} disabled={busy || !status || dirty} title={dirty ? 'บันทึกการตั้งค่าก่อน' : `ซิงก์ ${runNowCount} แห่งทันที ตามเพดานต่อวันและต่อเดือน · ${FREE_ALLOWANCE_NOTE}`}>
        {running ? 'กำลังเริ่ม...' : `ซิงก์ตอนนี้ ${runNowCount} แห่ง${est ? costTag(runNowCount * est.syncPerPlaceThb) : ''}`}
      </Button>
      <Button onClick={save} loading={saving} disabled={busy || !dirty}>บันทึกการตั้งค่า</Button>
    </>
  )

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="ซิงก์ข้อมูลจาก Google อัตโนมัติ" maxWidth={720} footer={footer}>
      {loading && <div className="ad-state">กำลังโหลด...</div>}
      <FormError>{error}</FormError>
      {notice && <div className="ad-hint ad-hint--block" role="status">{notice}</div>}

      {status && draft && (
        <div className="ad-form-stack">
          <FormSection title="สถานะ" first>
            <label className="ad-check">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} /> เปิดใช้งานซิงก์อัตโนมัติ
            </label>
            <div className="ad-card__meta">
              {status.settings.enabled
                ? <>รอบถัดไป: {fmt(status.nextRunAt)}{status.running ? ' · กำลังมีงานซิงก์ทำงานอยู่' : ''}</>
                : 'ปิดอยู่ — ยังไม่มีการซิงก์ตามเวลา (ซิงก์เองจากปุ่ม "ซิงก์จาก Google" ได้ตามปกติ)'}
            </div>
            <div>
              <div className="ad-job__head">
                <div className="ad-job__status">คำขอเดือนนี้ (ซิงก์ทุกแบบรวมกัน)</div>
                <div className="ad-job__count">{u.usedThisMonth}/{u.cap} · ≈ {baht(u.costSoFarThb)}</div>
              </div>
              <progress className="ad-progress" value={pct} max={100} aria-label="คำขอที่ใช้ไปเทียบกับเพดานรายเดือน" />
            </div>
            <div className="ad-card__meta">
              ถึงรอบซิงก์แล้ว {status.dueNow} แห่ง · ประมาณการตามความถี่ที่บันทึกไว้ ~{status.projection.monthlyCalls} คำขอ/เดือน ≈ {baht(status.projection.monthlyCostThb)}
              {' '}(จากสถานที่ที่ซิงก์ได้ {status.projection.eligible} แห่ง แห่งสำคัญ {status.projection.priority})
            </div>
            {status.lastRun && (
              <div className="ad-card__meta">
                รอบล่าสุด{status.lastRun.runNow ? ' (สั่งเอง)' : ''}: {fmt(status.lastRun.createdAt)} <Badge>{RUN_STATUS_LABEL[status.lastRun.status] || status.lastRun.status}</Badge>
                {' '}{status.lastRun.done}/{status.lastRun.total} แห่ง
                {status.lastRun.failed > 0 && ` · ล้มเหลว ${status.lastRun.failed}`}
                {status.lastRun.autoHidden > 0 && ` · ซ่อนเพราะปิดถาวร ${status.lastRun.autoHidden}`}
              </div>
            )}
          </FormSection>

          <FormSection title="ความถี่">
            <div className="ad-row">
              <label className="ad-check">สถานที่ทั่วไป ซิงก์ทุก <input className="ad-input ad-input--sm" type="number" min={1} max={365} value={draft.normalIntervalDays} onChange={(e) => set('normalIntervalDays', e.target.value)} /> วัน</label>
              <label className="ad-check">แห่งสำคัญ ซิงก์ทุก <input className="ad-input ad-input--sm" type="number" min={1} max={365} value={draft.priorityIntervalDays} onChange={(e) => set('priorityIntervalDays', e.target.value)} /> วัน</label>
            </div>
            <div className="ad-checks" role="group" aria-label="แห่งที่ถือว่าสำคัญ">
              <label className="ad-check"><input type="checkbox" checked={draft.priorityFeatured} onChange={(e) => set('priorityFeatured', e.target.checked)} /> แห่งเด่น</label>
              <label className="ad-check"><input type="checkbox" checked={draft.priorityQr} onChange={(e) => set('priorityQr', e.target.checked)} /> มี QR</label>
              <label className="ad-check"><input type="checkbox" checked={draft.priorityWithReports} onChange={(e) => set('priorityWithReports', e.target.checked)} /> มีรายงานจากผู้ใช้ค้างอยู่</label>
            </div>
            <label className="ad-check">เริ่มรอบของวันตั้งแต่
              <select className="ad-select" value={draft.runHour} onChange={(e) => set('runHour', Number(e.target.value))}>
                {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00 น.</option>)}
              </select>
              (เวลาไทย)
            </label>
          </FormSection>

          <FormSection title="เพดานค่าใช้จ่าย">
            <div className="ad-row">
              <label className="ad-check">คำขอสูงสุดต่อเดือน <input className="ad-input ad-input--sm" type="number" min={0} max={100000} value={draft.monthlyCallCap} onChange={(e) => set('monthlyCallCap', e.target.value)} /></label>
              <label className="ad-check">สูงสุดต่อวัน <input className="ad-input ad-input--sm" type="number" min={1} max={500} value={draft.dailyMaxItems} onChange={(e) => set('dailyMaxItems', e.target.value)} /></label>
            </div>
            <p className="ad-hint ad-hint--block">
              แต่ละแห่ง = 1 คำขอ Places API · Google ให้ฟรี {status.pricing.freeCallsPerMonth.toLocaleString('th-TH')} คำขอ/เดือน เกินนั้นราว ${status.pricing.usdPer1000} ต่อ 1,000 (ประมาณ {status.pricing.thbPerUsd} บาท/ดอลลาร์)
              · ถ้าใช้เต็มเพดานที่ตั้ง ≈ {baht(u.maxCostAtCapThb)}/เดือน · ซิงก์ที่สั่งเองนับรวมในเพดานนี้ แต่การนำเข้าสถานที่ใหม่ไม่นับ
            </p>
          </FormSection>

          <FormSection title="เมื่อ Google ตอบว่าปิดกิจการ">
            <label className="ad-check"><input type="checkbox" checked={draft.autoHideClosed} onChange={(e) => set('autoHideClosed', e.target.checked)} /> ซ่อนสถานที่ที่ปิดถาวรอัตโนมัติ (ไม่ลบ เปิดกลับได้ในหน้าสถานที่)</label>
            <label className="ad-check"><input type="checkbox" checked={draft.includeInactive} onChange={(e) => set('includeInactive', e.target.checked)} /> ซิงก์สถานที่ที่ซ่อนอยู่ด้วย (ปิดไว้เพื่อประหยัดคำขอ)</label>
            <p className="ad-hint ad-hint--block">ฟิลด์ที่แอดมินล็อกไว้จะไม่ถูกเขียนทับ — ค่าใหม่จาก Google จะรอให้เลือกเหมือนการซิงก์ปกติ</p>
          </FormSection>
        </div>
      )}
    </Modal>
  )
}
