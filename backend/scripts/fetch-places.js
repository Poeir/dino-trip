// Fetches Khon Kaen place data fresh from Google Places API (New) and writes
// backend/data/places.json for `npm run import:places` to consume.
//
// Discovery is Text Search only (no Nearby Search grid), then a shared Place
// Details pass with a quality filter:
//   1. City: one rectangle around Muang Khon Kaen, one Text Search per
//      subtype query (หมูกระทะ, ส้มตำ, วัด, พิพิธภัณฑ์, ...). Text Search pages
//      up to ~60 results per query via pageToken, and `minRating` drops
//      low-rated places before we pay for their Details. Splitting by subtype
//      (instead of Nearby Search's 20-result cap per type group, ranked by
//      popularity) is what gets us beyond the same top-20 cafes every time.
//   2. Outlying districts: one rectangle per district, attraction-subtype
//      queries (น้ำตก, จุดชมวิว, ...) plus a small capped set of popular
//      restaurants. Results whose `administrative_area_level_2` isn't the
//      district we searched are dropped (the rectangles overlap neighbors).
//   3. Place Details (full field mask) once per unique ID, then the quality
//      filter (rating / review count / CLOSED_PERMANENTLY) BEFORE downloading
//      photos, so rejected places never cost Photo Media requests.
//
// Lodging is intentionally not kept -- the trip planner takes the user's
// own accommodation as input -- and neither are transport stops (toll
// booths, bus terminals) that attraction queries tend to sweep in.
//
// Partial re-runs: QUERIES=วัด,ศาลเจ้า limits to queries whose text contains
// one of those; DISTRICTS=อุบลรัตน์ limits to those districts (`เมือง` = the
// city rectangle). APPEND=1 merges into the existing places.json instead of
// overwriting it, and skips Details for places already in it.
//
// Run in two smaller lots instead of one big billing hit: `LOT=attractions`
// then `LOT=food`. Each lot writes its own places.json -- run
// `npm run import:places` after each before starting the next lot, since the
// next fetch overwrites the file.
//
// Quality thresholds are env-overridable:
//   MIN_RATING (default 3.5), MIN_REVIEWS (city, default 20),
//   MIN_REVIEWS_OUTLYING (default 5), MIN_REVIEWS_OUTLYING_TEMPLE (default 20),
//   MIN_REVIEWS_NEW_CITY_FOOD (default 100)
//
// Usage: cd backend && LOT=attractions npm run fetch:places

import 'dotenv/config'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mapCategory } from './place-category.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PHOTOS_DIR = join(__dirname, '..', 'data', 'photos')

const API_KEY = process.env.GOOGLE_PLACES_API_KEY
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_API_KEY. Copy backend/.env.example to backend/.env and fill it in.')
  process.exit(1)
}

// Smoke-test switch: true = 1 city query x 1 page + 1 district query (~20-40
// places, a few baht) so you can validate fetch -> import -> embed end to end
// before paying for full coverage. Flip to false for the real run.
const TEST_MODE = false

// 'attractions' | 'food' | 'all' -- which queries (below) to run this time.
const LOT = process.env.LOT || 'all'

const MIN_RATING = Number(process.env.MIN_RATING ?? 3.5)
const MIN_REVIEWS = Number(process.env.MIN_REVIEWS ?? 20)
const MIN_REVIEWS_OUTLYING = Number(process.env.MIN_REVIEWS_OUTLYING ?? 5)
// Outlying temples get the city's bar, not MIN_REVIEWS_OUTLYING: every
// village has a วัด, and at 5 reviews a "วัด" query let in ~140 ordinary
// village temples (116 of them under 20 reviews).
const MIN_REVIEWS_OUTLYING_TEMPLE = Number(process.env.MIN_REVIEWS_OUTLYING_TEMPLE ?? 20)
// City restaurants/cafes not yet in the DB need far more reviews: at 20, the
// food lot would have added ~330 new ones and left food at ~640 places vs
// ~240 attractions. Places already in the DB still pass at MIN_REVIEWS so
// they keep getting refreshed.
const MIN_REVIEWS_NEW_CITY_FOOD = Number(process.env.MIN_REVIEWS_NEW_CITY_FOOD ?? 100)

