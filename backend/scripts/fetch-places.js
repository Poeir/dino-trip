// Fetches Khon Kaen place data fresh from Google Places API (New) and writes
// backend/data/places.json for `npm run import:places` to consume.
//
// Discovery is a hybrid of two approaches, then a shared Place Details pass:
//   1. Nearby Search grid (dense, small radius) around the city center, for
//      restaurants/cafes/lodging -- these are assumed city-only.
//   2. Text Search per outlying district name, for tourist attractions --
//      these are sparse but spread across the whole province, so a city-grid
//      approach would either miss them or need a much larger/costlier grid.
//   3. Place Details with the full field mask (only once per unique ID,
//      deduped across both discovery methods) -> the raw shape
//      import-places.js's toRow() expects.
//
// Adjust CENTER/GRID/RADIUS_M/CATEGORY_GROUPS/OUTLYING_DISTRICTS below to
// change coverage and cost.
//
// Run in two smaller lots instead of one big billing hit: `LOT=attractions`
// (temples, parks/museums, lodging, outlying-district tourist spots) then
// `LOT=food` (restaurants, cafes, markets). Each lot writes its own
// places.json -- run `npm run import:places` after each before starting the
// next lot, since the next fetch overwrites the file.
//
// Usage: cd backend && LOT=attractions npm run fetch:places

import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PHOTOS_DIR = join(__dirname, '..', 'data', 'photos')

const API_KEY = process.env.GOOGLE_PLACES_API_KEY
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_API_KEY. Copy backend/.env.example to backend/.env and fill it in.')
  process.exit(1)
}

// Smoke-test switch: true = ~1 grid point x 1 category x 1 district (~20-40
// places, a few baht) so you can validate fetch -> import -> embed end to end
// before paying for full coverage. Flip to false for the real run.
const TEST_MODE = false

// 'attractions' | 'food' | 'all' -- which CATEGORY_GROUPS (below) to search
// this run. Splits the real run's cost across two smaller, separately
// reviewable batches instead of one ~800-place / ~4,000-photo run.
const LOT = process.env.LOT || 'all'

// Khon Kaen city center. 1 degree latitude ~= 111km; longitude degrees are
// scaled by cos(latitude) so the grid stays roughly square in real distance.
const CENTER = { lat: 16.4419, lng: 102.8360 }
const GRID_SIZE = TEST_MODE ? 1 : 3 // 3x3 = 9 search points, same coverage shape as the old dataset
const SPACING_KM = 5
const RADIUS_M = 4000 // per-point search radius; overlaps neighboring points so nothing falls in the gaps

// Google Places "Table A" type values. Grouped so each group shares a
// Nearby Search call (max ~20 results per call, so keep groups small enough
// that one type doesn't crowd out the others). Each group is tagged with the
// LOT it belongs to.
const CATEGORY_GROUPS = [
  { lot: 'attractions', types: ['buddhist_temple', 'hindu_temple', 'mosque', 'church', 'shinto_shrine', 'synagogue'] },
  { lot: 'attractions', types: ['tourist_attraction', 'museum', 'park'] },
  { lot: 'attractions', types: ['lodging'] },
  { lot: 'food', types: ['restaurant'] },
  { lot: 'food', types: ['cafe', 'bakery'] },
  { lot: 'food', types: ['market', 'shopping_mall'] },
]

const CATEGORIES = TEST_MODE
  ? [['restaurant']]
  : CATEGORY_GROUPS.filter((g) => LOT === 'all' || g.lot === LOT).map((g) => g.types)

// Starting list of districts outside Muang Khon Kaen known for tourism
// (dinosaur park, dam/reservoir, mountains/waterfalls). Review and adjust --
// this is a seed list, not an exhaustive survey of the province's 26 districts.
// Only searched for the 'attractions' lot (it only ever looks for
// tourist_attraction places -- see searchTextIds below).
const OUTLYING_DISTRICTS = TEST_MODE
  ? ['ภูเวียง']
  : (LOT === 'all' || LOT === 'attractions')
    ? ['ภูเวียง', 'อุบลรัตน์', 'ภูผาม่าน', 'ชุมแพ', 'น้ำพอง', 'หนองเรือ']
    : []

