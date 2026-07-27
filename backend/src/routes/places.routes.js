import { crudRouter } from '../lib/crudRouter.js'
import { rowToPlace, placePayload } from '../lib/mappers.js'

// Excludes `embedding` (384-float pgvector column, RAG-only) and
// `hours_periods`/`price_level` -- the frontend doesn't read them.
const PLACE_COLUMNS = 'id, source, google_place_id, name, category, rating, review_count, price, address, hours, phone, website, maps_url, lat, lng, description, amenities, tags, has_qr, qr_points, img, reviews, business_status'

export const placesRouter = crudRouter({
  table: 'places',
  select: PLACE_COLUMNS,
  order: { column: 'name' },
  toRow: placePayload,
  toResponse: rowToPlace,
})