// Text Search's locationRestriction only accepts a rectangle (low = SW corner,
// high = NE corner). Bounds were derived from the lat/lng spread of the
// places already in the DB per district, padded a little.
const CITY_BOUNDS = { low: [16.35, 102.73], high: [16.54, 102.94] }

// `includedType` narrows results hard in practice (a market-typed
// "ตลาด ถนนคนเดิน" query returned 1 place), so only set it where the query's
// own wording is ambiguous. It also only accepts Table A types --
// `place_of_worship` is rejected with a 400.
const CITY_QUERIES = [
  // attractions
  { lot: 'attractions', q: 'สถานที่ท่องเที่ยว' },
  { lot: 'attractions', q: 'จุดชมวิว' },
  { lot: 'attractions', q: 'บึง สวนสาธารณะ' },
  { lot: 'attractions', q: 'วัด' },
  { lot: 'attractions', q: 'ศาลเจ้า' },
  { lot: 'attractions', q: 'พิพิธภัณฑ์', type: 'museum' },
  { lot: 'attractions', q: 'ตลาด ถนนคนเดิน' },
  { lot: 'attractions', q: 'ร้านของฝาก ผ้าไหม OTOP' },
  { lot: 'attractions', q: 'ห้างสรรพสินค้า', type: 'shopping_mall' },
  // food -- deliberately more restaurant subtypes than cafe queries; the old
  // grid pulled 146 cafes (a third of the dataset) vs 66 attractions.
  { lot: 'food', q: 'ร้านอาหารอีสาน', type: 'restaurant' },
  { lot: 'food', q: 'หมูกระทะ ปิ้งย่าง', type: 'restaurant' },
  { lot: 'food', q: 'ส้มตำ ไก่ย่าง', type: 'restaurant' },
  { lot: 'food', q: 'ก๋วยเตี๋ยว', type: 'restaurant' },
  { lot: 'food', q: 'อาหารเวียดนาม', type: 'restaurant' },
  { lot: 'food', q: 'อาหารญี่ปุ่น', type: 'restaurant' },
  { lot: 'food', q: 'บุฟเฟต์', type: 'restaurant' },
  { lot: 'food', q: 'ร้านอาหารไทย', type: 'restaurant' },
  { lot: 'food', q: 'อาหารเช้า โจ๊ก ติ่มซำ', type: 'restaurant' },
  { lot: 'food', q: 'คาเฟ่', type: 'cafe' },
  { lot: 'food', q: 'ร้านเบเกอรี่ ของหวาน', type: 'bakery' },
]

// Districts outside Muang known for tourism. `accept` = district names (as
// Google's administrative_area_level_2) a result may carry and still count --
// e.g. the Phu Wiang dinosaur sites sit in เวียงเก่า, split off from ภูเวียง,
// and หินช้างสี is just over the อุบลรัตน์ line in บ้านฝาง.
const OUTLYING_DISTRICTS = [
  { name: 'ภูเวียง', accept: ['ภูเวียง', 'เวียงเก่า'], bounds: { low: [16.58, 102.18], high: [16.85, 102.60] } },
  { name: 'อุบลรัตน์', accept: ['อุบลรัตน์', 'บ้านฝาง'], bounds: { low: [16.65, 102.55], high: [16.85, 102.75] } },
  { name: 'ภูผาม่าน', accept: ['ภูผาม่าน'], bounds: { low: [16.58, 101.78], high: [16.80, 101.98] } },
  { name: 'ชุมแพ', accept: ['ชุมแพ'], bounds: { low: [16.45, 101.90], high: [16.90, 102.25] } },
  { name: 'น้ำพอง', accept: ['น้ำพอง'], bounds: { low: [16.55, 102.78], high: [16.80, 103.00] } },
  { name: 'หนองเรือ', accept: ['หนองเรือ'], bounds: { low: [16.42, 102.45], high: [16.68, 102.65] } },
]

