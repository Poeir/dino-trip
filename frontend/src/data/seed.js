// UI constants shared by the filters, the trip form and the admin sidebar.
// (This file used to also carry the prototype's sample places/events/QRs,
// built from a 400KB Google Places dump that was bundled into every visitor's
// download; nothing used them -- real data comes from the API.)

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
  { key: 'reports', label: 'รายงานข้อมูล', icon: 'reports' },
  { key: 'events', label: 'กิจกรรม', icon: 'events' },
  { key: 'event-requests', label: 'คำขอกิจกรรม', icon: 'events' },
  { key: 'knowledge', label: 'ฐานความรู้', icon: 'knowledge' },
  { key: 'qr', label: 'QR & พอยท์', icon: 'qr' },
  { key: 'redeem', label: 'แลกของรางวัล', icon: 'redeem' },
  { key: 'users', label: 'ผู้ใช้', icon: 'users' },
  { key: 'trips', label: 'ทริป', icon: 'trips' }
]
