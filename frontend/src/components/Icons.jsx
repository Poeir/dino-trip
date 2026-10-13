import {
  Accessibility, Armchair, BedDouble, Briefcase, Building2, Calendar, CalendarCheck, Camera, Car,
  Circle, Clock, Coffee, CreditCard, Footprints, Gift, Heart, IceCreamCone, LayoutGrid, Landmark,
  Leaf, Lock, Mail, MapPin, MonitorPlay, Mountain, Music, PawPrint, Pencil, Phone, Route, Share2,
  ShoppingBag, ShoppingBasket, Smile, SquareCheck, SquareParking, Sparkles, Star, Store, Toilet,
  TreePine, Truck, Umbrella, User, UserRound, Users, VenusAndMars, Wallet, Wifi, Wine, Utensils,
  Zap, ZoomIn,
} from 'lucide-react'

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

// Builds an icon component with the project's original props: size, color, box.
function make(Lucide, { filled = false, defaultSize = 24, defaultBox = true } = {}) {
  return function Icon({ size = defaultSize, color = stroke, box = defaultBox } = {}) {
    return wrap(
      <Lucide size={size} color={color} strokeWidth={sw} fill={filled ? color : 'none'} />,
      box
    )
  }
}

export const CalendarIcon = make(Calendar)
export const SparkleAIIcon = make(Sparkles, { filled: true, defaultSize: 16, defaultBox: false })
export const PinIcon = make(MapPin)
export const HeartIcon = make(Heart)
export const WalletIcon = make(Wallet)
export const ClockIcon = make(Clock)
export const GiftIcon = make(Gift)
export const ChecklistIcon = make(SquareCheck)
export const StarIcon = make(Star)
export const PhoneIcon = make(Phone)
export const UserIcon = make(User)
export const GenderIcon = make(VenusAndMars)
export const BriefcaseIcon = make(Briefcase)
export const MailIcon = make(Mail)
export const LockIcon = make(Lock)
export const ZoomIcon = make(ZoomIn)
export const RouteIcon = make(Route)
export const PencilIcon = make(Pencil)
export const ShareArrowIcon = make(Share2)
export const ParkingIcon = make(SquareParking)
export const WifiIcon = make(Wifi)
export const CardIcon = make(CreditCard)
export const AccessibilityIcon = make(Accessibility)
export const ShopIcon = make(Store)
export const GuideIcon = make(UserRound)
export const RunIcon = make(Footprints)
export const FoodIcon = make(Utensils)
export const BoltIcon = make(Zap)
export const CameraIcon = make(Camera)
export const GridIcon = make(LayoutGrid)
export const CupIcon = make(Coffee)
export const TempleIcon = make(Landmark)
export const MuseumIcon = make(Building2)
export const TreeIcon = make(TreePine)
export const MountainIcon = make(Mountain)
export const BasketIcon = make(ShoppingBasket)
export const BedIcon = make(BedDouble)
export const DotIcon = make(Circle, { filled: true })
export const RestroomIcon = make(Toilet)
export const OutdoorSeatIcon = make(Umbrella)
export const SmileyIcon = make(Smile)
export const PawIcon = make(PawPrint)
export const DeliveryIcon = make(Truck)
export const TakeoutBagIcon = make(ShoppingBag)
export const ReserveIcon = make(CalendarCheck)
export const TableIcon = make(Armchair)
export const LeafIcon = make(Leaf)
export const WineGlassIcon = make(Wine)
export const DessertIcon = make(IceCreamCone)
export const MusicNoteIcon = make(Music)
export const GroupIcon = make(Users)
export const ScreenSportsIcon = make(MonitorPlay)
export const CarIcon = make(Car)

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

// Inline replacement for the ★ / ☆ text glyphs next to ratings; takes its
// colour and size from the surrounding text.
export function StarGlyph({ size = 13, filled = true } = {}) {
  return <Star size={size} strokeWidth={filled ? 0 : 2} fill={filled ? 'currentColor' : 'none'} style={{ verticalAlign: '-0.14em' }} aria-hidden="true" />
}
