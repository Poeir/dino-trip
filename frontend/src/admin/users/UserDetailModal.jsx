import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import Modal from '../../components/Modal.jsx'
import Avatar from '../../components/Avatar.jsx'
import LoadingSpinner from '../../components/LoadingSpinner.jsx'
import LoadError from '../../components/LoadError.jsx'
import { fetchAdminUser } from '../../lib/apiClient.js'
import { fmtDate, fmtDateTime } from '../../lib/format.js'
import Badge from '../ui/Badge.jsx'
import Button from '../ui/Button.jsx'
import DataTable from '../ui/DataTable.jsx'
import FilterChips from '../ui/FilterChips.jsx'
import { InfoGrid, InfoRow } from '../ui/InfoGrid.jsx'
import { StatusBadge } from './UserTable.jsx'
import { useUserActions } from './UserActionDialog.jsx'

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

const signed = (n) => (n > 0 ? `+${n}` : String(n))
const labelOf = (options, value) => options.find((o) => o.value === value)?.label || value
const whenCol = { key: 'at', header: 'เมื่อ', className: 'ad-text-muted', render: (r) => fmtDateTime(r.at) }

// Per-tab columns for the activity history.
const ACTIVITY = {
  scans: { empty: 'ยังไม่เคยสแกน QR', rowsOf: (d) => d.scans, columns: [
    { key: 'place', header: 'สถานที่', render: (r) => r.placeName },
    { key: 'points', header: 'พอยท์', className: 'ad-text-ok', render: (r) => `+${r.points}` },
    whenCol,
  ] },
  redemptions: { empty: 'ยังไม่เคยแลกของรางวัล', rowsOf: (d) => d.redemptions, columns: [
    { key: 'reward', header: 'ของรางวัล', render: (r) => r.rewardName },
    { key: 'cost', header: 'พอยท์ที่ใช้', className: 'ad-text-warn', render: (r) => (r.status === 'cancelled' ? <span className="ad-strike">-{r.cost}</span> : `-${r.cost}`) },
    { key: 'status', header: 'สถานะ', className: 'ad-text-muted', render: (r) => (r.status === 'cancelled' ? 'ยกเลิกแล้ว (คืนพอยท์)' : 'แลกแล้ว') },
    whenCol,
  ] },
  adjustments: { empty: 'ยังไม่เคยมีการปรับพอยท์ด้วยมือ', rowsOf: (d) => d.adjustments, columns: [
    { key: 'delta', header: 'จำนวน', className: 'ad-text-warn', render: (r) => signed(r.delta) },
    { key: 'after', header: 'ยอดหลังปรับ', render: (r) => r.balanceAfter },
    { key: 'reason', header: 'เหตุผล', render: (r) => r.reason },
    { key: 'by', header: 'โดย', render: (r) => r.adminName || '-' },
    whenCol,
  ] },
  audit: { empty: 'ยังไม่มีการดำเนินการจาก admin', rowsOf: (d) => d.audit, columns: [
    { key: 'action', header: 'การดำเนินการ', render: (r) => AUDIT_LABELS[r.action] || r.action },
    { key: 'detail', header: 'รายละเอียด', render: (r) => r.details?.reason || r.details?.title || (r.details?.delta ? signed(r.details.delta) : '-') },
    { key: 'by', header: 'โดย', render: (r) => r.adminName || '-' },
    whenCol,
  ] },
}

function ActionButtons({ detail, openAction }) {
  const isDeleted = !!detail.deletedAt
  const isSuspended = detail.status === 'suspended'
  return (
    <div className="ad-actions ad-mb">
      {isDeleted ? (
        <Button variant="soft" size="sm" onClick={() => openAction('restore')}>กู้คืนบัญชี</Button>
      ) : (
        <>
          {isSuspended
            ? <Button variant="soft" size="sm" onClick={() => openAction('unsuspend')}>เปิดใช้งานบัญชี</Button>
            : <Button variant="secondary" size="sm" onClick={() => openAction('suspend')}>ระงับบัญชี</Button>}
          <Button variant="soft" size="sm" onClick={() => openAction('points')}>ปรับพอยท์</Button>
          <Button variant="secondary" size="sm" onClick={() => openAction('revoke')}>ออกจากระบบทุกอุปกรณ์</Button>
          {!detail.emailVerified && !isSuspended && <Button variant="secondary" size="sm" onClick={() => openAction('resend')}>ส่งอีเมลยืนยันใหม่</Button>}
          <Button variant="dangersoft" size="sm" onClick={() => openAction('delete')}>ลบบัญชี</Button>
        </>
      )}
    </div>
  )
}

