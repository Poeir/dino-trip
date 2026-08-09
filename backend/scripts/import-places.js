// Imports backend/data/places.json (raw Google Places API dump, produced by
// `npm run fetch:places`) -> Supabase `places` table, source='google'.
// Upserts on google_place_id, so re-running with a freshly fetched dump is
// safe to repeat.
//
// Usage: cd backend && npm run import:places

import 'dotenv/config'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PHOTOS_DIR = join(__dirname, '..', 'data', 'photos')
const PHOTO_BUCKET = 'place-photos'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy backend/.env.example to backend/.env and fill them in.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function ensurePhotoBucket() {
  const { error } = await supabase.storage.createBucket(PHOTO_BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message)) {
    console.error('Could not create/verify Storage bucket:', error.message)
  }
}

// Uploads the photos fetch-places.js already downloaded for this place (if
// any) to our own Storage bucket, so `images` points at URLs we control
// instead of Google's (expiring, API-key-bearing) photo endpoint.
async function uploadPhotos(placeId) {
  const dir = join(PHOTOS_DIR, placeId)
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
  const urls = []
  for (const file of files) {
    const storagePath = `${placeId}/${file}`
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(storagePath, readFileSync(join(dir, file)), { contentType: 'image/jpeg', upsert: true })
    if (error) {
      console.error(`  Photo upload failed for ${placeId}/${file}:`, error.message)
      continue
    }
    urls.push(supabase.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath).data.publicUrl)
  }
  return urls
}

const priceLevelLabel = {
  PRICE_LEVEL_FREE: 'ไม่มีค่าใช้จ่าย',
  PRICE_LEVEL_INEXPENSIVE: 'ราคาประหยัด',
  PRICE_LEVEL_MODERATE: 'ราคาปานกลาง',
  PRICE_LEVEL_EXPENSIVE: 'ราคาสูง',
  PRICE_LEVEL_VERY_EXPENSIVE: 'ราคาสูงมาก',
}

// Google's New Places API returns priceLevel as a string enum, not 0-4 -- rank
// it so `price_level` is a comparable smallint for the trip-planner's budget filter.
const priceLevelRank = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
}

// Same stand-in map used by the frontend's temporary client-side transform.
// TODO: once the admin QR tab writes to the `qrs` table directly, this can go away.
const qrPointsByName = {
  'วัดทุ่งเศรษฐี': 20,
  'พระมหาธาตุแก่นนคร': 25,
  'สวนนันทนา ขอนแก่น': 10,
  'บึงหนองโคตร': 10,
  'บึงแก่นนคร (เมืองขอนแก่น)': 15,
}

function isCafeName(name) {
  return /คาเฟ่|cafe|coffee/i.test(name)
}

