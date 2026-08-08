import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'

export default function EventsTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('name-asc')
  const sorters = {
    'name-asc': (a, b) => a.name.localeCompare(b.name, 'th'),
    'name-desc': (a, b) => b.name.localeCompare(a.name, 'th'),
    'status': (a, b) => a.status.localeCompare(b.status),
  }
  const filteredEventsView = derived.eventsAdminView
    .filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(sorters[sortBy])
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>จัดการอีเวนท์</h1>
        <button onClick={actions.onNewEvent} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ สร้าง Event</button>
      </div>

      <Modal open={derived.isEventFormOpen} onClose={actions.cancelForm} title={state.editingId ? 'แก้ไขอีเวนท์' : 'สร้างอีเวนท์ใหม่'} maxWidth={700}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 14 }}>
            <Field label="ชื่องาน">
              <input value={f.name || ''} onChange={actions.onField_name} placeholder="เช่น เทศกาลไดโนเสาร์" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            </Field>
            <Field label="ประเภทงาน">
              <input value={f.category || ''} onChange={actions.onField_category} placeholder="เช่น เทศกาล, งานวัด" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            </Field>
          </div>
          <Field label="ช่วงวันจัดงาน">
            <input value={f.dateRange || ''} onChange={actions.onField_dateRange} placeholder="เช่น 1-3 ธ.ค. 2569" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          </Field>
          <Field label="สถานที่จัดงาน">
            <input value={f.venueName || ''} onChange={actions.onField_venueName} placeholder="ชื่อสถานที่/สนาม" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          </Field>
          <Field label="ลิงก์รูปภาพ (URL)">
            <input value={f.img || ''} onChange={actions.onField_img} placeholder="https://..." style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 14 }}>
            <Field label="ค่าเข้างาน">
              <input value={f.admission || ''} onChange={actions.onField_admission} placeholder="เช่น ฟรี, 50 บาท" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            </Field>
            <Field label="ผู้จัดงาน">
              <input value={f.organizer || ''} onChange={actions.onField_organizer} placeholder="หน่วยงาน/ผู้จัด" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            </Field>
          </div>
          <Field label="กลุ่มที่เหมาะสม (คั่นด้วยจุลภาค)">
            <input value={f.suitableFor || ''} onChange={actions.onField_suitableFor} placeholder="เช่น ครอบครัว, วัยรุ่น" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          </Field>
          <Field label="รายละเอียดงาน">
            <textarea value={f.desc || ''} onChange={actions.onField_desc} placeholder="รายละเอียดงาน" style={{ width: '100%', minHeight: 60, border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }}></textarea>
          </Field>
          <Field label="สถานะ">
            <select value={f.status || 'upcoming'} onChange={actions.onField_status} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 18 }}>
              <option value="upcoming">upcoming</option>
              <option value="published">published</option>
              <option value="cancelled">cancelled</option>
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={actions.saveForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึก</button>
            <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
      </Modal>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาอีเวนท์..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
          <option value="name-asc">ชื่อ (ก-ฮ)</option>
          <option value="name-desc">ชื่อ (ฮ-ก)</option>
          <option value="status">สถานะ</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
        {filteredEventsView.map((e) => (
          <div key={e.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, overflow: 'hidden' }}>
            <ImageSlot src={e.img} shape="rect" style={{ width: '100%', height: 110 }} placeholder="ภาพงาน" />
            <div style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{e.name}</div>
              <div style={{ fontSize: 12.5, color: '#6d7a72', marginBottom: 10 }}>{e.dateRange} · {e.status}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={e.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
                <button onClick={e.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
