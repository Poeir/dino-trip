import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'

export default function PlacesTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('name-asc')
  const sorters = {
    'name-asc': (a, b) => a.name.localeCompare(b.name, 'th'),
    'name-desc': (a, b) => b.name.localeCompare(a.name, 'th'),
    'rating-desc': (a, b) => (b.rating || 0) - (a.rating || 0),
    'rating-asc': (a, b) => (a.rating || 0) - (b.rating || 0),
  }
  const filteredPlacesView = derived.placesView
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(sorters[sortBy])
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>จัดการสถานที่</h1>
        <button onClick={actions.onNewPlace} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ เพิ่มสถานที่ใหม่</button>
      </div>

      <Modal open={derived.isPlaceFormOpen} onClose={actions.cancelForm} title={state.editingId ? 'แก้ไขสถานที่' : 'เพิ่มสถานที่ใหม่'} maxWidth={760}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 14 }}>
            <Field label="ชื่อสถานที่">
              <input value={f.name || ''} onChange={actions.onField_name} placeholder="เช่น คาเฟ่ริมบึง" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            </Field>
            <Field label="หมวดหมู่">
              <select value={f.category || ''} onChange={actions.onField_category} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }}>
                {derived.placeCategoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 14 }}>
            <Field label="คะแนน">
              <input value={f.rating || ''} onChange={actions.onField_rating} placeholder="เช่น 4.5" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            </Field>
            <Field label="ช่วงราคา">
              <input value={f.price || ''} onChange={actions.onField_price} placeholder="เช่น 100-300 บาท" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            </Field>
          </div>
          <Field label="ที่อยู่">
            <input value={f.address || ''} onChange={actions.onField_address} placeholder="ที่อยู่เต็ม" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          </Field>
          <Field label="ลิงก์รูปภาพ (URL)">
            <input value={f.img || ''} onChange={actions.onField_img} placeholder="https://..." style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 8 }} />
          </Field>
          <div style={{ marginBottom: 6 }}>
            <ImageSlot src={f.img} shape="rect" style={{ width: 160, height: 90 }} placeholder="ตัวอย่างรูป" />
          </div>
          <div style={{ fontSize: 11.5, color: '#a33232', marginBottom: 14 }}>หมายเหตุ: ระบบยังไม่รองรับการบันทึกรูปสถานที่ผ่านฟอร์มนี้จริง (ต้องรอปรับปรุงฝั่ง backend)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 14 }}>
            <Field label="เวลาทำการ">
              <input value={f.hours || ''} onChange={actions.onField_hours} placeholder="เช่น 08:00-18:00" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            </Field>
            <Field label="เบอร์โทร">
              <input value={f.phone || ''} onChange={actions.onField_phone} placeholder="เบอร์ติดต่อ" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            </Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, marginBottom: 4 }}>
            <input type="checkbox" checked={f.isActive !== false} onChange={actions.onField_isActive} /> เผยแพร่บนหน้าเว็บ
          </label>
          <div style={{ fontSize: 11.5, color: '#8a938c', marginBottom: 14 }}>หมายเหตุ: การซ่อน/เผยแพร่มีผลเฉพาะช่วงที่เปิดหน้านี้อยู่เท่านั้น จะรีเซ็ตเมื่อโหลดหน้าใหม่ (ยังไม่บันทึกลง backend)</div>
          <Field label="คำอธิบาย">
            <textarea value={f.desc || ''} onChange={actions.onField_desc} placeholder="รายละเอียดสถานที่" style={{ width: '100%', minHeight: 60, border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }}></textarea>
          </Field>
          <Field label="สิ่งอำนวยความสะดวก (คั่นด้วยจุลภาค)">
            <input value={f.amenities || ''} onChange={actions.onField_amenities} placeholder="เช่น ที่จอดรถ, wifi, ห้องน้ำ" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          </Field>
          <Field label="แท็กความสนใจ (คั่นด้วยจุลภาค)">
            <input value={f.tags || ''} onChange={actions.onField_tags} placeholder="เช่น ธรรมชาติ, ครอบครัว" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          </Field>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, marginBottom: 18, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}><input type="checkbox" checked={!!f.hasQR} onChange={actions.onField_hasQR} /> เปิดใช้ QR รับพอยท์</label>
            <Field label="จำนวนพอยท์">
              <input value={f.qrPoints || ''} onChange={actions.onField_qrPoints} placeholder="เช่น 10" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 7, fontSize: 13.5, width: 130 }} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={actions.saveForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึกข้อมูล</button>
            <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
      </Modal>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาสถานที่..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
          <option value="name-asc">ชื่อ (ก-ฮ)</option>
          <option value="name-desc">ชื่อ (ฮ-ก)</option>
          <option value="rating-desc">คะแนนสูง-ต่ำ</option>
          <option value="rating-asc">คะแนนต่ำ-สูง</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
        {filteredPlacesView.map((p) => (
          <div key={p.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, overflow: 'hidden', opacity: p.isActive ? 1 : 0.55 }}>
            <div style={{ position: 'relative' }}>
              <ImageSlot src={p.img} shape="rect" style={{ width: '100%', height: 110 }} placeholder="ภาพสถานที่" />
              {!p.isActive && (
                <span style={{ position: 'absolute', top: 8, left: 8, background: '#3c463f', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8 }}>ซ่อนอยู่</span>
              )}
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{p.name}</div>
              <div style={{ fontSize: 12.5, color: '#6d7a72', marginBottom: 10 }}>{p.category} · ★ {p.rating}</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button onClick={p.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
                <button onClick={p.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
              </div>
              <button onClick={p.onToggleActive} style={{ width: '100%', background: p.isActive ? '#fff' : '#FFF8E1', color: p.isActive ? '#6d7a72' : '#7A5205', border: '1px solid #DCD8C6', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                {p.isActive ? 'ซ่อนจากหน้าเว็บ' : 'เผยแพร่อีกครั้ง'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
