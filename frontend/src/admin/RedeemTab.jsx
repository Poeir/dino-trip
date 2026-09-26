import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import Avatar from '../components/Avatar.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import { REWARD_ICON } from '../data/categoryImages.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import { fetchAdminUsers, fetchRewards, fetchRedemptionHistory, redeemForUser, cancelRedemption } from '../lib/apiClient.js'

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
const errorText = (err) => (err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)

const HISTORY_FILTERS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'completed', label: 'แลกแล้ว' },
  { key: 'cancelled', label: 'ยกเลิกแล้ว' },
]
const chipStyle = (active) => ({
  padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? '#2E7D32' : '#DCD8C6'}`, background: active ? '#E8F5E9' : '#fff', color: active ? '#1B5E20' : '#3c463f',
})
const panel = { background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 20, marginBottom: 22 }
const stepTitle = { fontSize: 15, fontWeight: 800, color: '#1B5E20', margin: '0 0 12px' }

function stockText(r) {
  if (r.stock == null) return 'ไม่จำกัดจำนวน'
  return r.stock === 0 ? 'ของหมด' : `เหลือ ${r.stock} ชิ้น`
}

// Why a reward can't be handed to this tourist right now, or '' if it can.
function blockedReason(reward, user) {
  if (reward.stock === 0) return 'ของหมด'
  if (user.pointsBalance < reward.cost) return `พอยท์ไม่พอ (ขาดอีก ${reward.cost - user.pointsBalance})`
  return ''
}

function UserPicker({ onPick }) {
  const { actions } = useApp()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const term = query.trim()
    if (!term) { setResults(null); setError(''); return undefined }
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const { data } = await fetchAdminUsers({ search: term, status: 'active', limit: 6, sort: 'name', dir: 'asc' })
        if (!cancelled) setResults(data)
      } catch (err) {
        if (!cancelled && !actions.handleSessionExpired(err)) setError(errorText(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <div>
      <input
        value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
        placeholder="พิมพ์ชื่อ อีเมล หรือเบอร์โทรของผู้ใช้..."
        style={{ width: '100%', maxWidth: 460, border: '1px solid #DCD8C6', borderRadius: 20, padding: '10px 16px', fontSize: 14, marginBottom: 12 }}
      />
      {loading && <LoadingSpinner size={24} label="กำลังค้นหา..." />}
      {error && <div style={{ fontSize: 13, color: '#a33232' }}>{error}</div>}
      {!loading && !error && results && results.length === 0 && (
        <div style={{ fontSize: 13.5, color: '#8a938c' }}>ไม่พบบัญชีที่ใช้งานอยู่ตรงกับ "{query.trim()}" (บัญชีที่ถูกระงับหรือลบแล้วแลกให้ไม่ได้)</div>
      )}
      {results && results.length > 0 && (
        <div style={{ display: 'grid', gap: 8, maxWidth: 560, opacity: loading ? 0.5 : 1 }}>
          {results.map((u) => (
            <button
              key={u.id} type="button" onClick={() => onPick(u)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%', background: '#FBF8EE', border: '1px solid #EFEBDB', borderRadius: 12, padding: '10px 14px', cursor: 'pointer' }}
            >
              <Avatar user={u} size={40} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, color: '#1f2a24' }}>{u.displayName}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: '#6d7a72', overflowWrap: 'anywhere' }}>{[u.phone, u.email].filter(Boolean).join(' · ')}</span>
              </span>
              <span style={{ fontWeight: 800, color: '#7A5205', whiteSpace: 'nowrap' }}>{u.pointsBalance} พอยท์</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RedeemTab() {
  const { actions } = useApp()
  const [user, setUser] = useState(null)

  const [rewards, setRewards] = useState([])
  const [rewardsLoading, setRewardsLoading] = useState(true)
  const [rewardsError, setRewardsError] = useState(false)

  const [historyFilter, setHistoryFilter] = useState('')
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(false)

  const [confirmReward, setConfirmReward] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const loadRewards = async () => {
    setRewardsLoading(true)
    setRewardsError(false)
    try {
      setRewards(await fetchRewards())
    } catch {
      setRewardsError(true)
    } finally {
      setRewardsLoading(false)
    }
  }
  const loadHistory = async () => {
    setHistoryLoading(true)
    setHistoryError(false)
    try {
      setHistory(await fetchRedemptionHistory({ status: historyFilter || undefined }))
    } catch (err) {
      if (!actions.handleSessionExpired(err)) setHistoryError(true)
    } finally {
      setHistoryLoading(false)
    }
  }
  useEffect(() => { loadRewards() }, [])
  useEffect(() => { loadHistory() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [historyFilter])

  const closeDialogs = () => { setConfirmReward(null); setCancelTarget(null); setCancelReason(''); setDialogError('') }

  const handleRedeem = async () => {
    setBusy(true)
    setDialogError('')
    try {
      const result = await redeemForUser(user.id, confirmReward.id)
      actions.showToast(`แลก "${result.rewardName}" ให้ ${user.displayName} แล้ว เหลือ ${result.balance} พอยท์`)
      setUser({ ...user, pointsBalance: result.balance })
      closeDialogs()
      loadRewards()
      loadHistory()
    } catch (err) {
      if (actions.handleSessionExpired(err)) return
      setDialogError(errorText(err))
      // Stock or points changed under us (another counter, or a cancel): show the real numbers.
      if (err.status === 409 || err.status === 402) loadRewards()
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async () => {
    setBusy(true)
    setDialogError('')
    try {
      const result = await cancelRedemption(cancelTarget.id, cancelReason.trim())
      actions.showToast(`ยกเลิกรายการแล้ว คืน ${cancelTarget.cost} พอยท์ให้ ${cancelTarget.userName}`)
      if (user && user.id === result.userId) setUser({ ...user, pointsBalance: result.balance })
      closeDialogs()
      loadRewards()
      loadHistory()
    } catch (err) {
      if (actions.handleSessionExpired(err)) return
      setDialogError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const primaryBtn = (disabled) => ({
    background: disabled ? '#c9d2ca' : 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none',
    padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: disabled ? 'default' : 'pointer',
  })
  const ghostBtn = { background: '#fff', color: '#3c463f', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: '0 0 4px' }}>แลกของรางวัลที่เคาน์เตอร์</h1>
        <div style={{ fontSize: 13.5, color: '#6d7a72' }}>ค้นหาผู้ใช้ เลือกของรางวัล แล้วยืนยัน ระบบจะหักพอยท์และลดจำนวนของรางวัลให้ในขั้นตอนเดียว</div>
      </div>

      <div style={panel}>
        <h2 style={stepTitle}>1. เลือกผู้ใช้</h2>
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <Avatar user={user} size={52} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#1f2a24' }}>{user.displayName}</div>
              <div style={{ fontSize: 13, color: '#6d7a72', overflowWrap: 'anywhere' }}>{[user.phone, user.email].filter(Boolean).join(' · ')}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#8a938c' }}>พอยท์คงเหลือ</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#7A5205' }}>{user.pointsBalance}</div>
            </div>
            <button onClick={() => setUser(null)} style={ghostBtn}>เปลี่ยนผู้ใช้</button>
          </div>
        ) : (
          <UserPicker onPick={setUser} />
        )}
      </div>

      {user && (
        <div style={panel}>
          <h2 style={stepTitle}>2. เลือกของรางวัล</h2>
          {rewardsLoading && rewards.length === 0 ? (
            <LoadingSpinner size={32} label="กำลังโหลดของรางวัล..." />
          ) : rewardsError ? (
            <LoadError message="โหลดรายการของรางวัลไม่สำเร็จ" onRetry={loadRewards} />
          ) : rewards.length === 0 ? (
            <div style={{ fontSize: 13.5, color: '#8a938c' }}>ยังไม่มีของรางวัลในระบบ เพิ่มได้ที่แท็บ "QR & พอยท์"</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 14, opacity: rewardsLoading ? 0.6 : 1 }}>
              {rewards.map((r) => {
                const blocked = blockedReason(r, user)
                return (
                  <div key={r.id} style={{ border: '1px solid #E7E3D2', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column' }}>
                    {r.imageUrl && <ImageSlot src={r.imageUrl} radius={10} placeholder={r.name} icon={REWARD_ICON} style={{ width: '100%', height: 110, marginBottom: 10 }} />}
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: '#1f2a24', marginBottom: 4 }}>{r.name}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#7A5205' }}>{r.cost} พอยท์</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: r.stock === 0 ? '#a33232' : '#6d7a72', marginBottom: 12 }}>{stockText(r)}</div>
                    <button
                      onClick={() => { setDialogError(''); setConfirmReward(r) }} disabled={!!blocked}
                      style={{ ...primaryBtn(!!blocked), marginTop: 'auto', padding: '9px 14px' }}
                    >
                      {blocked || 'แลกให้ผู้ใช้'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <h2 style={{ ...stepTitle, margin: 0 }}>ประวัติการแลก</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {HISTORY_FILTERS.map((f) => <button key={f.key} onClick={() => setHistoryFilter(f.key)} style={chipStyle(historyFilter === f.key)}>{f.label}</button>)}
          </div>
        </div>
        {historyError ? (
          <LoadError message="โหลดประวัติการแลกไม่สำเร็จ" onRetry={loadHistory} />
        ) : historyLoading && history.length === 0 ? (
          <LoadingSpinner size={32} label="กำลังโหลดประวัติ..." />
        ) : history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#8a938c', fontSize: 13.5 }}>ยังไม่มีรายการ</div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #EFEBDB', borderRadius: 12, opacity: historyLoading ? 0.6 : 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#6d7a72', background: '#FBF8EE' }}>
                  {['วันเวลา', 'ผู้ใช้', 'ของรางวัล', 'พอยท์', 'ทำรายการโดย', 'สถานะ', ''].map((h, i) => <th key={i} style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderTop: '1px solid #EFEBDB', opacity: h.status === 'cancelled' ? 0.65 : 1 }}>
                    <td style={{ padding: '10px 14px', color: '#6d7a72', whiteSpace: 'nowrap' }}>{fmtDateTime(h.redeemedAt)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 700 }}>{h.userName}</div>
                      {h.userPhone && <div style={{ fontSize: 12, color: '#6d7a72' }}>{h.userPhone}</div>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{h.rewardName}</td>
                    <td style={{ padding: '10px 14px', color: '#7A5205', fontWeight: 700 }}>{h.cost}</td>
                    <td style={{ padding: '10px 14px', color: '#6d7a72' }}>{h.adminName || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {h.status === 'cancelled'
                        ? <span title={h.cancelReason || ''} style={{ fontSize: 11.5, fontWeight: 700, background: '#fdecec', color: '#a33232', padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>ยกเลิกแล้ว</span>
                        : <span style={{ fontSize: 11.5, fontWeight: 700, background: '#E8F5E9', color: '#2E7D32', padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>แลกแล้ว</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {h.status === 'completed' && (
                        <button onClick={() => { setDialogError(''); setCancelReason(''); setCancelTarget(h) }} style={{ background: '#fff', color: '#a33232', border: '1px solid #e6b8b8', padding: '5px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>ยกเลิกรายการ</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 12, color: '#8a938c', marginTop: 8 }}>แสดง 100 รายการล่าสุด</div>
      </div>

      <Modal open={!!confirmReward} onClose={busy ? () => {} : closeDialogs} title="ยืนยันการแลกของรางวัล" maxWidth={460}>
        {confirmReward && user && (
          <>
            <div style={{ display: 'grid', gap: 8, fontSize: 14, color: '#3c463f', lineHeight: 1.6, marginBottom: 14 }}>
              <div>ผู้ใช้: <b>{user.displayName}</b></div>
              <div>ของรางวัล: <b>{confirmReward.name}</b></div>
              <div>หักพอยท์: <b style={{ color: '#7A5205' }}>{confirmReward.cost}</b> (คงเหลือ {user.pointsBalance} → <b>{user.pointsBalance - confirmReward.cost}</b>)</div>
              {confirmReward.stock != null && <div>จำนวนของรางวัล: เหลือ {confirmReward.stock} → <b>{confirmReward.stock - 1}</b> ชิ้น</div>}
            </div>
            <div style={{ fontSize: 13, color: '#6d7a72', marginBottom: 14 }}>กดยืนยันเมื่อพร้อมมอบของให้ผู้ใช้แล้ว หากบันทึกผิดสามารถยกเลิกรายการได้จากประวัติ</div>
            {dialogError && <div style={{ fontSize: 13, color: '#a33232', marginBottom: 12 }}>{dialogError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleRedeem} disabled={busy} style={primaryBtn(busy)}>{busy ? 'กำลังบันทึก...' : 'ยืนยันแลกของรางวัล'}</button>
              <button onClick={closeDialogs} disabled={busy} style={ghostBtn}>ยกเลิก</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!cancelTarget} onClose={busy ? () => {} : closeDialogs} title="ยกเลิกรายการแลก" maxWidth={460}>
        {cancelTarget && (
          <>
            <div style={{ fontSize: 14, color: '#3c463f', lineHeight: 1.6, marginBottom: 14 }}>
              ยกเลิกการแลก <b>{cancelTarget.rewardName}</b> ของ <b>{cancelTarget.userName}</b> ระบบจะคืน <b>{cancelTarget.cost}</b> พอยท์ให้ผู้ใช้ และคืนของรางวัล 1 ชิ้นกลับเข้าจำนวนคงเหลือ
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>เหตุผล</div>
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} maxLength={500} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, resize: 'vertical', marginBottom: 12 }} />
            {dialogError && <div style={{ fontSize: 13, color: '#a33232', marginBottom: 12 }}>{dialogError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleCancel} disabled={busy || !cancelReason.trim()} style={{ ...primaryBtn(busy || !cancelReason.trim()), background: busy || !cancelReason.trim() ? '#c9d2ca' : '#c0392b' }}>{busy ? 'กำลังดำเนินการ...' : 'ยกเลิกรายการ'}</button>
              <button onClick={closeDialogs} disabled={busy} style={ghostBtn}>ปิด</button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
