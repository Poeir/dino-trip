import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Avatar from '../components/Avatar.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import { REWARD_ICON } from '../data/categoryImages.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import { fetchAdminUsers, fetchRewards, fetchRedemptionHistory, redeemForUser, cancelRedemption } from '../lib/apiClient.js'
import { fmtDateTime } from '../lib/format.js'
import AdminPageHeader from './ui/AdminPageHeader.jsx'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import { useConfirm } from './ui/ConfirmDialog.jsx'
import FilterChips from './ui/FilterChips.jsx'
import ListState from './ui/ListState.jsx'

const errorText = (err) => (err.status === undefined ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : err.message)

const HISTORY_FILTERS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'completed', label: 'แลกแล้ว' },
  { value: 'cancelled', label: 'ยกเลิกแล้ว' },
]
const HISTORY_HEADERS = ['วันเวลา', 'ผู้ใช้', 'ของรางวัล', 'พอยท์', 'ทำรายการโดย', 'สถานะ', 'การดำเนินการ']

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
        type="search" className="ad-input ad-search-wide"
        value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
        aria-label="ค้นหาผู้ใช้"
        placeholder="พิมพ์ชื่อ อีเมล หรือเบอร์โทรของผู้ใช้..."
      />
      {loading && <LoadingSpinner size={24} label="กำลังค้นหา..." />}
      {error && <div className="ad-error-text" role="alert">{error}</div>}
      {!loading && !error && results && results.length === 0 && (
        <div className="ad-fs-sm ad-text-muted">ไม่พบบัญชีที่ใช้งานอยู่ตรงกับ "{query.trim()}" (บัญชีที่ถูกระงับหรือลบแล้วแลกให้ไม่ได้)</div>
      )}
      {results && results.length > 0 && (
        <div className={`ad-pick-list ad-fade${loading ? ' is-loading' : ''}`}>
          {results.map((u) => (
            <button key={u.id} type="button" className="ad-pick" onClick={() => onPick(u)}>
              <Avatar user={u} size={40} />
              <span className="ad-pick__body">
                <span className="ad-user-card__name ad-block">{u.displayName}</span>
                <span className="ad-fs-xs ad-text-muted ad-block">{[u.phone, u.email].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="ad-text-warn ad-count-chip ad-nowrap">{u.pointsBalance} พอยท์</span>
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

  const { confirm, confirmDialog } = useConfirm()

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

  const handleRedeem = async (reward) => {
    const res = await confirm({
      title: 'ยืนยันการแลกของรางวัล',
      message: (
        <>
          <div className="ad-form-stack">
            <div>ผู้ใช้: <b>{user.displayName}</b></div>
            <div>ของรางวัล: <b>{reward.name}</b></div>
            <div>หักพอยท์: <b className="ad-text-warn">{reward.cost}</b> (คงเหลือ {user.pointsBalance} → <b>{user.pointsBalance - reward.cost}</b>)</div>
            {reward.stock != null && <div>จำนวนของรางวัล: เหลือ {reward.stock} → <b>{reward.stock - 1}</b> ชิ้น</div>}
          </div>
          <p className="ad-help">กดยืนยันเมื่อพร้อมมอบของให้ผู้ใช้แล้ว หากบันทึกผิดสามารถยกเลิกรายการได้จากประวัติ</p>
        </>
      ),
      confirmLabel: 'ยืนยันแลกของรางวัล',
      run: async () => {
        try {
          return await redeemForUser(user.id, reward.id)
        } catch (err) {
          if (actions.handleSessionExpired(err)) err.silent = true
          // Stock or points changed under us (another counter, or a cancel): show the real numbers.
          else if (err.status === 409 || err.status === 402) loadRewards()
          throw err
        }
      },
    })
    if (!res) return
    const { result } = res
    actions.showToast(`แลก "${result.rewardName}" ให้ ${user.displayName} แล้ว เหลือ ${result.balance} พอยท์`)
    setUser({ ...user, pointsBalance: result.balance })
    loadRewards()
    loadHistory()
  }

  const handleCancel = async (target) => {
    const res = await confirm({
      title: 'ยกเลิกรายการแลก',
      message: <>ยกเลิกการแลก <b>{target.rewardName}</b> ของ <b>{target.userName}</b> ระบบจะคืน <b>{target.cost}</b> พอยท์ให้ผู้ใช้ และคืนของรางวัล 1 ชิ้นกลับเข้าจำนวนคงเหลือ</>,
      confirmLabel: 'ยกเลิกรายการ',
      cancelLabel: 'ปิด',
      danger: true,
      reason: 'required',
      run: async ({ reason }) => {
        try {
          return await cancelRedemption(target.id, reason)
        } catch (err) {
          if (actions.handleSessionExpired(err)) err.silent = true
          throw err
        }
      },
    })
    if (!res) return
    const { result } = res
    actions.showToast(`ยกเลิกรายการแล้ว คืน ${target.cost} พอยท์ให้ ${target.userName}`)
    if (user && user.id === result.userId) setUser({ ...user, pointsBalance: result.balance })
    loadRewards()
    loadHistory()
  }

  return (
    <>
      <AdminPageHeader
        title="แลกของรางวัลที่เคาน์เตอร์"
        subtitle="ค้นหาผู้ใช้ เลือกของรางวัล แล้วยืนยัน ระบบจะหักพอยท์และลดจำนวนของรางวัลให้ในขั้นตอนเดียว"
      />

      <section className="ad-panel" aria-labelledby="redeem-step-1">
        <h2 id="redeem-step-1" className="ad-panel__title">1. เลือกผู้ใช้</h2>
        {user ? (
          <div className="ad-user-card">
            <Avatar user={user} size={52} />
            <div className="ad-user-card__body">
              <div className="ad-user-card__name">{user.displayName}</div>
              <div className="ad-fs-sm ad-text-muted ad-wrap-any">{[user.phone, user.email].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="ad-user-card__points">
              <div className="ad-fs-xs ad-text-muted">พอยท์คงเหลือ</div>
              <div className="ad-user-card__points-num">{user.pointsBalance}</div>
            </div>
            <Button variant="secondary" onClick={() => setUser(null)}>เปลี่ยนผู้ใช้</Button>
          </div>
        ) : (
          <UserPicker onPick={setUser} />
        )}
      </section>

      {user && (
        <section className="ad-panel" aria-labelledby="redeem-step-2">
          <h2 id="redeem-step-2" className="ad-panel__title">2. เลือกของรางวัล</h2>
          {rewardsLoading && rewards.length === 0 ? (
            <LoadingSpinner size={32} label="กำลังโหลดของรางวัล..." />
          ) : rewardsError ? (
            <LoadError message="โหลดรายการของรางวัลไม่สำเร็จ" onRetry={loadRewards} />
          ) : rewards.length === 0 ? (
            <div className="ad-fs-sm ad-text-muted">ยังไม่มีของรางวัลในระบบ เพิ่มได้ที่แท็บ "ของรางวัล"</div>
          ) : (
            <div className={`ad-reward-grid ad-fade${rewardsLoading ? ' is-loading' : ''}`}>
              {rewards.map((r) => {
                const blocked = blockedReason(r, user)
                return (
                  <div key={r.id} className="ad-reward">
                    {r.imageUrl && <ImageSlot src={r.imageUrl} radius={10} placeholder={r.name} icon={REWARD_ICON} style={{ width: '100%', height: 110, marginBottom: 10 }} />}
                    <div className="ad-reward__name">{r.name}</div>
                    <div className="ad-reward__cost">{r.cost} พอยท์</div>
                    <div className={`ad-reward__stock${r.stock === 0 ? ' is-out' : ''}`}>{stockText(r)}</div>
                    <Button onClick={() => handleRedeem(r)} disabled={!!blocked}>{blocked || 'แลกให้ผู้ใช้'}</Button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      <section className="ad-panel" aria-labelledby="redeem-history">
        <div className="ad-panel__head">
          <h2 id="redeem-history" className="ad-panel__title">ประวัติการแลก</h2>
          <FilterChips label="กรองประวัติตามสถานะ" options={HISTORY_FILTERS} value={historyFilter} onChange={setHistoryFilter} />
        </div>
        {historyError ? (
          <LoadError message="โหลดประวัติการแลกไม่สำเร็จ" onRetry={loadHistory} />
        ) : historyLoading && history.length === 0 ? (
          <LoadingSpinner size={32} label="กำลังโหลดประวัติ..." />
        ) : history.length === 0 ? (
          <ListState empty emptyText="ยังไม่มีรายการ" />
        ) : (
          <div className={`ad-table-wrap ad-fade${historyLoading ? ' is-loading' : ''}`}>
            <table className="ad-table">
              <thead>
                <tr>{HISTORY_HEADERS.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className={h.status === 'cancelled' ? 'is-muted' : undefined}>
                    <td className="ad-nowrap ad-text-muted">{fmtDateTime(h.redeemedAt)}</td>
                    <td>
                      <div className="ad-count-chip">{h.userName}</div>
                      {h.userPhone && <div className="ad-fs-xs ad-text-muted">{h.userPhone}</div>}
                    </td>
                    <td>{h.rewardName}</td>
                    <td className="ad-text-warn ad-count-chip">{h.cost}</td>
                    <td className="ad-text-muted">{h.adminName || '-'}</td>
                    <td>
                      {h.status === 'cancelled'
                        ? <span title={h.cancelReason || ''}><Badge tone="danger">ยกเลิกแล้ว</Badge></span>
                        : <Badge tone="success">แลกแล้ว</Badge>}
                    </td>
                    <td>
                      {h.status === 'completed' && (
                        <Button variant="dangersoft" size="sm" onClick={() => handleCancel(h)}>ยกเลิกรายการ</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="ad-fs-xs ad-text-muted ad-footnote">แสดง 100 รายการล่าสุด</div>
      </section>
      {confirmDialog}
    </>
  )
}
