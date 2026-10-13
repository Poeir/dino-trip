import { useState } from 'react'
import { Lock, Pencil } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { fetchAdminPlaceReports, resolveAdminPlaceReports, syncOnePlace, resolvePlaceGoogleDiff, fetchPlace } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { fmtDateTime } from '../lib/format.js'
import { REPORT_FIELD_LABEL, REPORT_TO_SYNC_FIELD, SYNC_FIELD_LABEL, describeFieldValue, BUSINESS_STATUS_LABEL } from '../data/placeSync.js'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import ReportQueueCard, { ReportQueue, ReportFieldSection } from './ReportQueueCard.jsx'

const STATUS_FILTERS = [
  { key: 'pending', label: 'รอตรวจสอบ' },
  { key: 'resolved', label: 'จัดการแล้ว' },
  { key: 'superseded', label: 'Google อัปเดตแล้ว' },
  { key: 'rejected', label: 'ปฏิเสธ' },
]
const RESOLUTION_LABEL = { edited: 'แก้ไขเอง', synced: 'ซิงก์จาก Google', no_change: 'ไม่ต้องแก้ไข' }

// Admin queue: reports grouped per place, then per field ("hours x 5"). A user
// report only points at a field -- here the admin either edits the place,
// re-pulls it from Google, or dismisses it. Editing a place (PlacesTab) closes
// the matching reports itself, and a sync that changes the field marks them
// "Google updated".
export function PlaceReportsPanel() {
  const { actions } = useApp()
  const navigate = useNavigate()
  const [status, setStatus] = useState('pending')
  const paged = usePagedList(fetchAdminPlaceReports, { pageSize: 10, extraParams: { status } })
  const [busyKey, setBusyKey] = useState('')

  const run = async (key, fn, successMsg) => {
    setBusyKey(key)
    try {
      const msg = await fn()
      actions.showToast(msg || successMsg)
      paged.refetch()
    } catch (err) {
      actions.reportError('ดำเนินการไม่สำเร็จ: ', err)
    } finally {
      setBusyKey('')
    }
  }

  const openEdit = async (placeId) => {
    try {
      actions.openEditForm('place', await fetchPlace(placeId))
      navigate('/admin/places')
    } catch (err) {
      actions.reportError('เปิดหน้าแก้ไขไม่สำเร็จ: ', err)
    }
  }

  const syncField = (g, field) => run(`${g.place.id}:${field}:sync`, async () => {
    const r = await syncOnePlace(g.place.id, { fields: [REPORT_TO_SYNC_FIELD[field]] })
    if (r.changedFields.length) return `อัปเดต${SYNC_FIELD_LABEL[REPORT_TO_SYNC_FIELD[field]]}จาก Google แล้ว`
    if (r.skippedLocked.length) return 'ฟิลด์นี้ถูกล็อกไว้ — Google มีค่าใหม่ ให้เลือกใช้หรือคงค่าเดิมด้านล่าง'
    return 'Google ยืนยันว่าค่าปัจจุบันตรงกับของ Google แล้ว'
  })

  const resolve = (g, field, body, msg) => run(`${g.place.id}:${field}:resolve`, async () => {
    await resolveAdminPlaceReports({ placeId: g.place.id, field, ...body })
    return msg
  })

  const takeGoogle = (g, field, syncKey) => run(`${g.place.id}:${field}:diff`, async () => {
    await resolvePlaceGoogleDiff(g.place.id, syncKey, 'accept')
    await resolveAdminPlaceReports({ placeId: g.place.id, field, status: 'resolved', resolution: 'synced' }).catch(() => {})
    return 'ใช้ค่าจาก Google และปลดล็อกฟิลด์แล้ว'
  })

  const keepMine = (g, field, syncKey) => run(`${g.place.id}:${field}:keep`, async () => {
    await resolvePlaceGoogleDiff(g.place.id, syncKey, 'dismiss')
    return 'คงค่าที่แอดมินแก้ไว้'
  })

  return (
    <ReportQueue
      title="รายงานข้อมูลสถานที่"
      countText={`${paged.total} สถานที่`}
      filters={STATUS_FILTERS}
      status={status}
      onStatus={setStatus}
      paged={paged}
      errorText="โหลดรายงานไม่สำเร็จ"
      emptyText="ไม่มีรายงานในสถานะนี้"
    >
      {paged.rows.map((g) => {
        if (!g.place) return null
        const byField = Object.entries(g.fields)
        return (
          <ReportQueueCard
            key={g.place.id}
            title={g.place.name}
            meta={(
              <>
                {g.place.district && <span className="ad-card__meta">{g.place.district}</span>}
                {g.place.businessStatus && g.place.businessStatus !== 'OPERATIONAL' && <Badge tone="danger">{BUSINESS_STATUS_LABEL[g.place.businessStatus] || g.place.businessStatus}</Badge>}
                {!g.place.isActive && <Badge>ซ่อนอยู่</Badge>}
                <span className="ad-card__meta">ซิงก์ล่าสุด {g.place.lastSyncedAt ? fmtDateTime(g.place.lastSyncedAt) : 'ยังไม่เคย'}</span>
              </>
            )}
            actions={<Button variant="soft" size="sm" onClick={() => openEdit(g.place.id)}><Pencil size={13} aria-hidden="true" />เปิดหน้าแก้ไข</Button>}
          >
            {byField.map(([field, count]) => {
              const syncKey = REPORT_TO_SYNC_FIELD[field]
              const diff = syncKey && g.place.googleDiff?.[syncKey]
              const reports = g.reports.filter((r) => r.field === field)
              const pending = status === 'pending'
              return (
                <ReportFieldSection
                  key={field}
                  label={REPORT_FIELD_LABEL[field]}
                  badges={(
                    <>
                      <Badge tone={count >= 3 ? 'danger' : 'warning'}>{count} คนรายงาน</Badge>
                      {g.place.lockedFields.includes(syncKey) && <Badge icon={<Lock size={11} aria-hidden="true" />}>ล็อกไว้ ไม่ให้ซิงก์ทับ</Badge>}
                    </>
                  )}
                  reports={reports}
                  resolutionLabel={RESOLUTION_LABEL}
                  extra={pending && diff && (
                    <div className="ad-callout ad-callout--diff">
                      <div className="ad-callout__title">Google มีค่าใหม่ในฟิลด์ที่ถูกล็อก</div>
                      <div>ค่าที่ใช้อยู่: {describeFieldValue(syncKey, diff.current)}</div>
                      <div>ค่าจาก Google: {describeFieldValue(syncKey, diff.google)}</div>
                      <div className="ad-actions ad-actions--top">
                        <Button size="sm" disabled={!!busyKey} onClick={() => takeGoogle(g, field, syncKey)}>ใช้ค่าจาก Google</Button>
                        <Button size="sm" variant="secondary" disabled={!!busyKey} onClick={() => keepMine(g, field, syncKey)}>คงค่าเดิม</Button>
                      </div>
                    </div>
                  )}
                  actions={pending && (
                    <>
                      {syncKey && g.place.hasGoogleId && (
                        <Button size="sm" variant="soft" disabled={!!busyKey} loading={busyKey === `${g.place.id}:${field}:sync`} onClick={() => syncField(g, field)}>
                          {busyKey === `${g.place.id}:${field}:sync` ? 'กำลังซิงก์...' : 'ซิงก์จาก Google'}
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" disabled={!!busyKey} onClick={() => resolve(g, field, { status: 'resolved', resolution: 'no_change' }, 'ปิดรายงาน: ไม่ต้องแก้ไข')}>ข้อมูลถูกต้องแล้ว</Button>
                      <Button size="sm" variant="dangersoft" disabled={!!busyKey} onClick={() => resolve(g, field, { status: 'rejected' }, 'ปฏิเสธรายงานแล้ว')}>ปฏิเสธ</Button>
                    </>
                  )}
                />
              )
            })}
          </ReportQueueCard>
        )
      })}
    </ReportQueue>
  )
}
