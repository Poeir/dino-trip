// Imports backend/data/places.json (raw Google Places API dump, produced by
// `npm run fetch:places`) -> Supabase `places` table, source='google'.
// Upserts on google_place_id, so re-running with a freshly fetched dump is
// safe to repeat.
//
// Usage: cd backend && npm run import:places

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

function mapCategory(p, name) {
  switch (p.primaryType) {
    case 'place_of_worship': return 'วัด'
    case 'state_park': return 'สวนสาธารณะ'
    case 'tourist_attraction': return 'สถานที่ท่องเที่ยว'
    case 'hotel': return 'ที่พัก'
    case 'bakery': return 'คาเฟ่'
    default: return isCafeName(name) ? 'คาเฟ่' : 'ร้านอาหาร'
  }
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
  if (p.editorialSummary?.overview) return p.editorialSummary.overview
  const ratingText = p.rating ? `คะแนนรีวิว ${p.rating} ดาว` : 'ยังไม่มีคะแนนรีวิว'
  const countText = p.userRatingCount ? ` จากผู้ใช้ Google Maps ${p.userRatingCount.toLocaleString('th-TH')} คน` : ''
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
      name: r.authorAttribution?.displayName || 'ผู้ใช้ Google Maps',
      text: truncateReview(r.text?.text || r.originalText?.text || ''),
    }))
    .filter((r) => r.text)
}

function toRow(p) {
  const name = p.displayName?.text || 'ไม่ทราบชื่อสถานที่'
  const category = mapCategory(p, name)
  const qrPoints = qrPointsByName[name] || 0
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
    img: './assets/picture01.jpg',
    business_status: p.businessStatus || null,
    raw_data: p,
  }
}

async function main() {
  const jsonPath = join(__dirname, '..', 'data', 'places.json')
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const rows = raw.map(toRow)

  const needsReview = rows.filter((r) => !r.category)
  console.log(`Importing ${rows.length} places (${needsReview.length} need manual category review)...`)

  const { data, error } = await supabase
    .from('places')
    .upsert(rows, { onConflict: 'google_place_id' })
    .select('id, name, category')

  if (error) {
    console.error('Import failed:', error.message)
    process.exit(1)
  }

  console.log(`Done. Upserted ${data.length} places.`)
  if (needsReview.length) {
    console.log('Review these in the admin Places tab (no clean category mapping found):')
    needsReview.forEach((r) => console.log(` - ${r.name}`))
  }
}

main()
