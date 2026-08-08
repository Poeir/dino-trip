import { useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'

const qrValue = (q) => `DINO-QR|placeId=${q.placeId}|qrId=${q.id}|points=${q.points}`
const PREVIEW_CANVAS_ID = 'qr-canvas-preview'

function downloadQrPng(canvasId, filename) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export default function QrTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [qrQuery, setQrQuery] = useState('')
  const [rewardQuery, setRewardQuery] = useState('')
  const [qrSortBy, setQrSortBy] = useState('placeName-asc')
  const [rewardSortBy, setRewardSortBy] = useState('name-asc')
  const [previewQr, setPreviewQr] = useState(null)

  const qrSorters = {
    'placeName-asc': (a, b) => a.placeName.localeCompare(b.placeName, 'th'),
    'placeName-desc': (a, b) => b.placeName.localeCompare(a.placeName, 'th'),
    'points-desc': (a, b) => b.points - a.points,
    'points-asc': (a, b) => a.points - b.points,
  }
  const rewardSorters = {
    'name-asc': (a, b) => a.name.localeCompare(b.name, 'th'),
    'name-desc': (a, b) => b.name.localeCompare(a.name, 'th'),
    'cost-desc': (a, b) => b.cost - a.cost,
    'cost-asc': (a, b) => a.cost - b.cost,
  }

  const filteredQrsView = derived.qrsView
    .filter((q) => q.placeName.toLowerCase().includes(qrQuery.trim().toLowerCase()))
    .sort(qrSorters[qrSortBy])
  const filteredRewardsView = derived.rewardsAdminView
    .filter((r) => r.name.toLowerCase().includes(rewardQuery.trim().toLowerCase()))
    .sort(rewardSorters[rewardSortBy])

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>QR &amp; พอยท์สะสม</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={actions.onNewQr} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ สร้าง QR ใหม่</button>
          <button onClick={actions.onNewReward} style={{ background: '#FBC02D', color: '#1B5E20', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ เพิ่มของรางวัล</button>
        </div>
      </div>

      <Modal open={derived.isQrFormOpen} onClose={actions.cancelForm} title={state.editingId ? 'แก้ไข QR' : 'สร้าง QR ใหม่'} maxWidth={480}>
        <Field label="สถานที่ที่ผูกกับ QR นี้">
          <select value={f.placeId || ''} onChange={actions.onField_placeId} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }}>
            <option value="">เลือกสถานที่</option>
            {state.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
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
          <button onClick={actions.saveForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึก</button>
          <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
        </div>
      </Modal>

      <Modal open={!!previewQr} onClose={() => setPreviewQr(null)} title={previewQr ? `QR Code: ${previewQr.placeName}` : ''} maxWidth={380}>
        {previewQr && (
          <div style={{ textAlign: 'center' }}>
            <QRCodeCanvas id={PREVIEW_CANVAS_ID} value={qrValue(previewQr)} size={200} includeMargin />
            <button onClick={() => downloadQrPng(PREVIEW_CANVAS_ID, `qr-${previewQr.placeName}.png`)} style={{ display: 'block', width: '100%', marginTop: 14, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 9, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>ดาวน์โหลด PNG</button>
          </div>
        )}
      </Modal>

      <div style={{ fontWeight: 800, fontSize: 14, color: '#1B5E20', marginBottom: 10 }}>รายการ QR Code</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input value={qrQuery} onChange={(e) => setQrQuery(e.target.value)} placeholder="ค้นหา QR ตามชื่อสถานที่..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
        <select value={qrSortBy} onChange={(e) => setQrSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
          <option value="placeName-asc">ชื่อสถานที่ (ก-ฮ)</option>
          <option value="placeName-desc">ชื่อสถานที่ (ฮ-ก)</option>
          <option value="points-desc">พอยท์มาก-น้อย</option>
          <option value="points-asc">พอยท์น้อย-มาก</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16, marginBottom: 28 }}>
        {filteredQrsView.map((q) => (
          <div key={q.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FFF8E1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <span style={{ width: 17, height: 13, border: '2px solid #7A5205', borderRadius: 3, position: 'relative', display: 'inline-block' }}>
                <span style={{ position: 'absolute', top: 1.5, left: 3, width: 6, height: 6, borderRadius: '50%', border: '2px solid #7A5205' }}></span>
              </span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{q.placeName}</div>
            <div style={{ fontSize: 12.5, color: '#7A5205', fontWeight: 700, marginBottom: 12 }}>+{q.points} พอยท์</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={q.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
              <button onClick={q.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
            </div>
            <button onClick={() => setPreviewQr(q)} style={{ width: '100%', background: '#fff', color: '#6d7a72', border: '1px solid #DCD8C6', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แสดง QR Code</button>
          </div>
        ))}
      </div>

      <div style={{ fontWeight: 800, fontSize: 14, color: '#1B5E20', marginBottom: 10 }}>ของรางวัลที่แลกได้</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input value={rewardQuery} onChange={(e) => setRewardQuery(e.target.value)} placeholder="ค้นหาของรางวัล..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
        <select value={rewardSortBy} onChange={(e) => setRewardSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
          <option value="name-asc">ชื่อ (ก-ฮ)</option>
          <option value="name-desc">ชื่อ (ฮ-ก)</option>
          <option value="cost-desc">พอยท์มาก-น้อย</option>
          <option value="cost-asc">พอยท์น้อย-มาก</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16 }}>
        {filteredRewardsView.map((r) => (
          <div key={r.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FFF8E1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <span style={{ width: 18, height: 14, border: '2px solid #7A5205', borderRadius: 2, position: 'relative' }}>
                <span style={{ position: 'absolute', top: -6, left: 6.5, width: 2, height: 20, background: '#7A5205' }}></span>
                <span style={{ position: 'absolute', top: 2, left: -1, width: 20, height: 2, background: '#7A5205' }}></span>
              </span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{r.name}</div>
            <div style={{ fontSize: 12.5, color: '#6d7a72', marginBottom: 12 }}>{r.cost} พอยท์</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={r.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
              <button onClick={r.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