// Queried per district, district name appended. The restaurant query is one
// page only and capped to the top `cap` by review count after filtering --
// enough for a lunch stop near the attractions, without flooding the dataset
// with rural eateries.
const DISTRICT_QUERIES = [
  { lot: 'attractions', q: 'สถานที่ท่องเที่ยว' },
  { lot: 'attractions', q: 'น้ำตก' },
  { lot: 'attractions', q: 'จุดชมวิว' },
  { lot: 'attractions', q: 'อุทยาน', type: 'national_park' },
  { lot: 'attractions', q: 'วัด' },
  { lot: 'attractions', q: 'พิพิธภัณฑ์', type: 'museum' },
  { lot: 'food', q: 'ร้านอาหาร', type: 'restaurant', maxPages: 1, cap: 8 },
]

const csv = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null)
const ONLY_QUERIES = csv(process.env.QUERIES)
const ONLY_DISTRICTS = csv(process.env.DISTRICTS)
const APPEND = !!process.env.APPEND

const inLot = (item) => (LOT === 'all' || item.lot === LOT) && (!ONLY_QUERIES || ONLY_QUERIES.some((q) => item.q.includes(q)))
const runCity = !ONLY_DISTRICTS || ONLY_DISTRICTS.includes('เมือง')

const cityQueries = !runCity ? [] : TEST_MODE ? [CITY_QUERIES.find(inLot)].filter(Boolean) : CITY_QUERIES.filter(inLot)
const districts = TEST_MODE
  ? OUTLYING_DISTRICTS.slice(0, 1)
  : OUTLYING_DISTRICTS.filter((d) => !ONLY_DISTRICTS || ONLY_DISTRICTS.includes(d.name))
const districtQueries = TEST_MODE ? [DISTRICT_QUERIES.find(inLot)].filter(Boolean) : DISTRICT_QUERIES.filter(inLot)
const MAX_PAGES = TEST_MODE ? 1 : 3

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

function toRectangle({ low, high }) {
  return {
    rectangle: {
      low: { latitude: low[0], longitude: low[1] },
      high: { latitude: high[0], longitude: high[1] },
    },
  }
}

// Only `places.id` + `nextPageToken` in the field mask keeps this on the
// cheapest Text Search SKU -- asking for rating/userRatingCount here would
// bump every search call up a tier. minRating is a request parameter, not a
// field, so it filters for free; review count is checked after Details.
async function searchTextIds({ textQuery, includedType, bounds, maxPages }) {
  const ids = []
  let pageToken
  for (let page = 0; page < maxPages; page++) {
    const body = {
      textQuery,
      pageSize: 20,
      minRating: MIN_RATING,
      locationRestriction: toRectangle(bounds),
      languageCode: 'th',
      regionCode: 'TH',
    }
    if (includedType) body.includedType = includedType
    if (pageToken) body.pageToken = pageToken

    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,nextPageToken',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.error(`  searchText failed (${res.status}) for "${textQuery}":`, await res.text())
      break
    }
    const data = await res.json()
    ids.push(...(data.places || []).map((p) => p.id))
    pageToken = data.nextPageToken
    await sleep(150)
    if (!pageToken) break
  }
  return ids
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

// Google's district names in this dataset are inconsistent ("อำเภอชุมแพ",
// "อำเภอ ภูผาม่าน", "อ.เมือง", zero-width spaces...) -- normalize before comparing.
function normalizeDistrict(text) {
  return (text || '').replace(/[\s​]/g, '').replace(/^(อำเภอ|อ\.)/, '')
}

function districtOf(details) {
  const comp = (details.addressComponents || []).find((c) => c.types?.includes('administrative_area_level_2'))
  return normalizeDistrict(comp?.longText)
}

// Primary types that are never a trip stop, however many reviews they have.
const EXCLUDED_PRIMARY_TYPES = new Set(['toll_station', 'rest_stop', 'transportation_service', 'bus_station', 'transit_station', 'gas_station', 'parking'])

