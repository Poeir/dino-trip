import { crudRouter } from '../lib/crudRouter.js'
import { rowToKb, kbPayload } from '../lib/mappers.js'

const KB_COLUMNS = 'id, title, category, content, is_pinned, is_active'

export const knowledgeBaseRouter = crudRouter({
  table: 'knowledge_base',
  select: KB_COLUMNS,
  order: { column: 'created_at' },
  toRow: kbPayload,
  toResponse: rowToKb,
})
