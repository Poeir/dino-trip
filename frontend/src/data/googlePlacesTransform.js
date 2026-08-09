import rawPlaces from './khon_kaen_places.json'

const priceLevelLabel = {
  PRICE_LEVEL_FREE: 'ไม่มีค่าใช้จ่าย',
  PRICE_LEVEL_INEXPENSIVE: 'ราคาประหยัด',
  PRICE_LEVEL_MODERATE: 'ราคาปานกลาง',
  PRICE_LEVEL_EXPENSIVE: 'ราคาสูง',
  PRICE_LEVEL_VERY_EXPENSIVE: 'ราคาสูงมาก',
}

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

function mapTags(category, goodForChildren) {
  const tags = new Set()
  if (category === 'วัด') tags.add('วัฒนธรรม/ศาสนา')
  if (category === 'สวนสาธารณะ' || category === 'สถานที่ท่องเที่ยว') tags.add('ธรรมชาติ')
  if (category === 'คาเฟ่') tags.add('คาเฟ่')
  if (category === 'ร้านอาหาร') tags.add('อาหารพื้นถิ่น')
  if (goodForChildren) tags.add('ครอบครัว')
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

export const placesFromGoogle = rawPlaces.map((p) => {
  const name = p.displayName?.text || 'ไม่ทราบชื่อสถานที่'
  const category = mapCategory(p, name)
  const qrPoints = qrPointsByName[name] || 0
  return {
    id: p.id,
    name,
    category,
    rating: p.rating || 0,
    reviews: p.userRatingCount || 0,
    price: mapPrice(p, category),
    address: cleanAddress(p.formattedAddress),
    hours: summarizeHours(p.regularOpeningHours),
    phone: p.internationalPhoneNumber || '',
    website: p.websiteUri || '',
    mapsUrl: p.googleMapsUri || '',
    desc: mapDesc(p, category),
    amenities: mapAmenities(p),
    tags: mapTags(category, p.goodForChildren),
    hasQR: qrPoints > 0,
    qrPoints,
    reviewsList: mapReviews(p),
    location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
    img: './assets/picture01.jpg',
  }
})