// Returns null if the place passes, else a human-readable reject reason.
function rejectReason(details, origin, inDb) {
  if (details.businessStatus === 'CLOSED_PERMANENTLY') return 'ปิดกิจการถาวร'
  if (mapCategory(details, details.displayName?.text || '') === 'ที่พัก') return `ที่พัก (${details.primaryType})`
  if (EXCLUDED_PRIMARY_TYPES.has(details.primaryType)) return `ไม่ใช่จุดท่องเที่ยว (${details.primaryType})`
  if ((details.rating || 0) < MIN_RATING) return `rating ${details.rating ?? '-'} < ${MIN_RATING}`
  const category = mapCategory(details, details.displayName?.text || '')
  const isNewCityFood = origin.zone === 'city' && !inDb.has(details.id) && (category === 'ร้านอาหาร' || category === 'คาเฟ่')
  const minReviews = origin.zone === 'city'
    ? (isNewCityFood ? MIN_REVIEWS_NEW_CITY_FOOD : MIN_REVIEWS)
    : category === 'วัด' ? MIN_REVIEWS_OUTLYING_TEMPLE : MIN_REVIEWS_OUTLYING
  if ((details.userRatingCount || 0) < minReviews) return `รีวิว ${details.userRatingCount || 0} < ${minReviews}`
  if (origin.accept) {
    const district = districtOf(details)
    if (!origin.accept.some((a) => district.includes(a))) return `อยู่อำเภอ "${district || '?'}" ไม่ใช่ ${origin.district}`
  }
  return null
}

// Up to this many photos per place, for a gallery instead of one hero image.
// Each is a separate billed Photo Media request (first 1,000/month free,
// $7/1,000 after) -- keep this modest so a full-scope run doesn't multiply
// the Place Details cost several times over.
const MAX_PHOTOS_PER_PLACE = 5

