import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import PageControls from '../components/PageControls.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import Avatar from '../components/Avatar.jsx'
import LoadError from '../components/LoadError.jsx'
import EmptyState from '../components/EmptyState.jsx'
import {
  fetchAdminUsers, fetchAdminUser, suspendUser, unsuspendUser, deleteUser, restoreUser,
  adjustUserPoints, revokeUserSessions, resendUserVerification,
} from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'

const POINTS_DELTA_MAX = 100000

const STATUS_FILTERS = [
  { key: 'visible', label: 'ทั้งหมด' },
  { key: 'active', label: 'ใช้งานอยู่' },
  { key: 'suspended', label: 'ถูกระงับ' },
  { key: 'deleted', label: 'ลบแล้ว' },
]
const SORT_OPTIONS = {
  'created-desc': { label: 'สมัครล่าสุด', sort: 'created', dir: 'desc' },
  'created-asc': { label: 'สมัครเก่าสุด', sort: 'created', dir: 'asc' },
  'name-asc': { label: 'ชื่อ (ก-ฮ)', sort: 'name', dir: 'asc' },
  'points-desc': { label: 'พอยท์มาก-น้อย', sort: 'points', dir: 'desc' },
  'lastLogin-desc': { label: 'ใช้งานล่าสุด', sort: 'lastLogin', dir: 'desc' },
}
const AUDIT_LABELS = {
  'user.suspend': 'ระงับบัญชี',
  'user.unsuspend': 'เปิดใช้งานบัญชี',
  'user.delete': 'ลบบัญชี',
  'user.restore': 'กู้คืนบัญชี',
  'user.revoke_sessions': 'ออกจากระบบทุกอุปกรณ์',
  'user.resend_verification': 'ส่งอีเมลยืนยันใหม่',
  'points.adjust': 'ปรับพอยท์',
  'trip.delete': 'ลบแผนทริป',
}

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('th-TH', { dateStyle: 'long' }) : '-')
const signed = (n) => (n > 0 ? `+${n}` : String(n))

