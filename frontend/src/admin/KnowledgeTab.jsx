import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import PageControls from '../components/PageControls.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import LoadError from '../components/LoadError.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { fetchKnowledgeBase } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'

// KnowledgeTab's own sort dropdown -> crudRouter.js's ?sort=/?dir=.
const KB_SORT_PARAMS = {
  'title-asc': { sort: 'title', dir: 'asc' },
  'title-desc': { sort: 'title', dir: 'desc' },
  category: { sort: 'category', dir: 'asc' },
}

export default function KnowledgeTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [sortBy, setSortBy] = useState('title-asc')
  const paged = usePagedList(fetchKnowledgeBase, { pageSize: 20, extraParams: KB_SORT_PARAMS[sortBy] })

  const handleSave = async () => {
    await actions.saveForm()
    paged.refetch()
  }

  const kbView = paged.rows.map((k) => ({
    ...k,
    statusLabel: (k.isPinned ? '📌 Pinned · ' : '') + (k.isActive ? 'Active' : 'Inactive'),
    onEdit: () => actions.openEditForm('kb', k),
    onDelete: async () => { await actions.deleteItem('kb', k.id); paged.refetch() },
  }))
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1B5E20', margin: 0 }}>ฐานความรู้แชทบอท</h1>
        <button onClick={actions.onNewKb} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 18, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ เพิ่มฐานความรู้</button>
      </div>

      <Modal open={derived.isKbFormOpen} onClose={actions.cancelForm} title={state.editingId ? 'แก้ไขฐานความรู้' : 'เพิ่มฐานความรู้ใหม่'}>
          <Field label="หัวข้อ">
            <input value={f.title || ''} onChange={actions.onField_title} placeholder="เช่น วิธีเดินทางมาขอนแก่น" style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }} />
          </Field>
          <Field label="หมวดหมู่">
            <select value={f.category || 'transport'} onChange={actions.onField_category} style={{ width: '100%', border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }}>
              <option value="transport">transport</option>
              <option value="food-culture">food-culture</option>
              <option value="dino">dino</option>
            </select>
          </Field>
          <Field label="เนื้อหา">
            <textarea value={f.content || ''} onChange={actions.onField_content} placeholder="เนื้อหาที่แชทบอทจะใช้ตอบคำถาม" style={{ width: '100%', minHeight: 80, border: '1px solid #DCD8C6', borderRadius: 8, padding: 9, fontSize: 14, marginBottom: 14 }}></textarea>
          </Field>
          <div style={{ display: 'flex', gap: 20, marginBottom: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}><input type="checkbox" checked={!!f.isPinned} onChange={actions.onField_isPinned} /> ปักหมุด (Pinned)</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}><input type="checkbox" checked={!!f.isActive} onChange={actions.onField_isActive} /> ใช้งาน (Active)</label>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleSave} style={{ background: 'linear-gradient(135deg,#66BB6A,#388E3C)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>บันทึก</button>
            <button onClick={actions.cancelForm} style={{ background: '#fff', border: '1px solid #DCD8C6', padding: '10px 20px', borderRadius: 16, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
      </Modal>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input value={paged.query} onChange={(e) => paged.setQuery(e.target.value)} placeholder="ค้นหาฐานความรู้..." style={{ flex: 1, minWidth: 220, maxWidth: 360, border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 16px', fontSize: 13.5 }} />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ border: '1px solid #DCD8C6', borderRadius: 20, padding: '9px 14px', fontSize: 13.5 }}>
          <option value="title-asc">หัวข้อ (ก-ฮ)</option>
          <option value="title-desc">หัวข้อ (ฮ-ก)</option>
          <option value="category">หมวดหมู่</option>
        </select>
        <span style={{ fontSize: 12.5, color: '#626863' }}>{paged.loading ? 'กำลังโหลด...' : `พบ ${paged.total} รายการ`}</span>
      </div>
      {paged.loading && kbView.length === 0 && <LoadingSpinner size={32} label="กำลังโหลดฐานความรู้..." />}
      {paged.error && <LoadError message="โหลดรายการฐานความรู้ไม่สำเร็จ" onRetry={paged.refetch} />}
      {!paged.loading && !paged.error && kbView.length === 0 && (
        <EmptyState title="ไม่พบฐานความรู้ที่ตรงกับเงื่อนไข" />
      )}
      <div style={{ display: paged.error ? 'none' : 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 16, opacity: paged.loading ? 0.5 : 1, transition: 'opacity 0.15s ease', pointerEvents: paged.loading ? 'none' : 'auto' }}>
        {kbView.map((k) => (
          <div key={k.id} style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 14, padding: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#E8F5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <span style={{ width: 18, height: 14, background: '#2E7D32', borderRadius: '5px 5px 5px 0', position: 'relative' }}>
                <span style={{ position: 'absolute', left: 2, bottom: -5, width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid #2E7D32', borderTop: '5px solid #2E7D32' }}></span>
              </span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{k.title}</div>
            <div style={{ fontSize: 12.5, color: '#5f6a63', marginBottom: 4 }}>{k.category} · {k.statusLabel}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: k.isEmbedded ? '#2E7D32' : '#b07a1e', marginBottom: 12 }}>
              {k.isEmbedded ? 'อยู่ในดัชนีค้นหาแชทบอทแล้ว' : 'ยังไม่ได้ทำดัชนีค้นหา'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={k.onEdit} style={{ flex: 1, background: '#E8F5E9', color: '#2E7D32', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>แก้ไข</button>
              <button onClick={k.onDelete} style={{ flex: 1, background: '#fdecec', color: '#a33232', border: 'none', padding: 7, borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
            </div>
          </div>
        ))}
      </div>
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
    </>
  )
}