// Google's Table A has 200+ place types (developers.google.com/maps/documentation/places/web-service/place-types)
// that don't map 1:1 onto our 8 fixed categories. This routes every type
// fetch-places.js's search scope can plausibly surface (restaurant,
// cafe+bakery, tourist_attraction+museum+park, place_of_worship, lodging) to
// the closest category. Anything not listed here -- overwhelmingly the
// Food and Drink header's many *_restaurant/bar/pub subtypes -- is correctly
// left to fall through to the 'ร้านอาหาร' default below.
const CATEGORY_BY_TYPE = {
  // Places of Worship
  place_of_worship: 'วัด', buddhist_temple: 'วัด', hindu_temple: 'วัด',
  mosque: 'วัด', church: 'วัด', shinto_shrine: 'วัด', synagogue: 'วัด',

  // Culture -- Google's own "Culture" header, mapped as one group instead of
  // re-split by our own judgment call (a castle/monument/historical_place is
  // exactly as much "พิพิธภัณฑ์" to Google as an actual museum building is).
  museum: 'พิพิธภัณฑ์', art_museum: 'พิพิธภัณฑ์', art_gallery: 'พิพิธภัณฑ์',
  art_studio: 'พิพิธภัณฑ์', auditorium: 'พิพิธภัณฑ์', castle: 'พิพิธภัณฑ์',
  cultural_landmark: 'พิพิธภัณฑ์', fountain: 'พิพิธภัณฑ์', historical_place: 'พิพิธภัณฑ์',
  history_museum: 'พิพิธภัณฑ์', monument: 'พิพิธภัณฑ์', performing_arts_theater: 'พิพิธภัณฑ์',
  sculpture: 'พิพิธภัณฑ์',

  // Green space / parks. `national_park` gets its own category, not
  // "สวนสาธารณะ" -- an อุทยานแห่งชาติ (with waterfalls, hiking, wildlife) reads
  // to a Thai visitor as a destination, not a city park.
  park: 'สวนสาธารณะ', state_park: 'สวนสาธารณะ',
  city_park: 'สวนสาธารณะ', garden: 'สวนสาธารณะ', botanical_garden: 'สวนสาธารณะ',
  playground: 'สวนสาธารณะ', picnic_ground: 'สวนสาธารณะ', dog_park: 'สวนสาธารณะ',
  cycling_park: 'สวนสาธารณะ',

  national_park: 'อุทยานแห่งชาติ',

  // Everything else scenic/notable -- Entertainment and Recreation /
  // Natural Features / Services headers that aren't a park or Culture.
  // `historical_landmark` stays here (not in พิพิธภัณฑ์ above) because
  // Google files it under Entertainment and Recreation, not Culture.
  tourist_attraction: 'สถานที่ท่องเที่ยว', scenic_spot: 'สถานที่ท่องเที่ยว',
  beach: 'สถานที่ท่องเที่ยว', island: 'สถานที่ท่องเที่ยว', lake: 'สถานที่ท่องเที่ยว',
  mountain_peak: 'สถานที่ท่องเที่ยว', river: 'สถานที่ท่องเที่ยว', woods: 'สถานที่ท่องเที่ยว',
  nature_preserve: 'สถานที่ท่องเที่ยว', wildlife_refuge: 'สถานที่ท่องเที่ยว',
  wildlife_park: 'สถานที่ท่องเที่ยว', zoo: 'สถานที่ท่องเที่ยว', aquarium: 'สถานที่ท่องเที่ยว',
  hiking_area: 'สถานที่ท่องเที่ยว', amusement_park: 'สถานที่ท่องเที่ยว', water_park: 'สถานที่ท่องเที่ยว',
  historical_landmark: 'สถานที่ท่องเที่ยว', cultural_center: 'สถานที่ท่องเที่ยว',
  planetarium: 'สถานที่ท่องเที่ยว', plaza: 'สถานที่ท่องเที่ยว',
  visitor_center: 'สถานที่ท่องเที่ยว', tourist_information_center: 'สถานที่ท่องเที่ยว',
  marina: 'สถานที่ท่องเที่ยว', vineyard: 'สถานที่ท่องเที่ยว', observation_deck: 'สถานที่ท่องเที่ยว',
  ferris_wheel: 'สถานที่ท่องเที่ยว', bridge: 'สถานที่ท่องเที่ยว',

  // Shopping -- only the touristy/market types. Supermarkets/convenience
  // stores etc. are out of fetch-places.js's search scope, left unmapped.
  market: 'ตลาด', flea_market: 'ตลาด', farmers_market: 'ตลาด', shopping_mall: 'ตลาด',

  // Lodging
  hotel: 'ที่พัก', resort_hotel: 'ที่พัก', motel: 'ที่พัก', hostel: 'ที่พัก',
  inn: 'ที่พัก', guest_house: 'ที่พัก', bed_and_breakfast: 'ที่พัก', cottage: 'ที่พัก',
  farmstay: 'ที่พัก', extended_stay_hotel: 'ที่พัก', lodging: 'ที่พัก',
  campground: 'ที่พัก', rv_park: 'ที่พัก', camping_cabin: 'ที่พัก',
  private_guest_room: 'ที่พัก', mobile_home_park: 'ที่พัก',
  japanese_inn: 'ที่พัก', budget_japanese_inn: 'ที่พัก',

  // Food and Drink -- cafe-shaped subtypes that aren't literally "restaurant"
  cafe: 'คาเฟ่', coffee_shop: 'คาเฟ่', coffee_stand: 'คาเฟ่', coffee_roastery: 'คาเฟ่',
  cat_cafe: 'คาเฟ่', dog_cafe: 'คาเฟ่', bakery: 'คาเฟ่', cake_shop: 'คาเฟ่',
  pastry_shop: 'คาเฟ่', dessert_shop: 'คาเฟ่', dessert_restaurant: 'คาเฟ่',
  ice_cream_shop: 'คาเฟ่', donut_shop: 'คาเฟ่', candy_store: 'คาเฟ่',
  chocolate_shop: 'คาเฟ่', chocolate_factory: 'คาเฟ่', confectionery: 'คาเฟ่',
  juice_shop: 'คาเฟ่', tea_house: 'คาเฟ่', bagel_shop: 'คาเฟ่', acai_shop: 'คาเฟ่',
}