export default function UserDetailModal({ userId, onClose, onChanged }) {
  const { actions, derived } = useApp()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [activityTab, setActivityTab] = useState('scans')

  const loadDetail = async (id) => {
    setLoading(true)
    setError(false)
    try {
      setDetail(await fetchAdminUser(id))
    } catch (err) {
      if (!actions.handleSessionExpired(err)) setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!userId) return
    setDetail(null)
    setActivityTab('scans')
    loadDetail(userId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // After each account change: refresh the open detail and the list behind it.
  const { openAction, dialogs } = useUserActions({
    user: detail,
    onDone: async () => { await loadDetail(userId); onChanged() },
  })

  const isDeleted = !!detail?.deletedAt
  const isSuspended = detail?.status === 'suspended'
  const activity = ACTIVITY[activityTab]
  const activityOptions = detail && [
    { value: 'scans', label: `สแกน QR (${detail.totals.scans})` },
    { value: 'redemptions', label: `แลกของรางวัล (${detail.totals.redemptions})` },
    { value: 'adjustments', label: `ปรับพอยท์ (${detail.adjustments.length})` },
    { value: 'audit', label: `บันทึกการดำเนินการ (${detail.audit.length})` },
  ]

  return (
    <>
      <Modal open={!!userId} onClose={onClose} title={detail ? detail.displayName : 'ข้อมูลผู้ใช้'} size="xl">
        {loading && !detail ? (
          <LoadingSpinner size={32} label="กำลังโหลดข้อมูลผู้ใช้..." />
        ) : error ? (
          <LoadError message="โหลดข้อมูลผู้ใช้ไม่สำเร็จ" onRetry={() => loadDetail(userId)} />
        ) : detail && (
          <div className={`ad-fade${loading ? ' is-loading' : ''}`}>
            <div className="ad-user-head">
              <Avatar user={detail} size={64} />
              <div className="ad-person__text">
                <div className="ad-user-head__email">{detail.email}</div>
                <div className="ad-badges">
                  <StatusBadge user={detail} />
                  {detail.role === 'admin' && <Badge tone="warning">admin</Badge>}
                  {!detail.emailVerified && <Badge tone="warning">ยังไม่ยืนยันอีเมล</Badge>}
                </div>
              </div>
            </div>

            {isDeleted && (
              <div className="ad-callout ad-callout--muted ad-callout--tight">
                ลบบัญชีเมื่อ {fmtDateTime(detail.deletedAt)}{detail.deletedByName ? ` โดย ${detail.deletedByName}` : ''} อีเมลนี้ถูกสงวนไว้ กู้คืนบัญชีเพื่อใช้งานต่อได้
              </div>
            )}
            {!isDeleted && isSuspended && (
              <div className="ad-callout ad-callout--bad ad-callout--tight">
                ระงับเมื่อ {fmtDateTime(detail.statusChangedAt)}{detail.statusChangedByName ? ` โดย ${detail.statusChangedByName}` : ''}
                {detail.statusReason ? ` — เหตุผล: ${detail.statusReason}` : ''}
              </div>
            )}

            <ActionButtons detail={detail} openAction={openAction} />

            <div className="ad-info-block">
              <InfoGrid>
                <InfoRow label="ชื่อ-นามสกุล">{[labelOf(derived.titleOptions, detail.title), detail.firstName, detail.lastName].filter(Boolean).join(' ')}</InfoRow>
                <InfoRow label="เบอร์โทร">{detail.phone}</InfoRow>
                <InfoRow label="เพศ">{detail.gender && labelOf(derived.genderOptions, detail.gender)}</InfoRow>
                <InfoRow label="วันเกิด">{detail.birthdate && fmtDate(detail.birthdate)}</InfoRow>
                <InfoRow label="อาชีพ">{detail.occupation && labelOf(derived.occupationOptions, detail.occupation)}</InfoRow>
                <InfoRow label="ที่อยู่">{[detail.subdistrict, detail.district, detail.province].filter(Boolean).join(' ')}</InfoRow>
                <InfoRow label="สมัครเมื่อ">{fmtDateTime(detail.createdAt)}</InfoRow>
                <InfoRow label="ใช้งานล่าสุด">{detail.lastLoginAt ? fmtDateTime(detail.lastLoginAt) : 'ยังไม่เคยเข้าสู่ระบบ'}</InfoRow>
                <InfoRow label="พอยท์คงเหลือ"><b className="ad-points-strong">{detail.pointsBalance}</b></InfoRow>
                <InfoRow label="สะสมจากการสแกน">{`${detail.totals.pointsEarned} พอยท์ (${detail.totals.scans} ครั้ง)`}</InfoRow>
                <InfoRow label="ใช้แลกของรางวัล">{`${detail.totals.pointsSpent} พอยท์ (${detail.totals.redemptions} ครั้ง)`}</InfoRow>
              </InfoGrid>
            </div>

            <div className="ad-mb">
              <FilterChips label="ประวัติการใช้งาน" options={activityOptions} value={activityTab} onChange={setActivityTab} />
            </div>
            <DataTable
              key={activityTab}
              columns={activity.columns}
              rows={activity.rowsOf(detail)}
              empty={activity.empty}
              mobile="scroll"
              label="ประวัติการใช้งาน"
            />
            <div className="ad-card__meta ad-footnote">แสดงรายการล่าสุดสูงสุด 50 รายการต่อหมวด</div>
          </div>
        )}
      </Modal>
      {dialogs}
    </>
  )
}
