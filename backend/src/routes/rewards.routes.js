import { crudRouter } from '../lib/crudRouter.js'
import { rewardPayload } from '../lib/mappers.js'

// Rewards columns (id, name, cost) are already the shape the frontend
// expects -- no row mapper needed, matches the old saveForm() behavior
// which used the raw Supabase response for this table.
export const rewardsRouter = crudRouter({
  table: 'rewards',
  select: 'id, name, cost',
  order: { column: 'cost' },
  toRow: rewardPayload,
})
