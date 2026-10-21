// UI constants shared by the filters, the trip form and the admin sidebar.
// (This file used to also carry the prototype's sample places/events/QRs,
// built from a 400KB Google Places dump that was bundled into every visitor's
// download; nothing used them -- real data comes from the API.)

export const categories = ['ทั้งหมด', 'คาเฟ่', 'วัด', 'พิพิธภัณฑ์', 'สวนสาธารณะ', 'อุทยานแห่งชาติ', 'ตลาด', 'ห้างสรรพสินค้า', 'ร้านของฝาก', 'สถานที่ท่องเที่ยว', 'ร้านอาหาร']
export const categoryIcons = { 'ทั้งหมด': 'grid', 'คาเฟ่': 'cup', 'วัด': 'temple', 'พิพิธภัณฑ์': 'museum', 'สวนสาธารณะ': 'tree', 'อุทยานแห่งชาติ': 'mountain', 'ตลาด': 'basket', 'ห้างสรรพสินค้า': 'basket', 'ร้านของฝาก': 'basket', 'สถานที่ท่องเที่ยว': 'camera', 'ร้านอาหาร': 'food' }
export const interestList = ['ธรรมชาติ', 'วัฒนธรรม/ศาสนา', 'ไดโนเสาร์', 'คาเฟ่', 'ช้อปปิ้ง/หัตถกรรม', 'ครอบครัว']
// "อยากกินอะไร" on the trip form -> chatbot-service TripInput.food_preferences
// (keys of FOOD_PREFERENCES in trip_planner/models.py; they pick restaurants
// by places.subcategory). "อาหารพื้นถิ่น" used to be an interest; it is
// "อาหารอีสาน" here now, and old saved trips are mapped over (AppContext).
// "อาหารเช้า" adds a breakfast stop at a breakfast shop to days starting by ~09:00.
export const foodPreferenceList = ['อาหารอีสาน', 'ก๋วยเตี๋ยว', 'ปิ้งย่าง/ชาบู', 'ญี่ปุ่น/เกาหลี', 'เวียดนาม', 'อาหารเช้า', 'เบเกอรี่/ของหวาน']
export const LEGACY_LOCAL_FOOD_INTEREST = 'อาหารพื้นถิ่น'
export const budgetList = ['ประหยัด', 'ปานกลาง', 'หรูหรา']
export const budgetMeta = { 'ประหยัด': 'เดินทางคุ้มค่า เน้นที่เที่ยวไม่มีค่าใช้จ่าย', 'ปานกลาง': 'สมดุลระหว่างคุณภาพและราคา', 'หรูหรา': 'เน้นความสะดวกสบายระดับพรีเมียม' }
export const areaScopeList = ['เมือง', 'ทั่วขอนแก่น']
export const areaScopeMeta = { 'เมือง': 'เฉพาะในตัวเมืองขอนแก่น', 'ทั่วขอนแก่น': 'รวมสถานที่รอบนอกด้วย เช่น ภูเวียง, อุบลรัตน์' }
// "วันสุดท้ายจบที่" on the trip form -> chatbot-service TripInput.trip_end
// (kinds in trip_planner/models.py TRIP_END_KINDS, hub coordinates and the
// buffers in trip_ends.py -- keep `buffer` equal to DEPARTURE_BUFFER_MINUTES).
// 'hotel' is the form's own default and is sent as trip_end: null.
export const tripEndOptions = [
  { kind: 'hotel', label: 'กลับจุดเริ่มต้น', timeLabel: null, buffer: 0 },
  { kind: 'airport', label: 'สนามบินขอนแก่น', timeLabel: 'เครื่องออกกี่โมง', buffer: 90 },
  { kind: 'bus', label: 'บขส. แห่งที่ 3', timeLabel: 'รถออกกี่โมง', buffer: 30 },
  { kind: 'train', label: 'สถานีรถไฟขอนแก่น', timeLabel: 'รถไฟออกกี่โมง', buffer: 30 },
  { kind: 'district', label: 'อำเภออื่น', timeLabel: 'ต้องถึงก่อนกี่โมง (ไม่ใส่ก็ได้)', buffer: 0 },
  { kind: 'pin', label: 'ปักหมุดเอง', timeLabel: 'ต้องถึงก่อนกี่โมง (ไม่ใส่ก็ได้)', buffer: 0 },
]
// Khon Kaen's 26 อำเภอ, for "จบทริปที่อำเภอ..." (chatbot-service takes the
// centre of the district's places; Mueang is left out, it's where trips start).
export const khonKaenDistricts = [
  'กระนวน', 'เขาสวนกวาง', 'โคกโพธิ์ไชย', 'ชนบท', 'ชุมแพ', 'ซำสูง', 'น้ำพอง', 'โนนศิลา', 'บ้านฝาง',
  'บ้านแฮด', 'บ้านไผ่', 'เปือยน้อย', 'พระยืน', 'พล', 'ภูผาม่าน', 'ภูเวียง', 'มัญจาคีรี', 'เวียงเก่า',
  'แวงน้อย', 'แวงใหญ่', 'สีชมพู', 'หนองนาคำ', 'หนองเรือ', 'หนองสองห้อง', 'อุบลรัตน์',
]
// Longest trip the form offers ("เที่ยวกี่วัน" buttons). A real 5-day plan took
// ~90 s to generate (2026-10-22) and was already running short of in-town
// places; chatbot-service accepts up to 7 (TripInput.trip_duration_days).
export const MAX_TRIP_DAYS = 5
// From this many days the loading page warns that planning takes a while.
export const LONG_TRIP_DAYS = 4
// A last day with less than this left before it must leave gets no stops
// (trip_ends.MIN_PLANNED_DAY_MINUTES); a one-day trip like that is rejected.
export const MIN_PLANNED_DAY_MINUTES = 90
// `icon` is a key into AdminSidebar's lucide icon map; `group` is the sidebar
// section heading (consecutive tabs with the same group are rendered together).
export const adminTabs = [
  { key: 'dashboard', label: 'แดชบอร์ด', icon: 'dashboard', group: 'ภาพรวม' },
  { key: 'places', label: 'สถานที่', icon: 'places', group: 'เนื้อหา' },
  { key: 'events', label: 'กิจกรรม', icon: 'events', group: 'เนื้อหา' },
  { key: 'knowledge', label: 'ฐานความรู้แชทบอท', icon: 'knowledge', group: 'เนื้อหา' },
  { key: 'reports', label: 'รายงานข้อมูล', icon: 'reports', group: 'คิวตรวจสอบ' },
  { key: 'event-requests', label: 'คำขอกิจกรรม', icon: 'event-requests', group: 'คิวตรวจสอบ' },
  { key: 'qr', label: 'QR Code', icon: 'qr', group: 'พอยท์และรางวัล' },
  { key: 'rewards', label: 'ของรางวัล', icon: 'rewards', group: 'พอยท์และรางวัล' },
  { key: 'redeem', label: 'แลกที่เคาน์เตอร์', icon: 'redeem', group: 'พอยท์และรางวัล' },
  { key: 'users', label: 'ผู้ใช้', icon: 'users', group: 'ผู้ใช้และการใช้งาน' },
  { key: 'trips', label: 'ทริป', icon: 'trips', group: 'ผู้ใช้และการใช้งาน' },
  { key: 'survey', label: 'ความพึงพอใจ', icon: 'survey', group: 'ผู้ใช้และการใช้งาน' }
]

// places.subcategory options per category -- keep in step with SUBCATEGORIES in
// backend/src/lib/placeSubcategory.js.
export const SUBCATEGORIES = {
  'ร้านอาหาร': ['อาหารอีสาน', 'ปิ้งย่าง/ชาบู', 'ก๋วยเตี๋ยว', 'ญี่ปุ่น/เกาหลี', 'อาหารเช้า', 'เวียดนาม', 'อื่นๆ'],
  'คาเฟ่': ['เบเกอรี่/ของหวาน', 'บาร์/bistro', 'คาเฟ่ทั่วไป'],
}
