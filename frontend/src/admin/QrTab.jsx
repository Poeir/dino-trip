import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'

export default function QrTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [qrQuery, setQrQuery] = useState('')
  const [rewardQuery, setRewardQuery] = useState('')
  const filteredQrsView = derived.qrsView.filter((q) => q.placeName.toLowerCase().includes(qrQuery.trim().toLowerCase()))
  const filteredRewardsView = derived.rewardsAdminView.filter((r) => r.name.toLowerCase().includes(rewardQuery.trim().toLowerCase()))
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>QR &amp; พอยท์สะสม</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={actions.onNewQr} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ สร้าง QR ใหม่</button>
          <button onClick={actions.onNewReward} style={{ background: '#FBC02D', color: '#1B5E20', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ เพิ่มของรางวัล</button>
        </div>
      </div>

      {derived.isQrFormOpen && (
        <div data-role="admin-form-panel" style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 22, marginBottom: 20 }}>
          <select value={f.placeId || ''} onChange={actions.onField_placeId} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }}>
            <option value="">เลือกสถานที่</option>
            {state.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={f.points || ''} onChange={actions.onField_points} placeholder="จำนวนพอยท์ที่ได้รับ" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 18 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={actions.saveForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึก</button>
            <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
        </div>
      )}
      {derived.isRewardFormOpen && (
        <div data-role="admin-form-panel" style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 22, marginBottom: 20 }}>
          <input value={f.name || ''} onChange={actions.onField_name} placeholder="ชื่อของรางวัล" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          <input value={f.cost || ''} onChange={actions.onField_cost} placeholder="พอยท์ที่ใช้แลก" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 18 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={actions.saveForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึก</button>
            <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div style={{ fontWeight: 800, fontSize: 14, color: '#1B5E20', marginBottom: 10 }}>รายการ QR Code</div>
      <input value={qrQuery} onChange={(e) => setQrQuery(e.target.value)} placeholder="ค้นหา QR ตามชื่อสถานที่..." style={{ width: '100%', maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5, marginBottom: 16, display: 'block' }} />
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
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={q.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
              <button onClick={q.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontWeight: 800, fontSize: 14, color: '#1B5E20', marginBottom: 10 }}>ของรางวัลที่แลกได้</div>
      <input value={rewardQuery} onChange={(e) => setRewardQuery(e.target.value)} placeholder="ค้นหาของรางวัล..." style={{ width: '100%', maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5, marginBottom: 16, display: 'block' }} />
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