function mapCategory(p, name) {
  if (CATEGORY_BY_TYPE[p.primaryType]) return CATEGORY_BY_TYPE[p.primaryType]
  // primaryType is often a generic/wrong Google guess (e.g. an apartment-style
  // hostel typed `apartment_building`) even though the fuller `types` list
  // usually still carries the correct type (`lodging`) somewhere in it.
  for (const t of p.types || []) {
    if (CATEGORY_BY_TYPE[t]) return CATEGORY_BY_TYPE[t]
  }
  return isCafeName(name) ? 'คาเฟ่' : 'ร้านอาหาร'
}

function mapPrice(p, category) {
  const range = p.priceRange
  if (range?.startPrice?.units && range?.endPrice?.units) {
    return `฿${range.startPrice.units}-${range.endPrice.units} ต่อคน`
  }
  if (p.priceLevel && priceLevelLabel[p.priceLevel]) return priceLevelLabel[p.priceLevel]
  if (category === 'วัด' || category === 'สวนสาธารณะ' || category === 'สถานที่ท่องเที่ยว') return 'ไม่มีค่าเข้า'
  return 'สอบถามราคาหน้าร้าน'
}

function cleanAddress(address) {
  return (address || '').replace(/^[A-Z0-9]{4,8}\+[A-Z0-9]{2,3}\s+/, '')
}

// `administrative_area_level_2` is Google's อำเภอ (district) component --
// more reliable than parsing/guessing it out of formattedAddress, and lets us
// verify OUTLYING_DISTRICTS' text-search results actually landed in the
// district they were searched for.
function mapDistrict(addressComponents) {
  const comp = (addressComponents || []).find((c) => c.types?.includes('administrative_area_level_2'))
  return comp?.longText || null
}

function summarizeHours(hours) {
  const lines = hours?.weekdayDescriptions
  if (!lines || !lines.length) return 'สอบถามเวลาทำการ'
  const timePart = (line) => line.split(': ')[1] || line
  const times = lines.map(timePart)
  const allSame = times.every((t) => t === times[0])
  return allSame ? `ทุกวัน ${times[0]}` : lines.join('\n')
}

function mapAmenities(p) {
  const list = []
  const park = p.parkingOptions
  if (park && (park.freeParkingLot || park.freeStreetParking || park.paidParkingLot)) list.push('ที่จอดรถ')
  const acc = p.accessibilityOptions
  if (acc && (acc.wheelchairAccessibleEntrance || acc.wheelchairAccessibleParking || acc.wheelchairAccessibleRestroom)) list.push('ทางลาดผู้พิการ')
  if (p.restroom) list.push('ห้องน้ำ')
  if (p.outdoorSeating) list.push('ที่นั่งกลางแจ้ง')
  if (p.goodForChildren) list.push('เหมาะสำหรับเด็ก')
  if (p.allowsDogs) list.push('พาสัตว์เลี้ยงเข้าได้')
  if (p.delivery) list.push('บริการเดลิเวอรี่')
  if (p.takeout) list.push('สั่งกลับบ้านได้')
  if (p.reservable) list.push('จองโต๊ะล่วงหน้าได้')
  const pay = p.paymentOptions
  if (pay && (pay.acceptsCreditCards || pay.acceptsDebitCards || pay.acceptsNfc)) list.push('ชำระผ่านบัตร')
  if (p.servesVegetarianFood) list.push('มีเมนูมังสวิรัติ')
  if (p.servesBreakfast) list.push('เสิร์ฟอาหารเช้า')
  if (p.servesLunch) list.push('เสิร์ฟมื้อกลางวัน')
  if (p.servesDinner) list.push('เสิร์ฟมื้อเย็น')
  if (p.servesBrunch) list.push('เสิร์ฟบรันช์')
  if (p.dineIn) list.push('นั่งทานในร้านได้')
  if (p.servesCoffee) list.push('มีกาแฟ')
  if (p.servesBeer || p.servesWine || p.servesCocktails) list.push('มีเครื่องดื่มแอลกอฮอล์')
  if (p.servesDessert) list.push('มีของหวาน')
  if (p.menuForChildren) list.push('มีเมนูสำหรับเด็ก')
  if (p.liveMusic) list.push('มีดนตรีสด')
  if (p.goodForGroups) list.push('เหมาะสำหรับกลุ่มใหญ่')
  if (p.goodForWatchingSports) list.push('เหมาะสำหรับดูกีฬา')
  if (p.curbsidePickup) list.push('รับที่รถได้')
  return list
}

