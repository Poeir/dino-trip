const stroke = '#2E7D32'
const sw = 2.3

export function IconBox({ children, size = 34 }) {
  return (
    <span style={{ width: size, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {children}
    </span>
  )
}

function wrap(svg, box) {
  return box ? <IconBox>{svg}</IconBox> : svg
}

export function CalendarIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5.5" width="18" height="15" rx="2.5" stroke={color} strokeWidth={sw} />
      <path d="M8 3v4M16 3v4M3 10h18" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function PinIcon({ box = true, color = stroke } = {}) {
  return wrap(
    <svg width="22" height="26" viewBox="0 0 24 28" fill="none">
      <path d="M12 26.5S2.5 16.4 2.5 9.5a9.5 9.5 0 1 1 19 0c0 6.9-9.5 17-9.5 17Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <circle cx="12" cy="9.5" r="3.4" stroke={color} strokeWidth={sw} />
    </svg>,
    box
  )
}

export function HeartIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 20.5s-8-5-8-11.2A5 5 0 0 1 12 6a5 5 0 0 1 8 3.3c0 6.2-8 11.2-8 11.2Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function WalletIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="6.5" width="18" height="13" rx="2.5" stroke={color} strokeWidth={sw} />
      <path d="M3 10.5h18" stroke={color} strokeWidth={sw} />
      <circle cx="16.5" cy="14.5" r="1.4" fill={color} />
    </svg>,
    box
  )
}

export function ClockIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth={sw} />
      <path d="M12 7v5.5l4 2.3" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function GiftIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="9.5" width="17" height="11" rx="1.5" stroke={color} strokeWidth={sw} />
      <path d="M3.5 9.5h17M12 9.5v11" stroke={color} strokeWidth={sw} />
      <path d="M12 9.5H8a2.5 2.5 0 1 1 2.5-2.5c0 1.4.6 2.5 1.5 2.5Zm0 0h4a2.5 2.5 0 1 0-2.5-2.5c0 1.4-.6 2.5-1.5 2.5Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function ChecklistIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke={color} strokeWidth={sw} />
      <path d="M7.5 12.5l2.5 2.5 6-6" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function StarIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function PhoneIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 4.5h3.2l1.3 4-2 1.5a11.5 11.5 0 0 0 5.5 5.5l1.5-2 4 1.3V18a1.5 1.5 0 0 1-1.6 1.5A15 15 0 0 1 3.5 6.1 1.5 1.5 0 0 1 5 4.5Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function RouteIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="6" cy="6" r="2.3" stroke={color} strokeWidth={sw} />
      <circle cx="18" cy="18" r="2.3" stroke={color} strokeWidth={sw} />
      <path d="M6 8.3V13a4 4 0 0 0 4 4h1.5a4 4 0 0 0 4-4v-1.3" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray="2.5 2.5" />
    </svg>,
    box
  )
}

export function PencilIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 20l.9-4.2L15.6 5.1a1.8 1.8 0 0 1 2.6 0l.7.7a1.8 1.8 0 0 1 0 2.6L8.2 19.1 4 20Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M13.8 6.9l3.3 3.3" stroke={color} strokeWidth={sw} />
    </svg>,
    box
  )
}

export function ShareArrowIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="18" cy="5.5" r="2.3" stroke={color} strokeWidth={sw} />
      <circle cx="6" cy="12" r="2.3" stroke={color} strokeWidth={sw} />
      <circle cx="18" cy="18.5" r="2.3" stroke={color} strokeWidth={sw} />
      <path d="M8.1 10.7l7.8-4.2M8.1 13.3l7.8 4.2" stroke={color} strokeWidth={sw} />
    </svg>,
    box
  )
}

export function ParkingIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke={color} strokeWidth={sw} />
      <path d="M9.5 16V8h3a2.5 2.5 0 1 1 0 5h-3" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function WifiIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3.5 9a13 13 0 0 1 17 0" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <path d="M6.8 12.6a8.5 8.5 0 0 1 10.4 0" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <path d="M10 16.2a3.7 3.7 0 0 1 4 0" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <circle cx="12" cy="19" r="1.2" fill={color} />
    </svg>,
    box
  )
}

