import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'

export default function PlacesTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [query, setQuery] = useState('')
  const filteredPlacesView = derived.placesView.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>จัดการสถานที่</h1>
        <button onClick={actions.onNewPlace} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ เพิ่มสถานที่ใหม่</button>
      </div>

      {derived.isPlaceFormOpen && (
        <div data-role="admin-form-panel" style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 22, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <input value={f.name || ''} onChange={actions.onField_name} placeholder="ชื่อสถานที่" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            <select value={f.category || ''} onChange={actions.onField_category} style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }}>
              {derived.placeCategoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <input value={f.rating || ''} onChange={actions.onField_rating} placeholder="คะแนน (เช่น 4.5)" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            <input value={f.price || ''} onChange={actions.onField_price} placeholder="ช่วงราคา" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
          </div>
          <input value={f.address || ''} onChange={actions.onField_address} placeholder="ที่อยู่" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          <input value={f.img || ''} onChange={actions.onField_img} placeholder="ลิงก์รูปภาพ (URL)" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 8 }} />
          <div style={{ marginBottom: 6 }}>
            <ImageSlot src={f.img} shape="rect" style={{ width: 160, height: 90 }} placeholder="ตัวอย่างรูป" />
          </div>
          <div style={{ fontSize: 11.5, color: '#a33232', marginBottom: 14 }}>หมายเหตุ: ระบบยังไม่รองรับการบันทึกรูปสถานที่ผ่านฟอร์มนี้จริง (ต้องรอปรับปรุงฝั่ง backend)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <input value={f.hours || ''} onChange={actions.onField_hours} placeholder="เวลาทำการ" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            <input value={f.phone || ''} onChange={actions.onField_phone} placeholder="เบอร์โทร" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
          </div>
          <textarea value={f.desc || ''} onChange={actions.onField_desc} placeholder="คำอธิบาย" style={{ width: '100%', minHeight: 60, border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }}></textarea>
          <input value={f.amenities || ''} onChange={actions.onField_amenities} placeholder="สิ่งอำนวยความสะดวก (คั่นด้วยจุลภาค)" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          <input value={f.tags || ''} onChange={actions.onField_tags} placeholder="แท็กความสนใจ (คั่นด้วยจุลภาค เช่น ธรรมชาติ,ครอบครัว)" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}><input type="checkbox" checked={!!f.hasQR} onChange={actions.onField_hasQR} /> เปิดใช้ QR รับพอยท์</label>
            <input value={f.qrPoints || ''} onChange={actions.onField_qrPoints} placeholder="จำนวนพอยท์" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 7, fontSize: 13.5, width: 130 }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={actions.saveForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึกข้อมูล</button>
            <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
        </div>
      )}

      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาสถานที่..." style={{ width: '100%', maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5, marginBottom: 16, display: 'block' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
        {filteredPlacesView.map((p) => (
          <div key={p.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, overflow: 'hidden' }}>
            <ImageSlot src={p.img} shape="rect" style={{ width: '100%', height: 110 }} placeholder="ภาพสถานที่" />
            <div style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{p.name}</div>
              <div style={{ fontSize: 12.5, color: '#6d7a72', marginBottom: 10 }}>{p.category} · ★ {p.rating}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={p.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
                <button onClick={p.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
