// Google place types -> our fixed categories. Shared by import-places.js
// (to set `category`) and fetch-places.js (to drop lodging before paying
// for its photos).

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
export const CATEGORY_BY_TYPE = {
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

// Food and Drink primary types left unmapped in CATEGORY_BY_TYPE on purpose
// (they're the 'ร้านอาหาร' default). They still have to short-circuit the
// `types` scan below: a restaurant that also rents rooms carries `hotel` /
// `lodging` in its secondary types, and was being filed as ที่พัก.
const FOOD_PRIMARY_TYPE = /restaurant|^food|^meal_|^bar|pub$|diner|bistro|steak_house|night_club/

export function mapCategory(p, name) {
  if (CATEGORY_BY_TYPE[p.primaryType]) return CATEGORY_BY_TYPE[p.primaryType]
  if (FOOD_PRIMARY_TYPE.test(p.primaryType || '')) return isCafeName(name) ? 'คาเฟ่' : 'ร้านอาหาร'
  // primaryType is often a generic/wrong Google guess (e.g. an apartment-style
  // hostel typed `apartment_building`) even though the fuller `types` list
  // usually still carries the correct type (`lodging`) somewhere in it.
  for (const t of p.types || []) {
    if (CATEGORY_BY_TYPE[t]) return CATEGORY_BY_TYPE[t]
  }
  // Only default to ร้านอาหาร when Google actually says it serves food. A
  // blanket default filed toll booths, a silk shop and เขื่อนอุบลรัตน์
  // (`government_office`) as restaurants; null instead sends them to
  // import-places.js's manual-review list.
  if ((p.types || []).some((t) => FOOD_PRIMARY_TYPE.test(t))) return isCafeName(name) ? 'คาเฟ่' : 'ร้านอาหาร'
  return isCafeName(name) ? 'คาเฟ่' : null
}