const inputStyle = { border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }
const chipStyle = (active) => ({
  padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? '#2E7D32' : '#DCD8C6'}`, background: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f',
})
const btn = (bg, color, border = 'none') => ({ background: bg, color, border, padding: '8px 14px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer' })

function Badge({ children, bg, color }) {
  return <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, background: bg, color, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{children}</span>
}

function StatusBadge({ user }) {
  if (user.deletedAt) return <Badge bg="#eee" color="#5f6a63">ลบแล้ว</Badge>
  if (user.status === 'suspended') return <Badge bg="#fdecec" color="#a33232">ถูกระงับ</Badge>
  return <Badge bg="#E8F5E9" color="#2E7D32">ใช้งานอยู่</Badge>
}

function InfoRow({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: '#626863', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#1f2a24', overflowWrap: 'anywhere' }}>{children || '-'}</div>
    </div>
  )
}

// One dialog for every account action: what the action does, an optional
// reason / points field, and the result of the last attempt.
function ActionDialog({ action, user, busy, error, onSubmit, onClose }) {
  const [reason, setReason] = useState('')
  const [delta, setDelta] = useState('')

  const deltaNum = Number(delta)
  const deltaValid = /^[+-]?\d+$/.test(delta.trim()) && deltaNum !== 0 && Math.abs(deltaNum) <= POINTS_DELTA_MAX
  const newBalance = deltaValid ? user.pointsBalance + deltaNum : null
  const reasonRequired = action.type === 'suspend' || action.type === 'points'
  const invalid =
    (reasonRequired && !reason.trim()) ||
    (action.type === 'points' && (!deltaValid || newBalance < 0))
  const hint =
    action.type === 'points' && delta.trim() && !deltaValid ? `ใส่จำนวนเต็มที่ไม่ใช่ 0 และไม่เกิน ${POINTS_DELTA_MAX} เช่น 50 หรือ -20`
    : action.type === 'points' && deltaValid && newBalance < 0 ? 'พอยท์ของผู้ใช้ไม่พอให้หัก'
    : ''

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={action.title} maxWidth={480}>
      <div style={{ fontSize: 14, color: '#3c463f', lineHeight: 1.6, marginBottom: 14 }}>{action.description}</div>

      {action.type === 'points' && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>จำนวนพอยท์ที่เพิ่ม (+) หรือหัก (-)</div>
          <input value={delta} onChange={(e) => setDelta(e.target.value)} inputMode="numeric" placeholder="เช่น 50 หรือ -20" style={{ ...inputStyle, width: '100%' }} />
          <div style={{ fontSize: 12.5, color: hint ? '#a33232' : '#5f6a63', marginTop: 6 }}>
            {hint || (newBalance !== null ? `ยอดปัจจุบัน ${user.pointsBalance} → หลังปรับ ${newBalance} พอยท์` : `ยอดปัจจุบัน ${user.pointsBalance} พอยท์`)}
          </div>
        </div>
      )}

      {(reasonRequired || action.type === 'delete') && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>เหตุผล{reasonRequired ? '' : ' (ไม่บังคับ)'}</div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
        </div>
      )}

      {error && <div style={{ fontSize: 13, color: '#a33232', marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => onSubmit({ reason: reason.trim(), delta: deltaNum })}
          disabled={busy || invalid}
          style={{ ...btn(busy || invalid ? '#c9d2ca' : action.danger ? '#c0392b' : 'linear-gradient(135deg,#66BB6A,#388E3C)', '#fff'), cursor: busy || invalid ? 'default' : 'pointer', padding: '10px 20px', borderRadius: 16 }}
        >
          {busy ? 'กำลังดำเนินการ...' : action.confirmLabel}
        </button>
        <button onClick={onClose} disabled={busy} style={{ ...btn('#fff', '#3c463f', '1px solid #DCD8C6'), padding: '10px 20px', borderRadius: 16 }}>ยกเลิก</button>
      </div>
    </Modal>
  )
}

function ActivityTable({ columns, rows, empty }) {
  if (!rows.length) return <div style={{ textAlign: 'center', padding: 24, color: '#626863', fontSize: 13.5 }}>{empty}</div>
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #EFEBDB', borderRadius: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#5f6a63', background: '#FBF8EE' }}>
            {columns.map((c) => <th key={c.label} style={{ padding: '8px 12px', fontWeight: 700 }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid #EFEBDB' }}>
              {columns.map((c) => <td key={c.label} style={{ padding: '8px 12px', ...(c.style || {}) }}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function UsersTab() {
  const { actions, derived } = useApp()
  const [statusFilter, setStatusFilter] = useState('visible')
  const [roleFilter, setRoleFilter] = useState('')
  const [verifiedFilter, setVerifiedFilter] = useState('')
  const [sortKey, setSortKey] = useState('created-desc')
  const sort = SORT_OPTIONS[sortKey]
  const paged = usePagedList(fetchAdminUsers, {
    pageSize: 20,
    extraParams: { status: statusFilter, role: roleFilter || undefined, verified: verifiedFilter || undefined, sort: sort.sort, dir: sort.dir },
  })

  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [activityTab, setActivityTab] = useState('scans')
  const [dialog, setDialog] = useState(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const loadDetail = async (id) => {
    setDetailLoading(true)
    setDetailError(false)
    try {
      setDetail(await fetchAdminUser(id))
    } catch (err) {
      if (!actions.handleSessionExpired(err)) setDetailError(true)
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    if (!selectedId) return
    setDetail(null)
    setActivityTab('scans')
    loadDetail(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const closeDetail = () => { setSelectedId(null); setDetail(null); setDialog(null) }

  // The API answers every account change with the updated user; refresh the
  // open detail and the list behind it after each one.
  const runAction = async (call, successMessage) => {
    setDialogBusy(true)
    setDialogError('')
    try {
      await call()
      actions.showToast(successMessage)
      setDialog(null)
      await loadDetail(selectedId)
      paged.refetch()
    } catch (err) {
      if (actions.handleSessionExpired(err)) return
      setDialogError(err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)
    } finally {
      setDialogBusy(false)
    }
  }

  const name = detail ? detail.displayName : ''
  const ACTIONS = detail && {
    suspend: { type: 'suspend', title: 'ระงับบัญชี', danger: true, confirmLabel: 'ระงับบัญชี',
      description: `${name} จะเข้าสู่ระบบและสแกน QR ไม่ได้ทันที และถูกออกจากระบบทุกอุปกรณ์ ข้อมูลและพอยท์ยังอยู่ครบ เปิดใช้งานกลับได้ภายหลัง`,
      run: ({ reason }) => runAction(() => suspendUser(detail.id, reason), 'ระงับบัญชีแล้ว') },
    unsuspend: { type: 'unsuspend', title: 'เปิดใช้งานบัญชี', confirmLabel: 'เปิดใช้งาน',
      description: `${name} จะกลับมาเข้าสู่ระบบและสแกน QR ได้ตามปกติ`,
      run: () => runAction(() => unsuspendUser(detail.id), 'เปิดใช้งานบัญชีแล้ว') },
    delete: { type: 'delete', title: 'ลบบัญชี', danger: true, confirmLabel: 'ลบบัญชี',
      description: `บัญชีของ ${name} จะถูกซ่อนและเข้าสู่ระบบไม่ได้ แต่ข้อมูล ประวัติสแกนและการแลกยังเก็บไว้ อีเมลนี้จะถูกสงวนไว้ (สมัครใหม่ด้วยอีเมลเดิมไม่ได้) และกู้คืนบัญชีได้ภายหลัง`,
      run: ({ reason }) => runAction(() => deleteUser(detail.id, reason), 'ลบบัญชีแล้ว') },
    restore: { type: 'restore', title: 'กู้คืนบัญชี', confirmLabel: 'กู้คืนบัญชี',
      description: `${name} จะกลับมาอยู่ในรายชื่อและเข้าสู่ระบบได้อีกครั้ง (ถ้าบัญชีเคยถูกระงับไว้ จะยังคงถูกระงับ)`,
      run: () => runAction(() => restoreUser(detail.id), 'กู้คืนบัญชีแล้ว') },
    points: { type: 'points', title: 'ปรับพอยท์', confirmLabel: 'บันทึกการปรับพอยท์',
      description: `ปรับพอยท์ของ ${name} ด้วยมือ ทุกครั้งจะบันทึกไว้เป็นประวัติพร้อมเหตุผล`,
      run: ({ delta, reason }) => runAction(() => adjustUserPoints(detail.id, delta, reason), 'ปรับพอยท์แล้ว') },
    revoke: { type: 'revoke', title: 'ออกจากระบบทุกอุปกรณ์', confirmLabel: 'ออกจากระบบทุกอุปกรณ์',
      description: `${name} จะถูกออกจากระบบในทุกอุปกรณ์ และต้องเข้าสู่ระบบใหม่`,
      run: () => runAction(() => revokeUserSessions(detail.id), 'ออกจากระบบทุกอุปกรณ์แล้ว') },
    resend: { type: 'resend', title: 'ส่งอีเมลยืนยันใหม่', confirmLabel: 'ส่งอีเมล',
      description: `ส่งลิงก์ยืนยันอีเมลใหม่ไปที่ ${detail.email}`,
      run: () => runAction(() => resendUserVerification(detail.id), 'ส่งอีเมลยืนยันแล้ว') },
  }
  const openAction = (key) => { setDialogError(''); setDialog(ACTIONS[key]) }

  const label = (options, value) => options.find((o) => o.value === value)?.label || value
  const ActionBtn = ({ k, bg, color, border, children }) => <button onClick={() => openAction(k)} style={btn(bg, color, border)}>{children}</button>

  const activityTabs = detail && [
    { key: 'scans', label: `สแกน QR (${detail.totals.scans})`, table: (
      <ActivityTable empty="ยังไม่เคยสแกน QR" rows={detail.scans} columns={[
        { label: 'สถานที่', render: (r) => r.placeName },
        { label: 'พอยท์', render: (r) => `+${r.points}`, style: { color: '#2E7D32', fontWeight: 700 } },
        { label: 'เมื่อ', render: (r) => fmtDateTime(r.at), style: { color: '#5f6a63' } },
      ]} />) },
    { key: 'redemptions', label: `แลกของรางวัล (${detail.totals.redemptions})`, table: (
      <ActivityTable empty="ยังไม่เคยแลกของรางวัล" rows={detail.redemptions} columns={[
        { label: 'ของรางวัล', render: (r) => r.rewardName },
        { label: 'พอยท์ที่ใช้', render: (r) => (r.status === 'cancelled' ? <span style={{ textDecoration: 'line-through', color: '#626863' }}>-{r.cost}</span> : `-${r.cost}`), style: { color: '#7A5205', fontWeight: 700 } },
        { label: 'สถานะ', render: (r) => (r.status === 'cancelled' ? 'ยกเลิกแล้ว (คืนพอยท์)' : 'แลกแล้ว'), style: { color: '#5f6a63' } },
        { label: 'เมื่อ', render: (r) => fmtDateTime(r.at), style: { color: '#5f6a63' } },
      ]} />) },
    { key: 'adjustments', label: `ปรับพอยท์ (${detail.adjustments.length})`, table: (
      <ActivityTable empty="ยังไม่เคยมีการปรับพอยท์ด้วยมือ" rows={detail.adjustments} columns={[
        { label: 'จำนวน', render: (r) => signed(r.delta), style: { fontWeight: 700, color: '#7A5205' } },
        { label: 'ยอดหลังปรับ', render: (r) => r.balanceAfter },
        { label: 'เหตุผล', render: (r) => r.reason },
        { label: 'โดย', render: (r) => r.adminName || '-' },
        { label: 'เมื่อ', render: (r) => fmtDateTime(r.at), style: { color: '#5f6a63' } },
      ]} />) },
    { key: 'audit', label: `บันทึกการดำเนินการ (${detail.audit.length})`, table: (
      <ActivityTable empty="ยังไม่มีการดำเนินการจาก admin" rows={detail.audit} columns={[
        { label: 'การดำเนินการ', render: (r) => AUDIT_LABELS[r.action] || r.action },
        { label: 'รายละเอียด', render: (r) => r.details?.reason || r.details?.title || (r.details?.delta ? signed(r.details.delta) : '-') },
        { label: 'โดย', render: (r) => r.adminName || '-' },
        { label: 'เมื่อ', render: (r) => fmtDateTime(r.at), style: { color: '#5f6a63' } },
      ]} />) },
  ]

  const isDeleted = !!detail?.deletedAt
  const isSuspended = detail?.status === 'suspended'

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>ผู้ใช้</h1>
        <span style={{ fontSize: 13, color: '#5f6a63' }}>{paged.loading ? 'กำลังโหลด...' : `พบ ${paged.total} บัญชี`}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {STATUS_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setStatusFilter(f.key)} style={chipStyle(statusFilter === f.key)}>{f.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input value={paged.query} onChange={(e) => paged.setQuery(e.target.value)} placeholder="ค้นหาชื่อ อีเมล หรือเบอร์โทร..." style={{ flex: 1, minWidth: 240, maxWidth: 380, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
          <option value="">ทุกบทบาท</option>
          <option value="tourist">นักท่องเที่ยว</option>
          <option value="admin">admin</option>
        </select>
        <select value={verifiedFilter} onChange={(e) => setVerifiedFilter(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
          <option value="">อีเมล: ทั้งหมด</option>
          <option value="true">ยืนยันอีเมลแล้ว</option>
          <option value="false">ยังไม่ยืนยันอีเมล</option>
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
          {Object.entries(SORT_OPTIONS).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
        </select>
      </div>

      {paged.error ? (
        <LoadError message="โหลดรายชื่อผู้ใช้ไม่สำเร็จ" onRetry={paged.refetch} />
      ) : paged.rows.length === 0 ? (
        paged.loading
          ? <LoadingSpinner size={32} label="กำลังโหลดผู้ใช้..." />
          : <EmptyState title="ไม่พบบัญชีที่ตรงกับเงื่อนไข" />
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, overflowX: 'auto', opacity: paged.loading ? 0.5 : 1, transition: 'opacity 0.15s ease' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#5f6a63', background: '#FBF8EE' }}>
                  {['ผู้ใช้', 'เบอร์โทร', 'สถานะ', 'พอยท์', 'สมัครเมื่อ', 'ใช้งานล่าสุด'].map((h) => <th key={h} style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((u) => (
                  <tr
                    key={u.id} tabIndex={0} role="button"
                    onClick={() => setSelectedId(u.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(u.id) }}
                    style={{ borderTop: '1px solid #EFEBDB', cursor: 'pointer', opacity: u.deletedAt ? 0.65 : 1 }}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Avatar user={u} size={38} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: '#1f2a24' }}>{u.displayName} {u.role === 'admin' && <Badge bg="#FFF8E1" color="#7A5205">admin</Badge>}</div>
                          <div style={{ fontSize: 12.5, color: '#5f6a63' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{u.phone || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <StatusBadge user={u} />{' '}
                      {!u.emailVerified && <Badge bg="#FFF8E1" color="#7A5205">ยังไม่ยืนยันอีเมล</Badge>}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: '#7A5205' }}>{u.pointsBalance}</td>
                    <td style={{ padding: '10px 14px', color: '#5f6a63', whiteSpace: 'nowrap' }}>{fmtDateTime(u.createdAt)}</td>
                    <td style={{ padding: '10px 14px', color: '#5f6a63', whiteSpace: 'nowrap' }}>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'ยังไม่เคย'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
        </>
      )}

      <Modal open={!!selectedId} onClose={dialog ? () => {} : closeDetail} title={detail ? detail.displayName : 'ข้อมูลผู้ใช้'} maxWidth={820}>
        {detailLoading && !detail ? (
          <LoadingSpinner size={32} label="กำลังโหลดข้อมูลผู้ใช้..." />
        ) : detailError ? (
          <LoadError message="โหลดข้อมูลผู้ใช้ไม่สำเร็จ" onRetry={() => loadDetail(selectedId)} />
        ) : detail && (
          <div style={{ opacity: detailLoading ? 0.6 : 1 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14 }}>
              <Avatar user={detail} size={64} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: '#3c463f', marginBottom: 6, overflowWrap: 'anywhere' }}>{detail.email}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <StatusBadge user={detail} />
                  {detail.role === 'admin' && <Badge bg="#FFF8E1" color="#7A5205">admin</Badge>}
                  {!detail.emailVerified && <Badge bg="#FFF8E1" color="#7A5205">ยังไม่ยืนยันอีเมล</Badge>}
                </div>
              </div>
            </div>

            {isDeleted && (
              <div style={{ background: '#f3f3f0', borderRadius: 12, padding: '10px 14px', fontSize: 13.5, marginBottom: 14, color: '#3c463f' }}>
                ลบบัญชีเมื่อ {fmtDateTime(detail.deletedAt)}{detail.deletedByName ? ` โดย ${detail.deletedByName}` : ''} อีเมลนี้ถูกสงวนไว้ กู้คืนบัญชีเพื่อใช้งานต่อได้
              </div>
            )}
            {!isDeleted && isSuspended && (
              <div style={{ background: '#fdecec', borderRadius: 12, padding: '10px 14px', fontSize: 13.5, marginBottom: 14, color: '#7a2222' }}>
                ระงับเมื่อ {fmtDateTime(detail.statusChangedAt)}{detail.statusChangedByName ? ` โดย ${detail.statusChangedByName}` : ''}
                {detail.statusReason ? ` — เหตุผล: ${detail.statusReason}` : ''}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
              {isDeleted ? (
                <ActionBtn k="restore" bg="#E8F5E9" color="#2E7D32">กู้คืนบัญชี</ActionBtn>
              ) : (
                <>
                  {isSuspended
                    ? <ActionBtn k="unsuspend" bg="#E8F5E9" color="#2E7D32">เปิดใช้งานบัญชี</ActionBtn>
                    : <ActionBtn k="suspend" bg="#fff" color="#a33232" border="1px solid #e6b8b8">ระงับบัญชี</ActionBtn>}
                  <ActionBtn k="points" bg="#FFF8E1" color="#7A5205">ปรับพอยท์</ActionBtn>
                  <ActionBtn k="revoke" bg="#fff" color="#3c463f" border="1px solid #DCD8C6">ออกจากระบบทุกอุปกรณ์</ActionBtn>
                  {!detail.emailVerified && !isSuspended && <ActionBtn k="resend" bg="#fff" color="#3c463f" border="1px solid #DCD8C6">ส่งอีเมลยืนยันใหม่</ActionBtn>}
                  <ActionBtn k="delete" bg="#fdecec" color="#a33232">ลบบัญชี</ActionBtn>
                </>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: '14px 20px', marginBottom: 22 }}>
              <InfoRow label="ชื่อ-นามสกุล">{[label(derived.titleOptions, detail.title), detail.firstName, detail.lastName].filter(Boolean).join(' ')}</InfoRow>
              <InfoRow label="เบอร์โทร">{detail.phone}</InfoRow>
              <InfoRow label="เพศ">{detail.gender && label(derived.genderOptions, detail.gender)}</InfoRow>
              <InfoRow label="วันเกิด">{detail.birthdate && fmtDate(detail.birthdate)}</InfoRow>
              <InfoRow label="อาชีพ">{detail.occupation && label(derived.occupationOptions, detail.occupation)}</InfoRow>
              <InfoRow label="ที่อยู่">{[detail.subdistrict, detail.district, detail.province].filter(Boolean).join(' ')}</InfoRow>
              <InfoRow label="สมัครเมื่อ">{fmtDateTime(detail.createdAt)}</InfoRow>
              <InfoRow label="ใช้งานล่าสุด">{detail.lastLoginAt ? fmtDateTime(detail.lastLoginAt) : 'ยังไม่เคยเข้าสู่ระบบ'}</InfoRow>
              <InfoRow label="พอยท์คงเหลือ"><b style={{ color: '#7A5205', fontSize: 16 }}>{detail.pointsBalance}</b></InfoRow>
              <InfoRow label="สะสมจากการสแกน">{`${detail.totals.pointsEarned} พอยท์ (${detail.totals.scans} ครั้ง)`}</InfoRow>
              <InfoRow label="ใช้แลกของรางวัล">{`${detail.totals.pointsSpent} พอยท์ (${detail.totals.redemptions} ครั้ง)`}</InfoRow>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {activityTabs.map((t) => <button key={t.key} onClick={() => setActivityTab(t.key)} style={chipStyle(activityTab === t.key)}>{t.label}</button>)}
            </div>
            {activityTabs.find((t) => t.key === activityTab).table}
            <div style={{ fontSize: 12, color: '#626863', marginTop: 8 }}>แสดงรายการล่าสุดสูงสุด 50 รายการต่อหมวด</div>
          </div>
        )}
      </Modal>

      {dialog && detail && (
        <ActionDialog
          key={dialog.type} action={dialog} user={detail} busy={dialogBusy} error={dialogError}
          onSubmit={(values) => dialog.run(values)} onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}
