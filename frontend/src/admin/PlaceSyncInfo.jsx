import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { fetchPlaceSyncInfo, syncOnePlace, resolvePlaceGoogleDiff, setPlaceLockedFields } from '../lib/apiClient.js'
import { SYNC_FIELD_LABEL, REPORT_FIELD_LABEL, describeFieldValue } from '../data/placeSync.js'

const btn = (bg, color, border = 'none') => ({ background: bg, color, border, padding: '6px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' })
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : 'ยังไม่เคย')

// Sync state of one Google-sourced place, inside its edit form: which fields
// are locked against sync, the Google values parked behind those locks, and a
// "sync now" button. Every action here writes immediately, so `onChanged`
// lets the form reload -- otherwise saving the stale form would send the old
// value straight back (and re-lock the field).
export default function PlaceSyncInfo({ placeId, dirty, onChanged }) {
  const { actions } = useApp()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState('')

  const load = () => fetchPlaceSyncInfo(placeId).then((i) => { setInfo(i); setError(false) }).catch(() => setError(true))
  useEffect(() => { setInfo(null); load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [placeId])

  // Confirms first when the form has unsaved edits, since reloading discards them.
  const act = async (key, fn, msg) => {
    if (dirty && !window.confirm('มีข้อมูลในฟอร์มที่ยังไม่ได้บันทึก การดำเนินการนี้จะโหลดฟอร์มใหม่และข้อมูลที่ยังไม่บันทึกจะหายไป ต้องการดำเนินการต่อหรือไม่?')) return
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

  if (error) return <div style={{ fontSize: 12.5, color: '#a33232', marginBottom: 14 }}>โหลดสถานะการซิงก์ไม่สำเร็จ</div>
  if (!info) return <div style={{ fontSize: 12.5, color: '#626863', marginBottom: 14 }}>กำลังโหลดสถานะการซิงก์...</div>
  if (!info.hasGoogleId) return <div style={{ fontSize: 12.5, color: '#626863', marginBottom: 14 }}>สถานที่นี้ไม่ได้มาจาก Google จึงไม่มีการซิงก์</div>

  const diffs = Object.entries(info.googleDiff || {})
  const pending = Object.entries(info.pendingReports || {})
  const anyBusy = !!busy

  return (
    <div style={{ border: '1px solid #E7E3D2', borderRadius: 12, padding: 14, marginBottom: 14, fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ color: '#5f6a63' }}>ซิงก์ล่าสุด: {fmtDateTime(info.lastSyncedAt)}</span>
        <button disabled={anyBusy} onClick={() => act('sync', () => syncOnePlace(placeId), (r) => (r.changedFields.length ? `อัปเดตจาก Google แล้ว: ${r.changedFields.map((f) => SYNC_FIELD_LABEL[f]).join(', ')}` : r.skippedLocked.length ? 'Google มีค่าใหม่ในฟิลด์ที่ล็อกไว้ — ดูด้านล่าง' : 'ข้อมูลตรงกับ Google แล้ว'))} style={{ ...btn('#E3F2FD', '#1565C0'), marginLeft: 'auto' }}>{busy === 'sync' ? 'กำลังซิงก์...' : 'ซิงก์จาก Google ตอนนี้'}</button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>ฟิลด์ที่ล็อก (ซิงก์จะไม่เขียนทับ)</div>
        {info.lockedFields.length === 0
          ? <span style={{ color: '#626863' }}>ไม่มี — ทุกฟิลด์อัปเดตตาม Google ได้ (เมื่อแอดมินแก้ฟิลด์ไหน ฟิลด์นั้นจะถูกล็อกอัตโนมัติ)</span>
          : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {info.lockedFields.map((f) => (
                <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f3f3f0', borderRadius: 20, padding: '4px 6px 4px 12px' }}>
                  🔒 {SYNC_FIELD_LABEL[f]}
                  <button disabled={anyBusy} onClick={() => act(`unlock:${f}`, () => setPlaceLockedFields(placeId, info.lockedFields.filter((x) => x !== f)), `ปลดล็อก${SYNC_FIELD_LABEL[f]}แล้ว — ซิงก์ครั้งถัดไปจะใช้ค่าจาก Google`)} style={{ ...btn('#fff', '#3c463f', '1px solid #DCD8C6'), padding: '2px 9px', fontSize: 11.5 }}>ปลดล็อก</button>
                </span>
              ))}
            </div>
          )}
      </div>

      {diffs.length > 0 && (
        <div style={{ background: '#FFFDF5', border: '1px solid #F0E4B8', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: '#7A5205', marginBottom: 6 }}>Google มีค่าใหม่ในฟิลด์ที่ถูกล็อก</div>
          {diffs.map(([f, d]) => (
            <div key={f} style={{ padding: '6px 0', borderTop: '1px solid #F5EDC9' }}>
              <div style={{ fontWeight: 700 }}>{SYNC_FIELD_LABEL[f]}</div>
              <div>ค่าที่ใช้อยู่: {describeFieldValue(f, d.current)}</div>
              <div>ค่าจาก Google: {describeFieldValue(f, d.google)}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button disabled={anyBusy} onClick={() => act(`accept:${f}`, () => resolvePlaceGoogleDiff(placeId, f, 'accept'), 'ใช้ค่าจาก Google และปลดล็อกแล้ว')} style={btn('#2E7D32', '#fff')}>ใช้ค่าจาก Google</button>
                <button disabled={anyBusy} onClick={() => act(`dismiss:${f}`, () => resolvePlaceGoogleDiff(placeId, f, 'dismiss'), 'คงค่าเดิมแล้ว')} style={btn('#fff', '#3c463f', '1px solid #DCD8C6')}>คงค่าเดิม</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ color: '#a33232' }}>
          มีรายงานจากผู้ใช้ที่รอตรวจสอบ: {pending.map(([f, n]) => `${REPORT_FIELD_LABEL[f] || f} ×${n}`).join(', ')} — บันทึกการแก้ไขฟิลด์นั้นแล้วรายงานจะถูกปิดให้อัตโนมัติ
        </div>
      )}
    </div>
  )
}
