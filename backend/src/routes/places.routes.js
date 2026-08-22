import { crudRouter } from '../lib/crudRouter.js'
import { rowToPlace, placePayload } from '../lib/mappers.js'
import { sortPlacesByWeightedRating } from '../services/placeRanking.js'

// Excludes `embedding` (384-float pgvector column, RAG-only) and
// `hours_periods`/`price_level` -- the frontend doesn't read them.
const PLACE_COLUMNS = 'id, source, google_place_id, name, category, rating, review_count, price, address, district, hours, phone, website, maps_url, lat, lng, description, amenities, tags, has_qr, qr_points, img, images, reviews, business_status, created_at, updated_at'

export const placesRouter = crudRouter({
  table: 'places',
  select: PLACE_COLUMNS,
  sortRows: sortPlacesByWeightedRating,
  toRow: placePayload,
  toResponse: rowToPlace,
})