// Photo `name` values expire and can't be cached, so we resolve + download
// the actual image bytes to disk in the same run we fetched Details --
// import-places.js then uploads these to Cloudinary so the site never
// depends on Google's (temporary, API-key-bearing) photo URL.
async function downloadPhotos(photos, placeId) {
  const dir = join(PHOTOS_DIR, placeId)
  let saved = 0
  for (const photo of (photos || []).slice(0, MAX_PHOTOS_PER_PLACE)) {
    const url = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1200&key=${API_KEY}`
    let res = await fetch(url)
    // One retry on rate limiting instead of silently losing the photo.
    if (res.status === 429) {
      await sleep(3000)
      res = await fetch(url)
    }
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

// Google IDs already in the DB (for the new-place review bar) and the subset
// with Cloudinary photos, which don't need their photos re-downloaded
// (import-places.js keeps their existing images on upsert).
async function loadExistingPlaces() {
  if (!process.env.DATABASE_URL) {
    console.warn('No DATABASE_URL -- treating every place as new and downloading all photos.')
    return { inDb: new Set(), hasPhotos: new Set() }
  }
  const { db } = await import('../src/lib/db.js')
  const rows = await db('places').select('google_place_id', 'img').whereNotNull('google_place_id')
  await db.destroy()
  return {
    inDb: new Set(rows.map((r) => r.google_place_id)),
    hasPhotos: new Set(rows.filter((r) => r.img?.includes('res.cloudinary.com')).map((r) => r.google_place_id)),
  }
}

async function main() {
  console.log(`LOT=${LOT}, filter: rating >= ${MIN_RATING}, reviews >= ${MIN_REVIEWS} (city) / ${MIN_REVIEWS_OUTLYING} (outlying, ${MIN_REVIEWS_OUTLYING_TEMPLE} for temples)`)

  // id -> where it was first found. First find wins, so a place matched by
  // both a city and a district query is judged by the city's threshold.
  const origins = new Map()
  const addIds = (found, origin) => found.forEach((id) => { if (!origins.has(id)) origins.set(id, origin) })

  console.log(`Searching ${cityQueries.length} city queries...`)
  for (const item of cityQueries) {
    const found = await searchTextIds({ textQuery: `${item.q} ขอนแก่น`, includedType: item.type, bounds: CITY_BOUNDS, maxPages: MAX_PAGES })
    addIds(found, { zone: 'city', query: item.q })
    console.log(`  "${item.q}": ${found.length}`)
  }

  console.log(`Searching ${districts.length} outlying districts x ${districtQueries.length} queries...`)
  for (const d of districts) {
    for (const item of districtQueries) {
      const found = await searchTextIds({
        textQuery: `${item.q} อำเภอ${d.name} ขอนแก่น`,
        includedType: item.type,
        bounds: d.bounds,
        maxPages: Math.min(item.maxPages ?? MAX_PAGES, MAX_PAGES),
      })
      addIds(found, { zone: 'outlying', district: d.name, accept: d.accept, query: item.q, cap: item.cap, capKey: item.cap ? `${d.name}:${item.q}` : null })
      console.log(`  [${d.name}] "${item.q}": ${found.length}`)
    }
  }
  const outPath = join(__dirname, '..', 'data', 'places.json')
  const previous = APPEND && existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf-8')) : []
  const previousIds = new Set(previous.map((p) => p.id))
  for (const id of previousIds) origins.delete(id)
  const { inDb, hasPhotos } = await loadExistingPlaces()
  console.log(`Found ${origins.size} unique places${APPEND ? ` not already in places.json (${previous.length} kept)` : ''}. Fetching details...`)

  const passed = []
  const rejected = []
  let done = 0
  for (const [id, origin] of origins) {
    const details = await fetchDetails(id)
    await sleep(150)
    done++
    if (done % 20 === 0) console.log(`  ${done}/${origins.size}...`)
    if (!details) continue
    const reason = rejectReason(details, origin, inDb)
    if (reason) rejected.push({ id, name: details.displayName?.text, query: origin.query, district: origin.district || 'เมือง', reason })
    else passed.push({ details, origin })
  }

  // Capped queries (district restaurants): keep only the top `cap` by review count.
  const capped = new Map()
  for (const entry of passed) {
    if (entry.origin.capKey) {
      if (!capped.has(entry.origin.capKey)) capped.set(entry.origin.capKey, [])
      capped.get(entry.origin.capKey).push(entry)
    }
  }
  const overCap = new Set()
  for (const entries of capped.values()) {
    entries.sort((a, b) => (b.details.userRatingCount || 0) - (a.details.userRatingCount || 0))
    for (const e of entries.slice(entries[0].origin.cap)) overCap.add(e)
  }
  for (const e of overCap) {
    rejected.push({ id: e.details.id, name: e.details.displayName?.text, query: e.origin.query, district: e.origin.district, reason: `เกินโควตา ${e.origin.cap} ร้านต่ออำเภอ` })
  }
  const places = passed.filter((e) => !overCap.has(e)).map((e) => e.details)

  console.log(`${places.length} passed, ${rejected.length} rejected. Downloading photos...`)
  let skippedPhotos = 0
  for (const p of places) {
    if (hasPhotos.has(p.id)) { skippedPhotos++; continue }
    await downloadPhotos(p.photos, p.id)
  }
  console.log(`  skipped photos for ${skippedPhotos} place(s) already on Cloudinary.`)

  const dataDir = join(__dirname, '..', 'data')
  writeFileSync(outPath, JSON.stringify([...previous, ...places], null, 2))
  writeFileSync(join(dataDir, 'places-rejected.json'), JSON.stringify(rejected, null, 2))
  console.log('Rejected:')
  rejected.forEach((r) => console.log(`  - [${r.district}/${r.query}] ${r.name}: ${r.reason}`))
  const noCategory = places.filter((p) => !mapCategory(p, p.displayName?.text || ''))
  if (noCategory.length) {
    console.log(`No category match (imported inactive for admin review): ${noCategory.map((p) => p.displayName?.text).join(', ')}`)
  }
  console.log(`Done. Wrote ${previous.length + places.length} places to data/places.json (rejects in data/places-rejected.json)`)
  console.log('Next: cd backend && npm run import:places')
}

main()