// Google's `types` array carries specific cuisine/food-type info that the
// coarse `category` bucket (mapCategory) collapses away -- every restaurant
// was getting the same generic "อาหารพื้นถิ่น" tag regardless of actually
// being a BBQ place, a Vietnamese place, a buffet, etc, so RAG search for
// "อยากกินเนื้อย่าง" (want to eat grilled meat) couldn't find a real BBQ
// restaurant already in the DB (confirmed by testing). Surface the ones a
// user would actually search by.
const FOOD_TYPE_TAGS = {
  barbecue_restaurant: 'หมูกระทะ/ปิ้งย่าง',
  buffet_restaurant: 'บุฟเฟต์',
  seafood_restaurant: 'อาหารทะเล',
  thai_restaurant: 'อาหารไทย',
  japanese_restaurant: 'อาหารญี่ปุ่น',
  sushi_restaurant: 'ซูชิ',
  vietnamese_restaurant: 'อาหารเวียดนาม',
  chinese_restaurant: 'อาหารจีน',
  korean_restaurant: 'อาหารเกาหลี',
  italian_restaurant: 'อาหารอิตาเลียน',
  pizza_restaurant: 'พิซซ่า',
  hamburger_restaurant: 'เบอร์เกอร์',
  steak_house: 'สเต็ก',
  breakfast_restaurant: 'อาหารเช้า',
  vegetarian_restaurant: 'มังสวิรัติ',
  vegan_restaurant: 'วีแกน',
  dessert_restaurant: 'ของหวาน',
  dessert_shop: 'ของหวาน',
  bakery: 'เบเกอรี่',
  cake_shop: 'เบเกอรี่',
  bar: 'บาร์',
  night_club: 'ผับ/บาร์',
}

// Fallback for places Google itself only classified generically (`types:
// ["restaurant", ...]`, no cuisine subtype) even though the venue's own name
// already says what it is -- e.g. "เดอะนัวหมูกระทะบุฟเฟต์" whose `types` from
// Google carried no barbecue/buffet subtype at all despite the name.
const NAME_KEYWORD_TAGS = [
  [/หมูกระทะ|ปิ้งย่าง|บาร์บีคิว|bbq/i, 'หมูกระทะ/ปิ้งย่าง'],
  [/บุฟเฟต์|buffet/i, 'บุฟเฟต์'],
  [/สุกี้/, 'สุกี้'],
  [/ลาบก้อย|ลาบ|ก้อย/, 'ลาบ/ก้อย'],
  [/ส้มตำ|ตำมี|ตำกระเทย/, 'ส้มตำ'],
  [/ปลาเผา/, 'ปลาเผา'],
  [/เวียดนาม/, 'อาหารเวียดนาม'],
  [/ญี่ปุ่น|ซูชิ|sushi/i, 'อาหารญี่ปุ่น'],
  [/ทะเล|seafood/i, 'อาหารทะเล'],
  // Regression: real dinosaur attractions (Phu Wiang dinosaur museum/park)
  // had the word right in their name but no interest tag at all -- the
  // "ไดโนเสาร์" interest option on the trip form matched zero places despite
  // these existing, because category-based mapTags() below has no dinosaur
  // rule and this name-keyword list didn't either.
  [/ไดโนเสาร์|dinosaur/i, 'ไดโนเสาร์'],
  // Name-based, not category-based: category === 'ตลาด' ("market") is a noisy
  // bucket in this dataset -- 79 of its 122 rows don't even say "ตลาด" in the
  // name and are actually unrelated businesses (contractors, wholesalers,
  // tool dealers) that Google's Nearby Search swept into the same type
  // grouping mapCategory() maps to "ตลาด". Tagging by name keyword instead of
  // blanket-tagging the whole category avoids surfacing those as "shopping".
  [/ตลาด|ถนนคนเดิน|หัตถกรรม|ผ้าไหม|OTOP|ของฝาก/i, 'ช้อปปิ้ง/หัตถกรรม'],
]

function tagsFromName(name) {
  const tags = []
  for (const [re, tag] of NAME_KEYWORD_TAGS) {
    if (re.test(name)) tags.push(tag)
  }
  return tags
}

