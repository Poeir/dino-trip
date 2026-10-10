import { useState } from 'react'
import { MessageSquareText, Pin, Plus } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import Modal from '../components/Modal.jsx'
import Field from '../components/Field.jsx'
import PageControls from '../components/PageControls.jsx'
import { fetchKnowledgeBase } from '../lib/apiClient.js'
import { usePagedList } from '../lib/usePagedList.js'
import { useDirtyGuard } from './hooks/useDirtyGuard.js'
import AdminPageHeader from './ui/AdminPageHeader.jsx'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import EntityCard from './ui/EntityCard.jsx'
import { FormActions } from './ui/FormSection.jsx'
import ListState from './ui/ListState.jsx'
import Toolbar from './ui/Toolbar.jsx'

// KnowledgeTab's own sort dropdown -> crudRouter.js's ?sort=/?dir=.
const KB_SORT_PARAMS = {
  'title-asc': { sort: 'title', dir: 'asc' },
  'title-desc': { sort: 'title', dir: 'desc' },
  category: { sort: 'category', dir: 'asc' },
}
const SORT_OPTIONS = [
  { value: 'title-asc', label: 'หัวข้อ (ก-ฮ)' },
  { value: 'title-desc', label: 'หัวข้อ (ฮ-ก)' },
  { value: 'category', label: 'หมวดหมู่' },
]
// Stored slugs (sent to the API / used by the chatbot) -> Thai labels for the UI.
const KB_CATEGORIES = [
  { value: 'transport', label: 'การเดินทาง' },
  { value: 'food-culture', label: 'อาหารและวัฒนธรรม' },
  { value: 'dino', label: 'ไดโนเสาร์' },
]
const categoryLabel = (slug) => KB_CATEGORIES.find((c) => c.value === slug)?.label || slug

export default function KnowledgeTab() {
  const { state, actions, derived } = useApp()
  const f = state.formData
  const [sortBy, setSortBy] = useState('title-asc')
  const [saving, setSaving] = useState(false)
  const paged = usePagedList(fetchKnowledgeBase, { pageSize: 20, extraParams: KB_SORT_PARAMS[sortBy] })
  const guard = useDirtyGuard({ open: derived.isKbFormOpen, value: f })
  const handleClose = () => { if (!saving) guard.requestClose(actions.cancelForm) }

  const handleSave = async () => {
    if (saving) return // a second click while the request is in flight would create a duplicate row
    setSaving(true)
    try {
      await actions.saveForm()
      paged.refetch()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (k) => {
    await actions.deleteItem('kb', k.id)
    paged.refetch()
  }

  const kbView = paged.rows
  return (
    <>
      <AdminPageHeader
        title="ฐานความรู้แชทบอท"
        actions={<Button onClick={actions.onNewKb}><Plus size={16} aria-hidden="true" />เพิ่มฐานความรู้</Button>}
      />

      <Modal
        open={derived.isKbFormOpen}
        onClose={handleClose}
        title={state.editingId ? 'แก้ไขฐานความรู้' : 'เพิ่มฐานความรู้ใหม่'}
        size="md"
        footer={<FormActions onSave={handleSave} onCancel={handleClose} saving={saving} />}
      >
        <div className="ad-form-stack">
          <Field label="หัวข้อ">
            <input className="ad-input" value={f.title || ''} onChange={actions.onField_title} placeholder="เช่น วิธีเดินทางมาขอนแก่น" disabled={saving} />
          </Field>
          <Field label="หมวดหมู่">
            <select className="ad-select" value={f.category || 'transport'} onChange={actions.onField_category} disabled={saving}>
              {KB_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="เนื้อหา">
            <textarea className="ad-textarea" value={f.content || ''} onChange={actions.onField_content} placeholder="เนื้อหาที่แชทบอทจะใช้ตอบคำถาม" disabled={saving} />
          </Field>
          <div className="ad-checks">
            <label className="ad-check"><input type="checkbox" checked={!!f.isPinned} onChange={actions.onField_isPinned} disabled={saving} /> ปักหมุด</label>
            <label className="ad-check"><input type="checkbox" checked={!!f.isActive} onChange={actions.onField_isActive} disabled={saving} /> เปิดใช้งาน</label>
          </div>
        </div>
      </Modal>

      <Toolbar
        search={{ value: paged.query, onChange: paged.setQuery, placeholder: 'ค้นหาฐานความรู้...', label: 'ค้นหาฐานความรู้' }}
        sort={{ value: sortBy, onChange: setSortBy, options: SORT_OPTIONS, label: 'เรียงลำดับฐานความรู้' }}
        count={paged.loading ? 'กำลังโหลด...' : `พบ ${paged.total} รายการ`}
      />
      <ListState
        loading={paged.loading && kbView.length === 0}
        error={paged.error ? 'โหลดรายการฐานความรู้ไม่สำเร็จ' : false}
        empty={!paged.loading && !paged.error && kbView.length === 0}
        emptyText="ไม่พบฐานความรู้ที่ตรงกับเงื่อนไข"
        onRetry={paged.refetch}
      />
      <div className={`ad-card-grid ad-fade${paged.loading ? ' is-loading' : ''}`} hidden={!!paged.error}>
        {kbView.map((k) => (
          <EntityCard
            key={k.id}
            tile
            media={<span className="ad-kb-icon" aria-hidden="true"><MessageSquareText size={18} /></span>}
            title={k.title}
            subtitle={categoryLabel(k.category)}
            itemName={k.title}
            deleteLabel="ลบฐานความรู้"
            deleteMessage={`“${k.title}” จะถูกลบถาวรและแชทบอทจะไม่ใช้ข้อมูลนี้ตอบคำถามอีก ถ้าแค่ต้องการหยุดใช้ชั่วคราว ให้แก้ไขแล้วปิด “ใช้งาน” แทน`}
            onEdit={() => actions.openEditForm('kb', k)}
            onDelete={() => handleDelete(k)}
          >
            <div className="ad-actions ad-kb-badges">
              {k.isPinned && <Badge tone="info" icon={<Pin size={11} aria-hidden="true" />}>ปักหมุด</Badge>}
              <Badge tone={k.isActive ? 'success' : 'neutral'}>{k.isActive ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</Badge>
              <Badge tone={k.isEmbedded ? 'success' : 'warning'}>{k.isEmbedded ? 'อยู่ในดัชนีค้นหาแชทบอทแล้ว' : 'ยังไม่ได้ทำดัชนีค้นหา'}</Badge>
            </div>
          </EntityCard>
        ))}
      </div>
      <PageControls page={paged.page} totalPages={paged.totalPages} total={paged.total} onChange={paged.setPage} />
      {guard.dirtyDialog}
    </>
  )
}
