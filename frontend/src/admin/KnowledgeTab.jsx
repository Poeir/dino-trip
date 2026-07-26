import { useApp } from '../context/AppContext.jsx'

export default function KnowledgeTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>ฐานความรู้แชทบอท</h1>
        <button onClick={actions.onNewKb} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ เพิ่มฐานความรู้</button>
      </div>

      {derived.isKbFormOpen && (
        <div data-role="admin-form-panel" style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 22, marginBottom: 20 }}>
          <input value={f.title || ''} onChange={actions.onField_title} placeholder="หัวข้อ" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          <select value={f.category || 'transport'} onChange={actions.onField_category} style={{ border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }}>
            <option value="transport">transport</option>
            <option value="food-culture">food-culture</option>
            <option value="dino">dino</option>
          </select>
          <textarea value={f.content || ''} onChange={actions.onField_content} placeholder="เนื้อหา" style={{ width: '100%', minHeight: 80, border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }}></textarea>
          <div style={{ display: 'flex', gap: 20, marginBottom: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}><input type="checkbox" checked={!!f.isPinned} onChange={actions.onField_isPinned} /> ปักหมุด (Pinned)</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}><input type="checkbox" checked={!!f.isActive} onChange={actions.onField_isActive} /> ใช้งาน (Active)</label>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={actions.saveForm} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึก</button>
            <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 16 }}>
        {derived.kbView.map((k) => (
          <div key={k.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#E8F5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <span style={{ width: 18, height: 14, background: '#2E7D32', borderRadius: '5px 5px 5px 0', position: 'relative' }}>
                <span style={{ position: 'absolute', left: 2, bottom: -5, width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid #2E7D32', borderTop: '5px solid #2E7D32' }}></span>
              </span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{k.title}</div>
            <div style={{ fontSize: 12.5, color: '#6d7a72', marginBottom: 12 }}>{k.category} · {k.statusLabel}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={k.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
              <button onClick={k.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
