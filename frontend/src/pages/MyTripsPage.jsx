import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import PageControls from '../components/PageControls.jsx'
import Modal from '../components/Modal.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LoadError from '../components/LoadError.jsx'
import { fetchTrips, updateTrip, deleteTrip, duplicateTrip } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { MASCOT } from '../data/categoryImages.js'

const fmtDay = (isoDate, offsetDays = 0) => {
  const d = new Date(`${isoDate}T00:00:00`)
  d.setDate(d.getDate() + offsetDays)
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

const iconBtn = { border: '1px solid #DCD8C6', background: '#fff', color: '#3c463f', borderRadius: 12, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }

export default function MyTripsPage() {
  const { actions } = useApp()
  const navigate = useNavigate()
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [renaming, setRenaming] = useState(null) // { id, title }
  const [deleting, setDeleting] = useState(null) // trip row
  const [busy, setBusy] = useState(false)

  const paged = usePagedList(fetchTrips, { pageSize: 12, extraParams: { favorite: onlyFavorites ? '1' : undefined } })

  // One place for "call the API, refresh the list, or toast the reason".
  const run = async (fn, okMessage) => {
    setBusy(true)
    try {
      await fn()
      if (okMessage) actions.showToast(okMessage)
      paged.refetch()
      return true
    } catch (err) {
      actions.showToast(err.message || 'ทำรายการไม่สำเร็จ ลองอีกครั้งนะครับ')
      return false
    } finally {
      setBusy(false)
    }
  }

  const submitRename = async () => {
    const title = renaming.title.trim()
    if (!title) { actions.showToast('กรุณาตั้งชื่อทริป'); return }
    if (await run(() => updateTrip(renaming.id, { title }), 'เปลี่ยนชื่อทริปแล้ว')) setRenaming(null)
  }

  const confirmDelete = async () => {
    const wasOnlyRowOnPage = paged.rows.length === 1 && paged.page > 1
    if (await run(() => deleteTrip(deleting.id), 'ลบแผนทริปแล้ว')) {
      setDeleting(null)
      // Deleting the last card of a later page would otherwise leave an empty page.
      if (wasOnlyRowOnPage) paged.setPage(paged.page - 1)
    }
  }

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '36px 32px 60px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <h1 data-font="culture" style={{ fontSize: 27, fontWeight: 800, color: '#1B5E20', margin: '0 0 6px' }}>ทริปของฉัน</h1>
          <p style={{ color: '#6d7a72', fontSize: 14, margin: 0 }}>แผนการเดินทางที่น้องไดโนจัดให้และคุณบันทึกไว้</p>
        </div>
        <button onClick={actions.goTripForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#2E7D32)', color: '#fff', border: 'none', padding: '11px 22px', borderRadius: 20, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>+ สร้างแผนใหม่</button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 22 }}>
        <input value={paged.query} onChange={(e) => paged.setQuery(e.target.value)} placeholder="ค้นหาชื่อทริป..."
          style={{ width: '100%', maxWidth: 380, border: '1px solid #DCD8C6', borderRadius: 20, padding: '10px 18px', fontSize: 14 }} />
        <button onClick={() => setOnlyFavorites((v) => !v)} aria-pressed={onlyFavorites}
          style={{ ...iconBtn, borderRadius: 20, padding: '9px 16px', background: onlyFavorites ? '#FFF8E1' : '#fff', borderColor: onlyFavorites ? '#FBC02D' : '#DCD8C6', color: onlyFavorites ? '#8a6d00' : '#3c463f' }}>
          ★ เฉพาะรายการโปรด
        </button>
      </div>

      {paged.loading && paged.rows.length === 0 && <LoadingSpinner size={36} label="กำลังโหลดทริปของคุณ..." />}
      {paged.error && <LoadError message="โหลดรายการทริปไม่สำเร็จ" onRetry={paged.refetch} />}
      {!paged.loading && !paged.error && paged.rows.length === 0 && (
        <EmptyState mascot={MASCOT.sad} tone="green" style={{ padding: '56px 20px' }}
          title={paged.query || onlyFavorites ? 'ไม่พบทริปที่ตรงกับเงื่อนไข' : 'ยังไม่มีแผนทริปที่บันทึกไว้'}
          desc={paged.query || onlyFavorites ? 'ลองเปลี่ยนคำค้นหาหรือปิดตัวกรองรายการโปรด' : 'สร้างแผนแรกกับน้องไดโน แล้วแผนจะถูกบันทึกไว้ที่นี่อัตโนมัติ'}
          action={!paged.query && !onlyFavorites && <button onClick={actions.goTripForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#2E7D32)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 20, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>วางแผนทริป</button>} />
      )}

      <div style={{ display: paged.error ? 'none' : 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 22, opacity: paged.loading && paged.rows.length ? 0.6 : 1, transition: 'opacity 0.15s ease' }}>
        {paged.rows.map((t) => (
          <div key={t.id} style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, overflow: 'hidden', animation: 'dc-fade-up 0.4s ease both' }}>
            <div onClick={() => navigate(`/trip/${t.id}`)} style={{ position: 'relative', cursor: 'pointer' }}>
              <ImageSlot src={t.coverImg} shape="rect" style={{ width: '100%', height: 150 }} placeholder="แผนทริป" />
              <button aria-label={t.isFavorite ? 'เอาออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'} disabled={busy}
                onClick={(e) => { e.stopPropagation(); run(() => updateTrip(t.id, { isFavorite: !t.isFavorite })) }}
                style={{ position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.92)', color: t.isFavorite ? '#f9a825' : '#8a938c', fontSize: 18, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                {t.isFavorite ? '★' : '☆'}
              </button>
            </div>
            <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Link to={`/trip/${t.id}`} style={{ fontWeight: 800, fontSize: 16, color: '#1f2a24', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</Link>
              <div style={{ fontSize: 13, color: '#6d7a72' }}>
                {fmtDay(t.startDate)}{t.dayCount > 1 ? ` – ${fmtDay(t.startDate, t.dayCount - 1)}` : ''} · {t.dayCount} วัน
              </div>
              <div style={{ fontSize: 12.5, color: '#8a938c' }}>
                {t.placeCount} สถานที่ · {t.totalDistanceKm} กม. · ≈ ฿{Math.round(t.totalCostEstimate).toLocaleString('th-TH')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 10 }}>
                <button style={iconBtn} disabled={busy} onClick={() => setRenaming({ id: t.id, title: t.title })}>เปลี่ยนชื่อ</button>
                <button style={iconBtn} disabled={busy} onClick={() => run(() => duplicateTrip(t.id), 'ทำสำเนาแผนแล้ว')}>ทำสำเนา</button>
                <button style={{ ...iconBtn, color: '#a33232', borderColor: '#f0c4c4' }} disabled={busy} onClick={() => setDeleting(t)}>ลบ</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="เปลี่ยนชื่อทริป" maxWidth={420}>
        {renaming && (
          <form onSubmit={(e) => { e.preventDefault(); submitRename() }}>
            <input autoFocus value={renaming.title} maxLength={120} onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
              style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 12, padding: '10px 14px', fontSize: 14, marginBottom: 16 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" style={iconBtn} onClick={() => setRenaming(null)}>ยกเลิก</button>
              <button type="submit" disabled={busy} style={{ ...iconBtn, background: '#2E7D32', borderColor: '#2E7D32', color: '#fff' }}>บันทึก</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="ลบแผนทริปนี้?" maxWidth={420}>
        {deleting && (
          <>
            <p style={{ fontSize: 14, color: '#3c463f', margin: '0 0 18px' }}>“{deleting.title}” จะถูกลบถาวร และกู้คืนไม่ได้</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button style={iconBtn} onClick={() => setDeleting(null)}>ยกเลิก</button>
              <button disabled={busy} onClick={confirmDelete} style={{ ...iconBtn, background: '#a33232', borderColor: '#a33232', color: '#fff' }}>ลบแผนทริป</button>
            </div>
          </>
        )}
      </Modal>
    </main>
  )
}
