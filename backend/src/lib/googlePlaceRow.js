// Pure Google Places (New) payload -> `places` row mapping. Shared by the
// one-shot seeder (scripts/import-places.js) and the admin "add from Google
// Maps" flow (services/placeImport.js) so a place added later looks exactly
// like a seeded one.
import { mapCategory } from '../../scripts/place-category.js'

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

function mapPrice(p, category) {
  const range = p.priceRange
  if (range?.startPrice?.units && range?.endPrice?.units) {
    return `฿${range.startPrice.units}-${range.endPrice.units} ต่อคน`
  }
  if (p.priceLevel && priceLevelLabel[p.priceLevel]) return priceLevelLabel[p.priceLevel]
  if (category === 'วัด' || category === 'สวนสาธารณะ' || category === 'สถานที่ท่องเที่ยว') return 'ไม่มีค่าเข้า'
  return 'สอบถามราคาหน้าร้าน'
}

export function cleanAddress(address) {
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

export function summarizeHours(hours) {
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

// `images` = already-hosted photo URLs (may be empty); `fallbackImg` is what
// `img` falls back to then (the seeder's placeholder; null for admin imports,
// where the photo gallery table is the source of truth).
export function placeToRow(p, { images = [], fallbackImg = null, qrPoints = 0 } = {}) {
  const name = p.displayName?.text || 'ไม่ทราบชื่อสถานที่'
  const category = mapCategory(p, name)
  const img = images[0] || fallbackImg
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
    // jsonb columns are stringified explicitly -- node-postgres would otherwise
    // serialize a JS array as a Postgres array literal, which jsonb rejects.
    hours_periods: p.regularOpeningHours?.periods ? JSON.stringify(p.regularOpeningHours.periods) : null,
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
    reviews: JSON.stringify(mapReviews(p)),
    img,
    images: images.length ? images : (img ? [img] : []),
    business_status: p.businessStatus || null,
    raw_data: JSON.stringify(p),
  }
}
