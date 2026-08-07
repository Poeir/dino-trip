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
// Adjust CENTER/GRID/RADIUS_M/CATEGORIES/OUTLYING_DISTRICTS below to change
// coverage and cost.
//
// Usage: cd backend && npm run fetch:places

import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const API_KEY = process.env.GOOGLE_PLACES_API_KEY
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_API_KEY. Copy backend/.env.example to backend/.env and fill it in.')
  process.exit(1)
}

// Smoke-test switch: true = ~1 grid point x 1 category x 1 district (~20-40
// places, a few baht) so you can validate fetch -> import -> embed end to end
// before paying for full coverage. Flip to false for the real run.
const TEST_MODE = true

// Khon Kaen city center. 1 degree latitude ~= 111km; longitude degrees are
// scaled by cos(latitude) so the grid stays roughly square in real distance.
const CENTER = { lat: 16.4419, lng: 102.8360 }
const GRID_SIZE = TEST_MODE ? 1 : 3 // 3x3 = 9 search points, same coverage shape as the old dataset
const SPACING_KM = 5
const RADIUS_M = 4000 // per-point search radius; overlaps neighboring points so nothing falls in the gaps

// Google Places "Table A" type values. Grouped so each group shares a
// Nearby Search call (max ~20 results per call, so keep groups small enough
// that one type doesn't crowd out the others).
const CATEGORIES = TEST_MODE
  ? [['restaurant']]
  : [
      ['restaurant'],
      ['cafe', 'bakery'],
      ['tourist_attraction', 'museum', 'park'],
      ['place_of_worship'],
      ['lodging'],
    ]

// Starting list of districts outside Muang Khon Kaen known for tourism
// (dinosaur park, dam/reservoir, mountains/waterfalls). Review and adjust --
// this is a seed list, not an exhaustive survey of the province's 26 districts.
const OUTLYING_DISTRICTS = TEST_MODE
  ? ['ภูเวียง']
  : ['ภูเวียง', 'อุบลรัตน์', 'ภูผาม่าน', 'ชุมแพ', 'น้ำพอง', 'หนองเรือ']

const DETAILS_FIELD_MASK = [
  'id', 'displayName', 'primaryType', 'types', 'rating', 'userRatingCount',
  'priceLevel', 'priceRange', 'formattedAddress', 'regularOpeningHours',
  'internationalPhoneNumber', 'websiteUri', 'googleMapsUri', 'location',
  'editorialSummary', 'reviews', 'businessStatus', 'goodForChildren',
  'parkingOptions', 'accessibilityOptions', 'restroom', 'outdoorSeating',
  'allowsDogs', 'delivery', 'takeout', 'reservable', 'paymentOptions',
  'servesVegetarianFood',
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
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
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
    if (details) places.push(details)
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
