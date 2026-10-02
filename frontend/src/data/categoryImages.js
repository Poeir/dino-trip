// Illustrated icons (public/assets/icons/*.webp) shown in ImageSlot's empty/
// broken-image state, so a card with no photo still reads as "a cafe" or "a
// temple" instead of a blank green box. Keys are the place `category` values
// from seed.js's `categories` list.
const icon = (name) => `/assets/icons/${name}.webp`

const PLACE_ICONS = {
  'คาเฟ่': icon('cafe'),
  'วัด': icon('temple'),
  'พิพิธภัณฑ์': icon('museum'),
  'สวนสาธารณะ': icon('nature'),
  'อุทยานแห่งชาติ': icon('nature'),
  'ตลาด': icon('market'),
  'สถานที่ท่องเที่ยว': icon('map-pin'),
  'ร้านอาหาร': icon('restaurant'),
}

export const placeCategoryIcon = (category) => PLACE_ICONS[category] || icon('map-pin')
export const EVENT_ICON = icon('event')
export const REWARD_ICON = icon('reward')
export const HOTEL_ICON = icon('hotel')
// Mascot poses (public/assets/mascot/). Use for pages with personality --
// welcome, trip planner, empty states -- and the icons above for compact
// per-category slots.
export const MASCOT = Object.fromEntries(
  ['wave', 'map', 'camera', 'celebrate', 'think', 'sad', 'sleep', 'treasure', 'point']
    .map((pose) => [pose, `/assets/mascot/mascot-${pose}.webp`]),
)

export const MAP_ICON = icon('map-pin')
export const QR_ICON = icon('qr-scan')
export const TRIP_ICON = icon('trip-route')