// All 'Atmosphere'-tier fields below (servesBreakfast..dineIn, generativeSummary,
// reviewSummary) are billed at the same Enterprise+Atmosphere SKU we're already
// paying for because of `reviews`/`editorialSummary` -- adding them doesn't
// raise the per-request cost, so grab everything that tier offers.
const DETAILS_FIELD_MASK = [
  'id', 'displayName', 'primaryType', 'types', 'rating', 'userRatingCount',
  'priceLevel', 'priceRange', 'formattedAddress', 'addressComponents',
  'regularOpeningHours', 'internationalPhoneNumber', 'websiteUri',
  'googleMapsUri', 'location',
  'editorialSummary', 'generativeSummary', 'reviewSummary', 'reviews',
  'businessStatus', 'goodForChildren', 'parkingOptions', 'accessibilityOptions',
  'restroom', 'outdoorSeating', 'allowsDogs', 'delivery', 'takeout', 'dineIn',
  'curbsidePickup', 'reservable', 'paymentOptions', 'servesVegetarianFood',
  'servesBreakfast', 'servesLunch', 'servesDinner', 'servesBrunch',
  'servesCoffee', 'servesBeer', 'servesWine', 'servesCocktails', 'servesDessert',
  'menuForChildren', 'liveMusic', 'goodForGroups', 'goodForWatchingSports',
  'photos',
].join(',')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildGrid() {
  const points = []
  const half = Math.floor(GRID_SIZE / 2)
  const latStepDeg = SPACING_KM / 111
  const lngStepDeg = SPACING_KM / (111 * Math.cos((CENTER.lat * Math.PI) / 180))
  for (let row = -half; row <= half; row++) {
    for (let col = -half; col <= half; col++) {
      points.push({ lat: CENTER.lat + row * latStepDeg, lng: CENTER.lng + col * lngStepDeg })
    }
  }
  return points
}

async function searchNearbyIds(point, includedTypes) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id',
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: point.lat, longitude: point.lng }, radius: RADIUS_M },
      },
      languageCode: 'th',
      regionCode: 'TH',
    }),
  })
  if (!res.ok) {
    console.error(`  searchNearby failed (${res.status}) for ${includedTypes.join(',')} @ ${point.lat},${point.lng}:`, await res.text())
    return []
  }
  const data = await res.json()
  return (data.places || []).map((p) => p.id)
}

async function searchTextIds(textQuery) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id',
    },
    body: JSON.stringify({
      textQuery,
      includedType: 'tourist_attraction',
      maxResultCount: 20,
      languageCode: 'th',
      regionCode: 'TH',
    }),
  })
  if (!res.ok) {
    console.error(`  searchText failed (${res.status}) for "${textQuery}":`, await res.text())
    return []
  }
  const data = await res.json()
  return (data.places || []).map((p) => p.id)
}

async function fetchDetails(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=th&regionCode=TH`, {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK,
    },
  })
  if (!res.ok) {
    console.error(`  Place Details failed (${res.status}) for ${placeId}:`, await res.text())
    return null
  }
  return res.json()
}

// Up to this many photos per place, for a gallery instead of one hero image.
// Each is a separate billed Photo Media request (first 1,000/month free,
// $7/1,000 after) -- keep this modest so a full-scope run doesn't multiply
// the Place Details cost several times over.
const MAX_PHOTOS_PER_PLACE = 5

// Photo `name` values expire and can't be cached, so we resolve + download
// the actual image bytes to disk in the same run we fetched Details --
// import-places.js then uploads these to our own Supabase Storage bucket so
// the site never depends on Google's (temporary, API-key-bearing) photo URL.
async function downloadPhotos(photos, placeId) {
  const dir = join(PHOTOS_DIR, placeId)
  let saved = 0
  for (const photo of (photos || []).slice(0, MAX_PHOTOS_PER_PLACE)) {
    const url = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1200&key=${API_KEY}`
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`  Photo download failed (${res.status}) for ${placeId}`)
      continue
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${saved}.jpg`), Buffer.from(await res.arrayBuffer()))
    saved++
    await sleep(150)
  }
  return saved
}

async function main() {
  const points = buildGrid()
  console.log(`Discovering places across ${points.length} grid points x ${CATEGORIES.length} category groups...`)

  const ids = new Set()
  for (const point of points) {
    for (const includedTypes of CATEGORIES) {
      const found = await searchNearbyIds(point, includedTypes)
      found.forEach((id) => ids.add(id))
      await sleep(150)
    }
  }
  console.log(`  ${ids.size} unique places from the city grid so far.`)

  console.log(`Searching ${OUTLYING_DISTRICTS.length} outlying districts for tourist attractions...`)
  for (const district of OUTLYING_DISTRICTS) {
    const found = await searchTextIds(`สถานที่ท่องเที่ยว อำเภอ${district} จังหวัดขอนแก่น`)
    found.forEach((id) => ids.add(id))
    await sleep(150)
  }
  console.log(`Found ${ids.size} unique places total. Fetching details...`)

  const places = []
  let done = 0
  for (const id of ids) {
    const details = await fetchDetails(id)
    if (details) {
      places.push(details)
      await downloadPhotos(details.photos, id)
    }
    done++
    if (done % 20 === 0) console.log(`  ${done}/${ids.size}...`)
    await sleep(150)
  }

  const outPath = join(__dirname, '..', 'data', 'places.json')
  writeFileSync(outPath, JSON.stringify(places, null, 2))
  console.log(`Done. Wrote ${places.length} places to ${outPath}`)
  console.log('Next: cd backend && npm run import:places')
}

main()
