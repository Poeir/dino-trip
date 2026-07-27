import { crudRouter } from '../lib/crudRouter.js'
import { rowToEvent, eventPayload } from '../lib/mappers.js'

const EVENT_COLUMNS = 'id, name, category, date_range, venue_name, admission, organizer, suitable_for, description, status, img'

export const eventsRouter = crudRouter({
  table: 'events',
  select: EVENT_COLUMNS,
  order: { column: 'created_at' },
  toRow: eventPayload,
  toResponse: rowToEvent,
})
