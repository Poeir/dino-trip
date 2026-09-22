import { useEffect, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import PlacePicker from '../components/PlacePicker.jsx'
import PageControls from '../components/PageControls.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { fetchRewards, fetchPlaceNames } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'

// qrs has no DB column to search/sort "by place name" against (that's a
// join, done client-side in derived.qrsView below) -- so unlike rewards,
// its list stays a client-side slice of the already bulk-loaded state.qrs
// rather than its own paginated fetch. See usePagedList.js for the
// server-paginated pattern used everywhere else.
const QR_PAGE_SIZE = 20

// QrTab's rewards sort dropdown -> crudRouter.js's ?sort=/?dir=.
const REWARD_SORT_PARAMS = {
  'name-asc': { sort: 'name', dir: 'asc' },
  'name-desc': { sort: 'name', dir: 'desc' },
  'cost-desc': { sort: 'cost', dir: 'desc' },
  'cost-asc': { sort: 'cost', dir: 'asc' },
}

// Just the opaque qrId -- points/place name are looked up server-side when
// this URL is scanned (see qrs.routes.js's POST /:id/scan), never trusted
// from the QR's own content. A full URL (rather than a bare id string)
// means the code also works when scanned by a phone's regular camera app,
// not just the in-app scanner -- see ScanLandingPage.jsx.
const qrValue = (q) => `${window.location.origin}/scan/${q.id}`
const PREVIEW_CANVAS_ID = 'qr-canvas-preview'
const PRINT_CANVAS_ID = 'qr-canvas-print'

function downloadQrPng(canvasId, filename) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
}

// Small hand-drawn glyphs (border/pseudo-element shapes, no icon library) --
// matches how every other icon in the admin (sidebar, dashboard stat cards)
// is built. Pulled out here once instead of redrawn per usage site.
function QrGlyph({ color = '#7A5205', size = 16 }) {
  return (
    <span style={{ width: size, height: size * 0.76, border: `2px solid ${color}`, borderRadius: 3, position: 'relative', display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: size * 0.1, left: size * 0.18, width: size * 0.35, height: size * 0.35, borderRadius: '50%', border: `2px solid ${color}` }} />
    </span>
  )
}
function GiftGlyph({ color = '#7A5205', size = 17 }) {
  return (
    <span style={{ width: size, height: size * 0.78, border: `2px solid ${color}`, borderRadius: 2, position: 'relative', display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: -size * 0.35, left: size * 0.36, width: 2, height: size * 1.15, background: color }} />
      <span style={{ position: 'absolute', top: size * 0.1, left: -1, width: size * 1.15, height: 2, background: color }} />
    </span>
  )
}

function IconBadge({ children, bg = '#FFF8E1', size = 36, radius = 10 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {children}
    </div>
  )
}

function StatCard({ icon, value, label }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 16, padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
      <IconBadge size={40}>{icon}</IconBadge>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', lineHeight: 1.2 }}>{value}</div>
        <div style={{ fontSize: 12.5, color: '#6d7a72' }}>{label}</div>
      </div>
    </div>
  )
}

function SectionHeader({ icon, title, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <IconBadge>{icon}</IconBadge>
      <div style={{ fontWeight: 800, fontSize: 15, color: '#1B5E20' }}>{title}</div>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#7A5205', background: '#FFF8E1', padding: '2px 10px', borderRadius: 20 }}>{count}</span>
    </div>
  )
}

