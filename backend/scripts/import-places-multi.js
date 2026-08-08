// One-time import: backend/data/output_places_multi_{cafe,restaurants,tourist_attraction}.json
// (87 records from the old TripplanerChatbot project's 9-point-grid Google Places
// search, nested "DinoDB" schema) -> Supabase `places` table, source='google'.
// Sibling to import-places.js, which handles the flat raw-Google-API schema instead.
//
// Usage: cd backend && npm run import:places-multi

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy backend/.env.example to backend/.env and fill them in.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const SOURCE_FILES = [
  'output_places_multi_cafe.json',
  'output_places_multi_restaurants.json',
  'output_places_multi_tourist_attraction.json',
]

// Google's New Places API returns priceLevel as a string enum, not 0-4 -- rank
// it the same way import-places.js does so the `price_level` column stays
// comparable across both import scripts.
const priceLevelRank = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
}
const priceLevelLabel = {
  PRICE_LEVEL_FREE: 'ไม่มีค่าใช้จ่าย',
  PRICE_LEVEL_INEXPENSIVE: 'ราคาประหยัด',
  PRICE_LEVEL_MODERATE: 'ราคาปานกลาง',
  PRICE_LEVEL_EXPENSIVE: 'ราคาสูง',
  PRICE_LEVEL_VERY_EXPENSIVE: 'ราคาสูงมาก',
}

const categoryByPrimaryType = {
  place_of_worship: 'วัด', buddhist_temple: 'วัด', hindu_temple: 'วัด', mosque: 'วัด',
  state_park: 'สวนสาธารณะ', park: 'สวนสาธารณะ',
  museum: 'พิพิธภัณฑ์',
  shopping_mall: 'ตลาด',
  hotel: 'ที่พัก',
  bakery: 'คาเฟ่', cake_shop: 'คาเฟ่', coffee_shop: 'คาเฟ่', cafe: 'คาเฟ่',
  tourist_attraction: 'สถานที่ท่องเที่ยว', scenic_spot: 'สถานที่ท่องเที่ยว', bridge: 'สถานที่ท่องเที่ยว',
  monument: 'สถานที่ท่องเที่ยว', farm: 'สถานที่ท่องเที่ยว', campground: 'สถานที่ท่องเที่ยว', water_park: 'สถานที่ท่องเที่ยว',
}

function isCafeName(name) {
  return /คาเฟ่|cafe|coffee/i.test(name)
}

function mapCategory(primaryType, name) {
  if (categoryByPrimaryType[primaryType]) return categoryByPrimaryType[primaryType]
  return isCafeName(name) ? 'คาเฟ่' : 'ร้านอาหาร'
}

function mapPrice(priceLevel, category) {
  if (priceLevel && priceLevelLabel[priceLevel]) return priceLevelLabel[priceLevel]
  if (category === 'วัด' || category === 'สวนสาธารณะ' || category === 'สถานที่ท่องเที่ยว') return 'ไม่มีค่าเข้า'
  return 'สอบถามราคาหน้าร้าน'
}

function cleanAddress(address) {
  return (address || '').replace(/^[A-Z0-9]{4,8}\+[A-Z0-9]{2,3}\s+/, '')
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
  const park = p.extra?.parkingOptions
  if (park && (park.freeParkingLot || park.freeStreetParking || park.paidParkingLot)) list.push('ที่จอดรถ')
  const acc = p.extra?.accessibilityOptions
  if (acc && (acc.wheelchairAccessibleEntrance || acc.wheelchairAccessibleParking || acc.wheelchairAccessibleRestroom)) list.push('ทางลาดผู้พิการ')
  const f = p.features || {}
  if (f.restroom) list.push('ห้องน้ำ')
  if (f.outdoorSeating) list.push('ที่นั่งกลางแจ้ง')
  if (f.goodForChildren) list.push('เหมาะสำหรับเด็ก')
  if (f.allowsDogs) list.push('พาสัตว์เลี้ยงเข้าได้')
  if (f.delivery) list.push('บริการเดลิเวอรี่')
  if (f.takeout) list.push('สั่งกลับบ้านได้')
  if (f.reservable) list.push('จองโต๊ะล่วงหน้าได้')
  const pay = p.extra?.paymentOptions
  if (pay && (pay.acceptsCreditCards || pay.acceptsDebitCards || pay.acceptsNfc)) list.push('ชำระผ่านบัตร')
  if (f.servesVegetarianFood) list.push('มีเมนูมังสวิรัติ')
  return list
}

