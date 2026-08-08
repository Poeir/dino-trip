import { placesFromGoogle } from './googlePlacesTransform.js'
import { haversineKm } from '../utils/geo.js'

export const initialPlaces = placesFromGoogle

export const initialEvents = [
  { id: 'e1', name: 'เทศกาลไหมนานาชาติ ประเพณีผูกเสี่ยว และงานกาชาดจังหวัดขอนแก่น', category: 'เทศกาลวัฒนธรรม', dateRange: '29 พ.ย. - 10 ธ.ค. 2569', venueName: 'สนามหน้าศาลากลางจังหวัดขอนแก่น', admission: 'เข้าชมฟรี', organizer: 'จังหวัดขอนแก่น', suitableFor: ['ครอบครัว', 'ผู้สูงอายุ', 'นักท่องเที่ยวต่างชาติ'], status: 'upcoming', desc: 'งานประจำปีที่รวมการแสดงผ้าไหมมัดหมี่ ขบวนแห่ประเพณีผูกเสี่ยว และการออกร้านกาชาด', img: './assets/picture02.jpg' },
  { id: 'e2', name: 'ขอนแก่น ไดโนเสาร์ เฟสติวัล', category: 'เทศกาลไดโนเสาร์', dateRange: '14-16 ส.ค. 2569', venueName: 'บึงแก่นนคร', admission: 'เด็ก 50 บาท / ผู้ใหญ่ 100 บาท', organizer: 'เทศบาลนครขอนแก่น', suitableFor: ['เด็ก', 'ครอบครัว'], status: 'upcoming', desc: 'งานรวมโมเดลไดโนเสาร์ขนาดเท่าจริง กิจกรรมขุดฟอสซิลจำลอง และเวิร์กชอปสำหรับเด็ก', img: './assets/picture02.jpg' },
  { id: 'e3', name: 'ค่ำคืนดนตรีในสวน บึงแก่นนคร', category: 'คอนเสิร์ต', dateRange: '22 ส.ค. 2569 18:00-21:00', venueName: 'บึงแก่นนคร', admission: 'เข้าชมฟรี', organizer: 'การท่องเที่ยวแห่งประเทศไทย สนง.ขอนแก่น', suitableFor: ['วัยทำงาน', 'คู่รัก'], status: 'upcoming', desc: 'คอนเสิร์ตดนตรีโฟล์คริมบึงยามเย็น พร้อมตลาดอาหารท้องถิ่น', img: './assets/picture02.jpg' }
]

export const initialKnowledgeBase = [
  { id: 'kb1', title: 'การเดินทางเข้าสู่ขอนแก่น', category: 'transport', content: 'สนามบินขอนแก่นอยู่ห่างจากตัวเมือง 8 กม. มีรถแท็กซี่และรถสาธารณะให้บริการ', isPinned: true, isActive: true },
  { id: 'kb2', title: 'อาหารพื้นถิ่นขอนแก่นที่ต้องลอง', category: 'food-culture', content: 'ส้มตำ ลาบ ก้อยดิบ และไก่ย่างขอนแก่น เป็นเมนูที่ไม่ควรพลาด', isPinned: false, isActive: true },
  { id: 'kb3', title: 'ประวัติไดโนเสาร์ภูเวียง', category: 'dino', content: 'แหล่งขุดค้นภูเวียงพบซากไดโนเสาร์กินพืชสายพันธุ์ใหม่ของโลกหลายชนิด', isPinned: true, isActive: true }
]

export const initialRewards = [
  { id: 'r1', name: 'ส่วนลดค่าเข้าพิพิธภัณฑ์ไดโนเสาร์ 50%', cost: 30 },
  { id: 'r2', name: 'แก้วน้ำที่ระลึกน้องไดโน', cost: 60 },
  { id: 'r3', name: 'คูปองอาหารพื้นถิ่น 100 บาท', cost: 100 }
]

export const initialQrs = initialPlaces
  .filter((p) => p.hasQR)
  .map((p) => ({ id: `qr-${p.id}`, placeId: p.id, points: p.qrPoints }))

function toDayItems(placesArr, times) {
  let prev = null
  return placesArr.map((p, i) => {
    const distanceFromPrev = prev ? haversineKm(prev.location, p.location) : null
    prev = p
    return { placeId: p.id, time: times[i], liked: null, distanceFromPrev }
  })
}

export function buildSampleTripPlan(places) {
  const pick = (cat) => places.find((p) => p.category === cat)
  const day1 = [pick('วัด'), pick('คาเฟ่'), pick('สวนสาธารณะ')].filter(Boolean)
  const day2 = [pick('ร้านอาหาร'), pick('สถานที่ท่องเที่ยว')].filter(Boolean)
  const days = []
  if (day1.length) days.push({ dayNum: 1, date: '2026-08-14', items: toDayItems(day1, ['09:00', '12:30', '15:30']) })
  if (day2.length) days.push({ dayNum: 2, date: '2026-08-15', items: toDayItems(day2, ['09:30', '13:00', '16:00']) })
  const flat = days.flatMap((d) => d.items)
  const totalBudget = flat.length * 350
  const totalDistance = flat.reduce((sum, it) => sum + (it.distanceFromPrev || 0), 0).toFixed(1)
  const totalPoints = flat.reduce((sum, it) => { const p = places.find((pp) => pp.id === it.placeId); return sum + (p && p.hasQR ? p.qrPoints : 0) }, 0)
  return { days, totalBudget, totalDistance, totalPoints }
}

export const categories = ['ทั้งหมด', 'คาเฟ่', 'วัด', 'พิพิธภัณฑ์', 'สวนสาธารณะ', 'อุทยานแห่งชาติ', 'ตลาด', 'สถานที่ท่องเที่ยว', 'ร้านอาหาร']
export const categoryIcons = { 'ทั้งหมด': 'grid', 'คาเฟ่': 'cup', 'วัด': 'temple', 'พิพิธภัณฑ์': 'museum', 'สวนสาธารณะ': 'tree', 'อุทยานแห่งชาติ': 'mountain', 'ตลาด': 'basket', 'สถานที่ท่องเที่ยว': 'camera', 'ร้านอาหาร': 'food' }
export const interestList = ['ธรรมชาติ', 'วัฒนธรรม/ศาสนา', 'ไดโนเสาร์', 'อาหารพื้นถิ่น', 'คาเฟ่', 'ช้อปปิ้ง/หัตถกรรม', 'ครอบครัว']
export const budgetList = ['ประหยัด', 'ปานกลาง', 'หรูหรา']
export const budgetMeta = { 'ประหยัด': 'เดินทางคุ้มค่า เน้นที่เที่ยวไม่มีค่าใช้จ่าย', 'ปานกลาง': 'สมดุลระหว่างคุณภาพและราคา', 'หรูหรา': 'เน้นความสะดวกสบายระดับพรีเมียม' }
export const areaScopeList = ['เมือง', 'ทั่วขอนแก่น']
export const areaScopeMeta = { 'เมือง': 'เฉพาะในตัวเมืองขอนแก่น', 'ทั่วขอนแก่น': 'รวมสถานที่รอบนอกด้วย เช่น ภูเวียง, อุบลรัตน์' }
export const adminTabs = [
  { key: 'dashboard', label: 'แดชบอร์ด', icon: 'dashboard' },
  { key: 'places', label: 'สถานที่', icon: 'places' },
  { key: 'events', label: 'กิจกรรม', icon: 'events' },
  { key: 'knowledge', label: 'ฐานความรู้', icon: 'knowledge' },
  { key: 'qr', label: 'QR & พอยท์', icon: 'qr' }
]