function mapTags(category, goodForChildren, types, name) {
  const tags = new Set()
  if (category === 'วัด') tags.add('วัฒนธรรม/ศาสนา')
  if (category === 'สวนสาธารณะ' || category === 'สถานที่ท่องเที่ยว' || category === 'อุทยานแห่งชาติ') tags.add('ธรรมชาติ')
  if (category === 'คาเฟ่') tags.add('คาเฟ่')
  if (category === 'ร้านอาหาร') tags.add('อาหารพื้นถิ่น')
  // Museums had no interest tag at all -- treating them as a cultural stop,
  // same as this dataset already treats วัด.
  if (category === 'พิพิธภัณฑ์') tags.add('วัฒนธรรม/ศาสนา')
  if (goodForChildren) tags.add('ครอบครัว')
  for (const t of types || []) {
    if (FOOD_TYPE_TAGS[t]) tags.add(FOOD_TYPE_TAGS[t])
  }
  for (const t of tagsFromName(name || '')) tags.add(t)
  return [...tags]
}

function mapDesc(p, category) {
  // generativeSummary (Gemini-written overview) reads more naturally than the
  // older editorialSummary and is available for far more places -- prefer it,
  // but fall back through both before the generic rating-based line.
  if (p.generativeSummary?.overview?.text) return p.generativeSummary.overview.text
  if (p.editorialSummary?.overview) return p.editorialSummary.overview
  const ratingText = p.rating ? `คะแนนรีวิว ${p.rating} ดาว` : 'ยังไม่มีคะแนนรีวิว'
  const countText = p.userRatingCount ? ` จากผู้ใช้ Google Maps ${p.userRatingCount.toLocaleString('th-TH')} คน` : ''
  return `${category}ในขอนแก่น ${ratingText}${countText}`
}

function truncateReview(text, max = 220) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  // Plain .slice(0, max) cuts on UTF-16 code units, which can split an emoji's
  // surrogate pair in half -- Postgres then rejects the lone surrogate with
  // "invalid input syntax for type json" on insert. Array.from splits on code
  // points instead, so a pair is always kept whole.
  return Array.from(clean).slice(0, max).join('').trim() + '…'
}

function mapReviews(p) {
  return (p.reviews || [])
    .slice(0, 5)
    .map((r) => ({
      stars: r.rating || 5,
      name: r.authorAttribution?.displayName || 'ผู้ใช้ Google Maps',
      text: truncateReview(r.text?.text || r.originalText?.text || ''),
    }))
    .filter((r) => r.text)
}

async function toRow(p) {
  const name = p.displayName?.text || 'ไม่ทราบชื่อสถานที่'
  const category = mapCategory(p, name)
  const qrPoints = qrPointsByName[name] || 0
  const images = await uploadPhotos(p.id)
  const img = images[0] || '/assets/picture01.jpg'
  return {
    source: 'google',
    google_place_id: p.id,
    name,
    category,
    rating: p.rating || null,
    review_count: p.userRatingCount || 0,
    price_level: priceLevelRank[p.priceLevel] ?? null,
    price: mapPrice(p, category),
    address: cleanAddress(p.formattedAddress),
    district: mapDistrict(p.addressComponents),
    hours: summarizeHours(p.regularOpeningHours),
    hours_periods: p.regularOpeningHours?.periods || null,
    phone: p.internationalPhoneNumber || null,
    website: p.websiteUri || null,
    maps_url: p.googleMapsUri || null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    description: mapDesc(p, category),
    amenities: mapAmenities(p),
    tags: mapTags(category, p.goodForChildren, p.types, name),
    has_qr: qrPoints > 0,
    qr_points: qrPoints,
    reviews: mapReviews(p),
    img,
    images: images.length ? images : [img],
    business_status: p.businessStatus || null,
    raw_data: p,
  }
}

async function main() {
  await ensurePhotoBucket()
  const jsonPath = join(__dirname, '..', 'data', 'places.json')
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const rows = await Promise.all(raw.map(toRow))

  const needsReview = rows.filter((r) => !r.category)
  console.log(`Importing ${rows.length} places (${needsReview.length} need manual category review)...`)

  // Chunked instead of one giant upsert -- a single bad row (e.g. malformed
  // unicode Postgres rejects) fails only its own chunk of 50, not all ~400.
  const CHUNK_SIZE = 50
  const data = []
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    const { data: d, error } = await supabase
      .from('places')
      .upsert(chunk, { onConflict: 'google_place_id' })
      .select('id, name, category')
    if (error) {
      console.error(`Chunk ${i}-${i + chunk.length} failed: ${error.message}`)
      console.error('Places in this chunk:', chunk.map((r) => r.name).join(', '))
      continue
    }
    data.push(...d)
  }

  console.log(`Done. Upserted ${data.length} places.`)
  if (needsReview.length) {
    console.log('Review these in the admin Places tab (no clean category mapping found):')
    needsReview.forEach((r) => console.log(` - ${r.name}`))
  }
}

main()
