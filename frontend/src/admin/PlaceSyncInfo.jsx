import { useEffect, useState } from 'react'
import { Lock, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import { fetchPlaceSyncInfo, syncOnePlace, resolvePlaceGoogleDiff, setPlaceLockedFields } from '../lib/apiClient.js'
import { SYNC_FIELD_LABEL, REPORT_FIELD_LABEL, describeFieldValue } from '../data/placeSync.js'
import { fmtDateTime } from '../lib/format.js'
import Button from './ui/Button.jsx'
import { useConfirm } from './ui/ConfirmDialog.jsx'

// Sync state of one Google-sourced place, inside its edit form: which fields
// are locked against sync, the Google values parked behind those locks, and a
// "sync now" button. Every action here writes immediately, so `onChanged`
// lets the form reload -- otherwise saving the stale form would send the old
// value straight back (and re-lock the field).
export default function PlaceSyncInfo({ placeId, dirty, onChanged }) {
  const { actions } = useApp()
  const { confirm, confirmDialog } = useConfirm()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState('')

  const load = () => fetchPlaceSyncInfo(placeId).then((i) => { setInfo(i); setError(false) }).catch(() => setError(true))
  useEffect(() => { setInfo(null); load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [placeId])

  // Confirms first when the form has unsaved edits, since reloading discards them.
  const act = async (key, fn, msg) => {
    if (dirty) {
      const ok = await confirm({
        title: 'โหลดฟอร์มใหม่?',
        message: 'มีข้อมูลในฟอร์มที่ยังไม่ได้บันทึก การดำเนินการนี้จะโหลดฟอร์มใหม่และข้อมูลที่ยังไม่บันทึกจะหายไป ต้องการดำเนินการต่อหรือไม่?',
        confirmLabel: 'ดำเนินการต่อ',
        cancelLabel: 'กลับไปแก้ไข',
        danger: true,
      })
      if (!ok) return
    }
    setBusy(key)
    try {
      const result = await fn()
      actions.showToast(typeof msg === 'function' ? msg(result) : msg)
      await load()
      await onChanged()
    } catch (err) {
      actions.reportError('ดำเนินการไม่สำเร็จ: ', err)
    } finally {
      setBusy('')
    }
  }

  if (error) return <div className="ad-sync-info__status is-error" role="alert">โหลดสถานะการซิงก์ไม่สำเร็จ</div>
  if (!info) return <div className="ad-sync-info__status">กำลังโหลดสถานะการซิงก์...</div>
  if (!info.hasGoogleId) return <div className="ad-sync-info__status">สถานที่นี้ไม่ได้มาจาก Google จึงไม่มีการซิงก์</div>

  const diffs = Object.entries(info.googleDiff || {})
  const pending = Object.entries(info.pendingReports || {})
  const anyBusy = !!busy

  return (
    <div className="ad-sync-info">
      <div className="ad-sync-info__bar">
        <span className="ad-text-muted">ซิงก์ล่าสุด: {info.lastSyncedAt ? fmtDateTime(info.lastSyncedAt) : 'ยังไม่เคย'}</span>
        <Button
          variant="soft"
          size="sm"
          disabled={anyBusy}
          loading={busy === 'sync'}
          onClick={() => act('sync', () => syncOnePlace(placeId), (r) => (r.changedFields.length ? `อัปเดตจาก Google แล้ว: ${r.changedFields.map((f) => SYNC_FIELD_LABEL[f]).join(', ')}` : r.skippedLocked.length ? 'Google มีค่าใหม่ในฟิลด์ที่ล็อกไว้ — ดูด้านล่าง' : 'ข้อมูลตรงกับ Google แล้ว'))}
        >
          {busy !== 'sync' && <RefreshCw size={14} aria-hidden="true" />}
          {busy === 'sync' ? 'กำลังซิงก์...' : 'ซิงก์จาก Google ตอนนี้'}
        </Button>
      </div>

      <div>
        <div className="ad-sync-info__title">ฟิลด์ที่ล็อก (ซิงก์จะไม่เขียนทับ)</div>
        {info.lockedFields.length === 0
          ? <span className="ad-text-muted">ไม่มี — ทุกฟิลด์อัปเดตตาม Google ได้ (เมื่อแอดมินแก้ฟิลด์ไหน ฟิลด์นั้นจะถูกล็อกอัตโนมัติ)</span>
          : (
            <div className="ad-chip-list">
              {info.lockedFields.map((f) => (
                <span key={f} className="ad-lock-chip">
                  <Lock size={13} aria-hidden="true" /> {SYNC_FIELD_LABEL[f]}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={anyBusy}
                    aria-label={`ปลดล็อก${SYNC_FIELD_LABEL[f]}`}
                    onClick={() => act(`unlock:${f}`, () => setPlaceLockedFields(placeId, info.lockedFields.filter((x) => x !== f)), `ปลดล็อก${SYNC_FIELD_LABEL[f]}แล้ว — ซิงก์ครั้งถัดไปจะใช้ค่าจาก Google`)}
                  >ปลดล็อก</Button>
                </span>
              ))}
            </div>
          )}
      </div>

      {diffs.length > 0 && (
        <div className="ad-callout ad-callout--diff ad-callout--tight">
          <div className="ad-callout__title">Google มีค่าใหม่ในฟิลด์ที่ถูกล็อก</div>
          {diffs.map(([f, d]) => (
            <div key={f} className="ad-diff__item">
              <div className="ad-diff__name">{SYNC_FIELD_LABEL[f]}</div>
              <div>ค่าที่ใช้อยู่: {describeFieldValue(f, d.current)}</div>
              <div>ค่าจาก Google: {describeFieldValue(f, d.google)}</div>
              <div className="ad-actions ad-actions--top">
                <Button size="sm" disabled={anyBusy} onClick={() => act(`accept:${f}`, () => resolvePlaceGoogleDiff(placeId, f, 'accept'), 'ใช้ค่าจาก Google และปลดล็อกแล้ว')}>ใช้ค่าจาก Google</Button>
                <Button variant="secondary" size="sm" disabled={anyBusy} onClick={() => act(`dismiss:${f}`, () => resolvePlaceGoogleDiff(placeId, f, 'dismiss'), 'คงค่าเดิมแล้ว')}>คงค่าเดิม</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="ad-text-danger">
          มีรายงานจากผู้ใช้ที่รอตรวจสอบ: {pending.map(([f, n]) => `${REPORT_FIELD_LABEL[f] || f} ×${n}`).join(', ')} — บันทึกการแก้ไขฟิลด์นั้นแล้วรายงานจะถูกปิดให้อัตโนมัติ
        </div>
      )}
      {confirmDialog}
    </div>
  )
}