export function CardIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5.5" width="18" height="13" rx="2.3" stroke={color} strokeWidth={sw} />
      <path d="M3 9.5h18" stroke={color} strokeWidth={sw} />
    </svg>,
    box
  )
}

export function AccessibilityIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="4.5" r="1.8" fill={color} />
      <path d="M12 8v5m0 0-4.5 6M12 13l4.5 6M8 11h8" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function ShopIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 9.5 5.2 4.5h13.6L20 9.5" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M4 9.5h16V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M9.5 20v-4.5a2.5 2.5 0 0 1 5 0V20" stroke={color} strokeWidth={sw} />
    </svg>,
    box
  )
}

export function GuideIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="7" r="3.2" stroke={color} strokeWidth={sw} />
      <path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function RunIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="15" cy="4.5" r="1.8" fill={color} />
      <path d="M6 20l3.2-4.4-1.5-3.6 3.5-2.6 1.6 2.2 4.2.9M9.3 12l2.4-3.4 3 1.6" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 16.2 8 20" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function FoodIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 3.5v8a2.5 2.5 0 0 0 5 0v-8M7.5 3.5v6M5 3.5v6" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <path d="M18 3.5c-2 0-3 2-3 4.5S16 12 18 12v8.5" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function BoltIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M13 3 5 13.5h5.5L11 21l8-11h-5.5Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function CameraIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-2h7l1 2h2A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V8.5Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.3" stroke={color} strokeWidth={sw} />
    </svg>,
    box
  )
}

export function GridIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" stroke={color} strokeWidth={sw} />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" stroke={color} strokeWidth={sw} />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" stroke={color} strokeWidth={sw} />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" stroke={color} strokeWidth={sw} />
    </svg>,
    box
  )
}

export function CupIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 9.5h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-6Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <path d="M8.5 3.5c-.8.9-.8 1.6 0 2.5M12 3.5c-.8.9-.8 1.6 0 2.5" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function TempleIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2.5 15 6H9l3-3.5Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M6 9.5 12 6l6 3.5" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M7 9.5v8M12 9.5v8M17 9.5v8" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <path d="M4 17.5h16M3 20.5h18" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function MuseumIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 9.5 12 4l9 5.5" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M5 9.5v9M9.5 9.5v9M14.5 9.5v9M19 9.5v9" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <path d="M3 18.5h18M2.5 21h19" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function TreeIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3l4.5 6.5h-2.7L18 14.5h-3.2L17 19H7l3.2-4.5H7l4.2-4.5H8.5L12 3Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M12 19v2.5" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function MountainIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 18.5 9.5 7l3.6 5.8L15.5 9l5.5 9.5H3Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M18.5 18.5 15.5 9l-2.4 3.8" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function BasketIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 10.5h16l-1.6 8.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8L4 10.5Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M8.5 10.5 10 5.5M15.5 10.5 14 5.5" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <path d="M9.5 14v3.5M12 14v3.5M14.5 14v3.5" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function BedIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 18.5v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 15.5h18" stroke={color} strokeWidth={sw} />
      <rect x="4.5" y="10" width="6" height="3.2" rx="1" stroke={color} strokeWidth={sw} />
      <path d="M3 18.5v2M21 18.5v2" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function DotIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" fill={color} />
    </svg>,
    box
  )
}

const amenityKeywordIcons = [
  [['จอดรถ'], ParkingIcon],
  [['wi-fi', 'wifi'], WifiIcon],
  [['บัตร'], CardIcon],
  [['ผู้พิการ'], AccessibilityIcon],
  [['ของที่ระลึก', 'หัตถกรรม'], ShopIcon],
  [['ไกด์'], GuideIcon],
  [['วิ่ง'], RunIcon],
  [['อาหาร'], FoodIcon],
  [['ชาร์จ'], BoltIcon],
  [['ถ่ายรูป'], CameraIcon],
]

export function AmenityIcon({ label, size = 15, color = stroke, box = false } = {}) {
  const lower = (label || '').toLowerCase()
  const match = amenityKeywordIcons.find(([keywords]) => keywords.some((k) => lower.includes(k)))
  const Icon = match ? match[1] : DotIcon
  return <Icon size={size} color={color} box={box} />
}
