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

export function SparkleAIIcon({ size = 16, color = stroke, box = false } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2.5c.55 3.7 1.45 6.05 3.05 7.65 1.6 1.6 3.95 2.5 7.65 3.05-3.7.55-6.05 1.45-7.65 3.05-1.6 1.6-2.5 3.95-3.05 7.65-.55-3.7-1.45-6.05-3.05-7.65-1.6-1.6-3.95-2.5-7.65-3.05 3.7-.55 6.05-1.45 7.65-3.05 1.6-1.6 2.5-3.95 3.05-7.65Z" fill={color} />
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

export function RestroomIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="5" r="2.2" stroke={color} strokeWidth={sw} />
      <path d="M12 8v6M9 10.5h6M9.5 14 8 20M14.5 14 16 20" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function OutdoorSeatIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3c4.5 0 8 3 8 6.5H4C4 6 7.5 3 12 3Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M12 9.5V19M9 21h6" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function SmileyIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={sw} />
      <circle cx="9" cy="10" r="1" fill={color} />
      <circle cx="15" cy="10" r="1" fill={color} />
      <path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function PawIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="7.5" cy="9.5" r="1.7" fill={color} />
      <circle cx="12" cy="6.5" r="1.7" fill={color} />
      <circle cx="16.5" cy="9.5" r="1.7" fill={color} />
      <path d="M12 12c-3.2 0-5.5 2.1-5.5 4.5 0 1.8 1.5 3 3.2 2.3.9-.35 1.4-.35 2.3 0 1.7.7 3.2-.5 3.2-2.3 0-2.4-2.3-4.5-5.2-4.5Z" fill={color} />
    </svg>,
    box
  )
}

export function DeliveryIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="4.5" y="7.5" width="15" height="12" rx="1.5" stroke={color} strokeWidth={sw} />
      <path d="M4.5 12h15M12 7.5v12" stroke={color} strokeWidth={sw} />
      <path d="M1.5 9.5h1.8M1.5 12h1.8M1.5 14.5h1.8" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function TakeoutBagIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 8.5h12l-1.2 10.5a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 8.5Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M9 8.5V6a3 3 0 0 1 6 0v2.5" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function ReserveIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="5.5" width="17" height="14.5" rx="2.3" stroke={color} strokeWidth={sw} />
      <path d="M8 3.5v4M16 3.5v4M3.5 10h17" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <path d="M8.5 15l2 2 4.5-4.5" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
    box
  )
}

export function TableIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 20V13a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h3M17 20h3M4 17h16" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function LeafIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 19c0-8 6-13.5 13-14-1 8-5.5 13-13 14Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M8 17c3-3 6-6 9-10.5" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function WineGlassIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M7 4h10l-1 6a4 4 0 0 1-8 0L7 4Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M12 14v5M9 20.5h6" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function DessertIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M7 10a5 5 0 0 1 10 0c0 2-1.2 3.3-2.3 4.2L12 21l-2.7-6.8C8.2 13.3 7 12 7 10Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <circle cx="9.3" cy="8.5" r="0.9" fill={color} />
      <circle cx="12" cy="7" r="0.9" fill={color} />
      <circle cx="14.7" cy="8.5" r="0.9" fill={color} />
    </svg>,
    box
  )
}

export function MusicNoteIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 17V5l10-2v12" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="18" r="2.3" stroke={color} strokeWidth={sw} />
      <circle cx="17" cy="15.5" r="2.3" stroke={color} strokeWidth={sw} />
    </svg>,
    box
  )
}

export function GroupIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="8.5" cy="8" r="2.6" stroke={color} strokeWidth={sw} />
      <circle cx="16" cy="8.5" r="2.2" stroke={color} strokeWidth={sw} />
      <path d="M3.5 20c0-3.5 2.5-6 5-6s5 2.5 5 6" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <path d="M13.5 14.3c2 .3 3.5 2.3 4 5.7" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>,
    box
  )
}

export function ScreenSportsIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="12" rx="1.8" stroke={color} strokeWidth={sw} />
      <path d="M9 21h6M12 17v4" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <circle cx="12" cy="11" r="3" stroke={color} strokeWidth={sw} />
    </svg>,
    box
  )
}