// Same rationale as import-places.js's FOOD_TYPE_TAGS -- category alone
// collapsed every restaurant to the same generic "อาหารพื้นถิ่น" tag, so RAG
// search couldn't distinguish a BBQ place from a Vietnamese place from a
// buffet. This dataset's raw `types` array survived the nested-schema
// transform under core.types, so it's available here too.
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

// Same rationale as import-places.js's NAME_KEYWORD_TAGS -- some venues'
// Google `types` are only generic ("restaurant", no cuisine subtype) even
// though the name already says what it is.
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
  if (category === 'สวนสาธารณะ' || category === 'สถานที่ท่องเที่ยว') tags.add('ธรรมชาติ')
  if (category === 'คาเฟ่') tags.add('คาเฟ่')
  if (category === 'ร้านอาหาร') tags.add('อาหารพื้นถิ่น')
  if (goodForChildren) tags.add('ครอบครัว')
  for (const t of types || []) {
    if (FOOD_TYPE_TAGS[t]) tags.add(FOOD_TYPE_TAGS[t])
  }
  for (const t of tagsFromName(name || '')) tags.add(t)
  return [...tags]
}

function mapDesc(p, category) {
  const summary = p.extra?.editorialSummary
  if (summary) return summary
  const rating = p.core?.rating
  const count = p.core?.userRatingCount
  const ratingText = rating ? `คะแนนรีวิว ${rating} ดาว` : 'ยังไม่มีคะแนนรีวิว'
  const countText = count ? ` จากผู้ใช้ Google Maps ${count.toLocaleString('th-TH')} คน` : ''
  return `${category}ในขอนแก่น ${ratingText}${countText}`
}

function truncateReview(text, max = 220) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max).trim() + '…'
}

function mapReviews(p) {
  return (p.reviews || [])
    .slice(0, 5)
    .map((r) => ({
      stars: r.rating || 5,
      name: r.authorName || 'ผู้ใช้ Google Maps',
      text: truncateReview(r.text || ''),
    }))
    .filter((r) => r.text)
}

function toRow(p) {
  const name = p.core?.name || 'ไม่ทราบชื่อสถานที่'
  const category = mapCategory(p.core?.primaryType, name)
  const priceLevel = p.core?.priceLevel
  return {
    source: 'google',
    google_place_id: p.google_place_id,
    name,
    category,
    rating: p.core?.rating || null,
    review_count: p.core?.userRatingCount || 0,
    price_level: priceLevelRank[priceLevel] ?? (typeof priceLevel === 'number' ? priceLevel : null),
    price: mapPrice(priceLevel, category),
    address: cleanAddress(p.address?.formatted),
    hours: summarizeHours(p.openingHours),
    hours_periods: p.openingHours?.periods || null,
    phone: p.contact?.phone || null,
    website: p.contact?.website || null,
    maps_url: p.maps?.googleMapsUri || null,
    lat: p.core?.location?.lat ?? null,
    lng: p.core?.location?.lng ?? null,
    description: mapDesc(p, category),
    amenities: mapAmenities(p),
    tags: mapTags(category, p.features?.goodForChildren, p.core?.types, name),
    has_qr: false,
    qr_points: 0,
    reviews: mapReviews(p),
    img: '/assets/picture01.jpg',
  }
}

async function main() {
  const byId = new Map()
  for (const file of SOURCE_FILES) {
    const raw = JSON.parse(readFileSync(join(__dirname, '..', 'data', file), 'utf-8'))
    for (const p of raw.map(toRow)) byId.set(p.google_place_id, p)
  }
  const allRows = [...byId.values()]

  console.log(`Importing ${allRows.length} places from ${SOURCE_FILES.length} files (deduped by google_place_id)...`)

  const { data, error } = await supabase
    .from('places')
    .upsert(allRows, { onConflict: 'google_place_id' })
    .select('id, name, category')

  if (error) {
    console.error('Import failed:', error.message)
    process.exit(1)
  }

  console.log(`Done. Upserted ${data.length} places.`)
}

main()