function EmptyState({ icon, title, desc, actionLabel, onAction, buttonStyle }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 24px', border: '1px dashed #DCD8C6', borderRadius: 16, background: '#fff' }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: '#FFF8E1', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>{icon}</div>
      <div style={{ fontWeight: 800, fontSize: 15, color: '#1B5E20', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#6d7a72', marginBottom: 18, maxWidth: 320, marginLeft: 'auto', marginRight: 'auto' }}>{desc}</div>
      <button onClick={onAction} style={{ border: 'none', padding: '9px 22px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', ...buttonStyle }}>{actionLabel}</button>
    </div>
  )
}

export default function QrTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [qrQuery, setQrQuery] = useState('')
  const [qrSortBy, setQrSortBy] = useState('placeName-asc')
  const [qrPage, setQrPage] = useState(1)
  const [rewardSortBy, setRewardSortBy] = useState('name-asc')
  const pagedRewards = usePagedList(fetchRewards, { pageSize: 20, extraParams: REWARD_SORT_PARAMS[rewardSortBy] })
  const [previewQr, setPreviewQr] = useState(null)
  const [printQr, setPrintQr] = useState(null)
  const [placeNameById, setPlaceNameById] = useState(new Map())

  // derived.qrsView no longer joins placeName (no bulk state.places to join
  // against) -- fetch a lean id->name map once instead.
  useEffect(() => {
    let cancelled = false
    fetchPlaceNames().then((rows) => { if (!cancelled) setPlaceNameById(new Map(rows.map((p) => [p.id, p.name]))) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Search/sort narrow the qrs result set -- back to page 1 so it doesn't
  // land on a now out-of-range page of the shorter list.
  useEffect(() => { setQrPage(1) }, [qrQuery, qrSortBy])

  // Prints just #qr-print-label (see the @media print rule below it) --
  // window.print() opens the browser's normal print dialog, which already
  // offers "Save as PDF", so no PDF library/dependency is needed here.
  useEffect(() => {
    if (!printQr) return
    const handleAfterPrint = () => setPrintQr(null)
    window.addEventListener('afterprint', handleAfterPrint)
    const t = setTimeout(() => window.print(), 50)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', handleAfterPrint) }
  }, [printQr])

  const handleSaveReward = async () => {
    await actions.saveForm()
    pagedRewards.refetch()
  }

  const qrSorters = {
    'placeName-asc': (a, b) => a.placeName.localeCompare(b.placeName, 'th'),
    'placeName-desc': (a, b) => b.placeName.localeCompare(a.placeName, 'th'),
    'points-desc': (a, b) => b.points - a.points,
    'points-asc': (a, b) => a.points - b.points,
  }

  const qrsView = derived.qrsView.map((q) => ({ ...q, placeName: placeNameById.get(q.placeId) || '-' }))
  const filteredQrsView = qrsView
    .filter((q) => q.placeName.toLowerCase().includes(qrQuery.trim().toLowerCase()))
    .sort(qrSorters[qrSortBy])
  const qrTotalPages = Math.max(1, Math.ceil(filteredQrsView.length / QR_PAGE_SIZE))
  const qrPageView = filteredQrsView.slice((qrPage - 1) * QR_PAGE_SIZE, qrPage * QR_PAGE_SIZE)

  const rewardsView = pagedRewards.rows.map((r) => ({
    ...r,
    onEdit: () => actions.openEditForm('reward', r),
    onDelete: async () => { await actions.deleteItem('reward', r.id); pagedRewards.refetch() },
  }))

  // `total`/`derived.qrsView` start at 0/[] before the first fetch settles --
  // without the loading check these would flash the "ยังไม่มี..." empty
  // state on every load instead of a spinner.
  const hasAnyQrs = qrsView.length > 0 || state.dataLoading
  const hasAnyRewards = pagedRewards.total > 0 || pagedRewards.loading

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>QR &amp; พอยท์สะสม</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={actions.onNewQr} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ สร้าง QR ใหม่</button>
          <button onClick={actions.onNewReward} style={{ background: '#FBC02D', color: '#1B5E20', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ เพิ่มของรางวัล</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, marginBottom: 28, maxWidth: 520 }}>
        <StatCard icon={<QrGlyph size={17} />} value={qrsView.length} label="QR ทั้งหมดในระบบ" />
        <StatCard icon={<GiftGlyph size={18} />} value={pagedRewards.total} label="ของรางวัลทั้งหมด" />
      </div>

      <Modal open={derived.isQrFormOpen} onClose={actions.cancelForm} title={state.editingId ? 'แก้ไข QR' : 'สร้าง QR ใหม่'} maxWidth={580}>
        <Field label="สถานที่ที่ผูกกับ QR นี้">
          <div style={{ marginBottom: 14 }}>
            <PlacePicker value={f.placeId} onChange={(id) => actions.updateFormField('placeId', id)} />
          </div>
        </Field>
        <Field label="จำนวนพอยท์ที่ได้รับเมื่อสแกน">
          <input value={f.points || ''} onChange={actions.onField_points} placeholder="เช่น 10" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 18 }} />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={actions.saveForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึก</button>
          <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
        </div>
      </Modal>

      <Modal open={derived.isRewardFormOpen} onClose={actions.cancelForm} title={state.editingId ? 'แก้ไขของรางวัล' : 'เพิ่มของรางวัลใหม่'} maxWidth={480}>
        <Field label="ชื่อของรางวัล">
          <input value={f.name || ''} onChange={actions.onField_name} placeholder="เช่น ส่วนลด 50 บาท" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
        </Field>
        <Field label="พอยท์ที่ใช้แลก">
          <input value={f.cost || ''} onChange={actions.onField_cost} placeholder="เช่น 50" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 18 }} />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleSaveReward} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึก</button>
          <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
        </div>
      </Modal>

      <Modal open={!!previewQr} onClose={() => setPreviewQr(null)} title={previewQr ? `QR Code: ${previewQr.placeName}` : ''} maxWidth={380}>
        {previewQr && (
          <div style={{ textAlign: 'center' }}>
            <QRCodeCanvas id={PREVIEW_CANVAS_ID} value={qrValue(previewQr)} size={200} includeMargin />
            <div style={{ fontSize: 12.5, color: '#7A5205', fontWeight: 700, margin: '12px 0 16px' }}>สแกนรับ {previewQr.points} พอยท์</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => downloadQrPng(PREVIEW_CANVAS_ID, `qr-${previewQr.placeName}.png`)} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 9, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>ดาวน์โหลด PNG</button>
              <button onClick={() => setPrintQr(previewQr)} style={{ flex: 1, background: '#FFF8E1', color: '#7A5205', border: 'none', padding: 9, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>พิมพ์ป้าย</button>
            </div>
          </div>
        )}
      </Modal>

      {printQr && (
        <div id="qr-print-label" style={{ display: 'none' }}>
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #qr-print-label, #qr-print-label * { visibility: visible; }
              #qr-print-label {
                display: flex !important;
                position: fixed; inset: 0;
                flex-direction: column; align-items: center; justify-content: center;
                padding: 40px;
              }
            }
          `}</style>
          <QRCodeCanvas id={PRINT_CANVAS_ID} value={qrValue(printQr)} size={280} includeMargin />
          <div style={{ marginTop: 20, fontSize: 22, fontWeight: 800, color: '#1B5E20', textAlign: 'center' }}>{printQr.placeName}</div>
          <div style={{ marginTop: 8, fontSize: 16, color: '#7A5205', fontWeight: 700 }}>สแกนรับ {printQr.points} พอยท์</div>
        </div>
      )}

      <SectionHeader icon={<QrGlyph />} title="รายการ QR Code" count={qrsView.length} />
      {hasAnyQrs ? (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <input value={qrQuery} onChange={(e) => setQrQuery(e.target.value)} placeholder="ค้นหา QR ตามชื่อสถานที่..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
            <select value={qrSortBy} onChange={(e) => setQrSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
              <option value="placeName-asc">ชื่อสถานที่ (ก-ฮ)</option>
              <option value="placeName-desc">ชื่อสถานที่ (ฮ-ก)</option>
              <option value="points-desc">พอยท์มาก-น้อย</option>
              <option value="points-asc">พอยท์น้อย-มาก</option>
            </select>
            <span style={{ fontSize: 12.5, color: '#8a938c' }}>พบ {filteredQrsView.length} รายการ</span>
          </div>
          {filteredQrsView.length === 0 ? (
            state.dataLoading
              ? <LoadingSpinner size={32} label="กำลังโหลด QR..." />
              : <div style={{ textAlign: 'center', padding: 28, color: '#8a938c', fontSize: 13.5, marginBottom: 28 }}>ไม่พบ QR ที่ตรงกับ "{qrQuery}"</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16, marginBottom: 28 }}>
                {qrPageView.map((q) => (
                  <div key={q.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 16 }}>
                    <IconBadge><QrGlyph /></IconBadge>
                    <div style={{ fontWeight: 700, fontSize: 14, margin: '12px 0 3px' }}>{q.placeName}</div>
                    <div style={{ fontSize: 12.5, color: '#7A5205', fontWeight: 700, marginBottom: 12 }}>+{q.points} พอยท์</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <button onClick={q.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
                      <button onClick={q.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
                    </div>
                    <button onClick={() => setPreviewQr(q)} style={{ width: '100%', background: '#fff', color: '#6d7a72', border: '1px solid #DCD8C6', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ดู QR Code</button>
                  </div>
                ))}
              </div>
              <PageControls page={qrPage} totalPages={qrTotalPages} total={filteredQrsView.length} onChange={setQrPage} />
            </>
          )}
        </>
      ) : (
        <div style={{ marginBottom: 28 }}>
          <EmptyState
            icon={<QrGlyph size={22} />}
            title="ยังไม่มี QR Code ในระบบ"
            desc="สร้าง QR แรกแล้วผูกกับสถานที่ท่องเที่ยว เพื่อพิมพ์ไปแปะให้นักท่องเที่ยวสแกนรับพอยท์"
            actionLabel="+ สร้าง QR ใหม่"
            onAction={actions.onNewQr}
            buttonStyle={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff' }}
          />
        </div>
      )}

      <SectionHeader icon={<GiftGlyph />} title="ของรางวัลที่แลกได้" count={pagedRewards.total} />
      {hasAnyRewards ? (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <input value={pagedRewards.query} onChange={(e) => pagedRewards.setQuery(e.target.value)} placeholder="ค้นหาของรางวัล..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
            <select value={rewardSortBy} onChange={(e) => setRewardSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
              <option value="name-asc">ชื่อ (ก-ฮ)</option>
              <option value="name-desc">ชื่อ (ฮ-ก)</option>
              <option value="cost-desc">พอยท์มาก-น้อย</option>
              <option value="cost-asc">พอยท์น้อย-มาก</option>
            </select>
            <span style={{ fontSize: 12.5, color: '#8a938c' }}>{pagedRewards.loading ? 'กำลังโหลด...' : `พบ ${pagedRewards.total} รายการ`}</span>
          </div>
          {rewardsView.length === 0 ? (
            pagedRewards.loading
              ? <LoadingSpinner size={32} label="กำลังโหลดของรางวัล..." />
              : <div style={{ textAlign: 'center', padding: 28, color: '#8a938c', fontSize: 13.5 }}>ไม่พบของรางวัลที่ตรงกับ "{pagedRewards.query}"</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16, opacity: pagedRewards.loading ? 0.5 : 1, transition: 'opacity 0.15s ease', pointerEvents: pagedRewards.loading ? 'none' : 'auto' }}>
                {rewardsView.map((r) => (
                  <div key={r.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 16 }}>
                    <IconBadge><GiftGlyph /></IconBadge>
                    <div style={{ fontWeight: 700, fontSize: 14, margin: '12px 0 3px' }}>{r.name}</div>
                    <div style={{ fontSize: 12.5, color: '#6d7a72', marginBottom: 12 }}>{r.cost} พอยท์</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={r.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
                      <button onClick={r.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
                    </div>
                  </div>
                ))}
              </div>
              <PageControls page={pagedRewards.page} totalPages={pagedRewards.totalPages} total={pagedRewards.total} onChange={pagedRewards.setPage} />
            </>
          )}
        </>
      ) : (
        <EmptyState
          icon={<GiftGlyph size={22} />}
          title="ยังไม่มีของรางวัลในระบบ"
          desc="เพิ่มของรางวัลอย่างน้อย 1 ชิ้น เพื่อให้นักท่องเที่ยวมีของให้แลกด้วยพอยท์ที่สะสมได้"
          actionLabel="+ เพิ่มของรางวัล"
          onAction={actions.onNewReward}
          buttonStyle={{ background: '#FBC02D', color: '#1B5E20' }}
        />
      )}
    </>
  )
}