export function CarIcon({ size = 24, color = stroke, box = true } = {}) {
  return wrap(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 15.5 5.3 10a2 2 0 0 1 2-1.5h9.4a2 2 0 0 1 2 1.5l1.3 5.5" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="15.5" width="18" height="3.5" rx="1.2" stroke={color} strokeWidth={sw} />
      <circle cx="7.5" cy="19" r="1.4" stroke={color} strokeWidth={sw} />
      <circle cx="16.5" cy="19" r="1.4" stroke={color} strokeWidth={sw} />
    </svg>,
    box
  )
}

const AMENITY_META = [
  { keywords: ['รับที่รถ'], icon: CarIcon, group: 'บริการ' },
  { keywords: ['จอดรถ'], icon: ParkingIcon, group: 'ทั่วไป' },
  { keywords: ['wi-fi', 'wifi'], icon: WifiIcon, group: 'ทั่วไป' },
  { keywords: ['บัตร'], icon: CardIcon, group: 'ทั่วไป' },
  { keywords: ['ผู้พิการ'], icon: AccessibilityIcon, group: 'ทั่วไป' },
  { keywords: ['ห้องน้ำ'], icon: RestroomIcon, group: 'ทั่วไป' },
  { keywords: ['กลางแจ้ง'], icon: OutdoorSeatIcon, group: 'ทั่วไป' },
  { keywords: ['ของที่ระลึก', 'หัตถกรรม'], icon: ShopIcon, group: 'ทั่วไป' },
  { keywords: ['ไกด์'], icon: GuideIcon, group: 'บริการ' },
  { keywords: ['วิ่ง'], icon: RunIcon, group: 'ทั่วไป' },
  { keywords: ['ชาร์จ'], icon: BoltIcon, group: 'ทั่วไป' },
  { keywords: ['ถ่ายรูป'], icon: CameraIcon, group: 'ทั่วไป' },
  { keywords: ['สัตว์เลี้ยง'], icon: PawIcon, group: 'เหมาะสำหรับ' },
  { keywords: ['กลุ่มใหญ่'], icon: GroupIcon, group: 'เหมาะสำหรับ' },
  { keywords: ['ดูกีฬา'], icon: ScreenSportsIcon, group: 'เหมาะสำหรับ' },
  { keywords: ['เด็ก'], icon: SmileyIcon, group: 'เหมาะสำหรับ' },
  { keywords: ['เดลิเวอรี'], icon: DeliveryIcon, group: 'บริการ' },
  { keywords: ['กลับบ้าน'], icon: TakeoutBagIcon, group: 'บริการ' },
  { keywords: ['จองโต๊ะ'], icon: ReserveIcon, group: 'บริการ' },
  { keywords: ['นั่งทานในร้าน'], icon: TableIcon, group: 'บริการ' },
  { keywords: ['มังสวิรัติ'], icon: LeafIcon, group: 'อาหารและเครื่องดื่ม' },
  { keywords: ['กาแฟ'], icon: CupIcon, group: 'อาหารและเครื่องดื่ม' },
  { keywords: ['แอลกอฮอล์'], icon: WineGlassIcon, group: 'อาหารและเครื่องดื่ม' },
  { keywords: ['ของหวาน'], icon: DessertIcon, group: 'อาหารและเครื่องดื่ม' },
  { keywords: ['เสิร์ฟ', 'อาหาร'], icon: FoodIcon, group: 'อาหารและเครื่องดื่ม' },
  { keywords: ['ดนตรีสด'], icon: MusicNoteIcon, group: 'บรรยากาศ' },
]

const AMENITY_GROUP_ORDER = ['ทั่วไป', 'เหมาะสำหรับ', 'บริการ', 'อาหารและเครื่องดื่ม', 'บรรยากาศ', 'อื่นๆ']

function matchAmenity(label) {
  const lower = (label || '').toLowerCase()
  return AMENITY_META.find((meta) => meta.keywords.some((k) => lower.includes(k)))
}

export function AmenityIcon({ label, size = 15, color = stroke, box = false } = {}) {
  const Icon = matchAmenity(label)?.icon || DotIcon
  return <Icon size={size} color={color} box={box} />
}

export function groupAmenities(labels) {
  const buckets = new Map()
  for (const label of labels || []) {
    const group = matchAmenity(label)?.group || 'อื่นๆ'
    if (!buckets.has(group)) buckets.set(group, [])
    buckets.get(group).push(label)
  }
  return AMENITY_GROUP_ORDER
    .filter((group) => buckets.has(group))
    .map((group) => ({ group, items: buckets.get(group) }))
}
