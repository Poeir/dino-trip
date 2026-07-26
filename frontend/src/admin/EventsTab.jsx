import { useApp } from '../context/AppContext.jsx'
import ImageSlot from '../components/ImageSlot.jsx'

export default function EventsTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>จัดการอีเวนท์</h1>
        <button onClick={actions.onNewEvent} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ สร้าง Event</button>
      </div>

      {derived.isEventFormOpen && (
        <div data-role="admin-form-panel" style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 22, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <input value={f.name || ''} onChange={actions.onField_name} placeholder="ชื่องาน" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            <input value={f.category || ''} onChange={actions.onField_category} placeholder="ประเภทงาน" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
          </div>
          <input value={f.dateRange || ''} onChange={actions.onField_dateRange} placeholder="ช่วงวันจัดงาน" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          <input value={f.venueName || ''} onChange={actions.onField_venueName} placeholder="สถานที่จัดงาน" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <input value={f.admission || ''} onChange={actions.onField_admission} placeholder="ค่าเข้างาน" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
            <input value={f.organizer || ''} onChange={actions.onField_organizer} placeholder="ผู้จัดงาน" style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14 }} />
          </div>
          <input value={f.suitableFor || ''} onChange={actions.onField_suitableFor} placeholder="กลุ่มที่เหมาะสม (คั่นด้วยจุลภาค)" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          <textarea value={f.desc || ''} onChange={actions.onField_desc} placeholder="รายละเอียดงาน" style={{ width: '100%', minHeight: 60, border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }}></textarea>
          <select value={f.status || 'upcoming'} onChange={actions.onField_status} style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 18 }}>
            <option value="upcoming">upcoming</option>
            <option value="published">published</option>
            <option value="cancelled">cancelled</option>
          </select>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={actions.saveForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึก</button>
            <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
        {derived.eventsAdminView.map((e) => (
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
