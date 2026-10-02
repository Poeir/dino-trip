import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import PageControls from '../components/PageControls.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { fetchAdminPlaceReports, resolveAdminPlaceReports, syncOnePlace, resolvePlaceGoogleDiff, fetchPlace } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { REPORT_FIELD_LABEL, REPORT_TO_SYNC_FIELD, SYNC_FIELD_LABEL, describeFieldValue, BUSINESS_STATUS_LABEL } from '../data/placeSync.js'

const STATUS_FILTERS = [
  { key: 'pending', label: 'รอตรวจสอบ' },
  { key: 'resolved', label: 'จัดการแล้ว' },
  { key: 'superseded', label: 'Google อัปเดตแล้ว' },
  { key: 'rejected', label: 'ปฏิเสธ' },
]
const RESOLUTION_LABEL = { edited: 'แก้ไขเอง', synced: 'ซิงก์จาก Google', no_change: 'ไม่ต้องแก้ไข' }

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
const chipStyle = (active) => ({
  padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? '#2E7D32' : '#DCD8C6'}`, background: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f',
})
const btn = (bg, color, border = 'none') => ({ background: bg, color, border, padding: '7px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' })

function Badge({ children, bg, color }) {
  return <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, background: bg, color, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{children}</span>
}

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

  const takeGoogle = (g, field, syncField) => run(`${g.place.id}:${field}:diff`, async () => {
    await resolvePlaceGoogleDiff(g.place.id, syncField, 'accept')
    await resolveAdminPlaceReports({ placeId: g.place.id, field, status: 'resolved', resolution: 'synced' }).catch(() => {})
    return 'ใช้ค่าจาก Google และปลดล็อกฟิลด์แล้ว'
  })

  const keepMine = (g, field, syncField) => run(`${g.place.id}:${field}:keep`, async () => {
    await resolvePlaceGoogleDiff(g.place.id, syncField, 'dismiss')
    return 'คงค่าที่แอดมินแก้ไว้'
  })

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>รายงานข้อมูลสถานที่</h1>
        <span style={{ fontSize: 13, color: '#6d7a72' }}>{paged.loading ? 'กำลังโหลด...' : `${paged.total} สถานที่`}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {STATUS_FILTERS.map((f) => <button key={f.key} onClick={() => setStatus(f.key)} style={chipStyle(status === f.key)}>{f.label}</button>)}
      </div>

      {paged.error ? (
        <LoadError message="โหลดรายงานไม่สำเร็จ" onRetry={paged.refetch} />
      ) : paged.rows.length === 0 ? (
        paged.loading ? <LoadingSpinner size={32} label="กำลังโหลดรายงาน..." /> : <EmptyState title="ไม่มีรายงานในสถานะนี้" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: paged.loading ? 0.5 : 1, transition: 'opacity 0.15s ease' }}>
          {paged.rows.map((g) => {
            if (!g.place) return null
            const byField = Object.entries(g.fields)
            return (
              <div key={g.place.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', background: '#FBF8EE' }}>
                  <div style={{ fontWeight: 800, color: '#1B5E20', fontSize: 15 }}>{g.place.name}</div>
                  {g.place.district && <span style={{ fontSize: 12.5, color: '#6d7a72' }}>{g.place.district}</span>}
                  {g.place.businessStatus && g.place.businessStatus !== 'OPERATIONAL' && <Badge bg="#fdecec" color="#a33232">{BUSINESS_STATUS_LABEL[g.place.businessStatus] || g.place.businessStatus}</Badge>}
                  {!g.place.isActive && <Badge bg="#f3f3f0" color="#6d7a72">ซ่อนอยู่</Badge>}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8a938c' }}>ซิงก์ล่าสุด {g.place.lastSyncedAt ? fmtDateTime(g.place.lastSyncedAt) : 'ยังไม่เคย'}</span>
                  <button onClick={() => openEdit(g.place.id)} style={btn('#E8F5E9', '#2E7D32')}>เปิดหน้าแก้ไข</button>
                </div>

                {byField.map(([field, count]) => {
                  const syncKey = REPORT_TO_SYNC_FIELD[field]
                  const diff = syncKey && g.place.googleDiff?.[syncKey]
                  const reports = g.reports.filter((r) => r.field === field)
                  return (
                    <div key={field} style={{ padding: '12px 16px', borderTop: '1px solid #EFEBDB' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: '#1f2a24' }}>{REPORT_FIELD_LABEL[field]}</span>
                        <Badge bg={count >= 3 ? '#fdecec' : '#FFF8E1'} color={count >= 3 ? '#a33232' : '#7A5205'}>{count} คนรายงาน</Badge>
                        {g.place.lockedFields.includes(syncKey) && <Badge bg="#f3f3f0" color="#6d7a72">🔒 ล็อกไว้ ไม่ให้ซิงก์ทับ</Badge>}
                      </div>
                      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13, color: '#3c463f' }}>
                        {reports.map((r) => (
                          <li key={r.id}>
                            {r.note ? `“${r.note}”` : <span style={{ color: '#a3ab9e' }}>(ไม่มีหมายเหตุ)</span>}
                            <span style={{ color: '#8a938c' }}> — {r.reporter}, {fmtDateTime(r.createdAt)}{r.resolution ? ` · ${RESOLUTION_LABEL[r.resolution]}` : ''}</span>
                          </li>
                        ))}
                      </ul>

                      {status === 'pending' && diff && (
                        <div style={{ background: '#FFFDF5', border: '1px solid #F0E4B8', borderRadius: 10, padding: '10px 12px', fontSize: 13, marginBottom: 10 }}>
                          <div style={{ fontWeight: 700, color: '#7A5205', marginBottom: 4 }}>Google มีค่าใหม่ในฟิลด์ที่ถูกล็อก</div>
                          <div>ค่าที่ใช้อยู่: {describeFieldValue(syncKey, diff.current)}</div>
                          <div>ค่าจาก Google: {describeFieldValue(syncKey, diff.google)}</div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button disabled={!!busyKey} onClick={() => takeGoogle(g, field, syncKey)} style={btn('#2E7D32', '#fff')}>ใช้ค่าจาก Google</button>
                            <button disabled={!!busyKey} onClick={() => keepMine(g, field, syncKey)} style={btn('#fff', '#3c463f', '1px solid #DCD8C6')}>คงค่าเดิม</button>
                          </div>
                        </div>
                      )}

                      {status === 'pending' && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {syncKey && g.place.hasGoogleId && (
                            <button disabled={!!busyKey} onClick={() => syncField(g, field)} style={btn('#E3F2FD', '#1565C0')}>{busyKey === `${g.place.id}:${field}:sync` ? 'กำลังซิงก์...' : 'ซิงก์จาก Google'}</button>
                          )}
                          <button disabled={!!busyKey} onClick={() => resolve(g, field, { status: 'resolved', resolution: 'no_change' }, 'ปิดรายงาน: ไม่ต้องแก้ไข')} style={btn('#fff', '#3c463f', '1px solid #DCD8C6')}>ข้อมูลถูกต้องแล้ว</button>
                          <button disabled={!!busyKey} onClick={() => resolve(g, field, { status: 'rejected' }, 'ปฏิเสธรายงานแล้ว')} style={btn('#fdecec', '#a33232')}>ปฏิเสธ</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </>
  )
}
