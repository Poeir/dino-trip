// Controlled vocabulary for the admin "amenities"/"tags" pickers on places
// (PlacesTab.jsx), mirrored from the fixed Thai strings Google-imported
// places get assigned automatically -- see backend/scripts/import-places.js:
//   - AMENITY_OPTIONS <- mapAmenities()
//   - TAG_OPTIONS <- mapTags()'s category rules + FOOD_TYPE_TAGS + NAME_KEYWORD_TAGS
//
// Letting the admin pick from these instead of typing free text keeps
// admin-added places searchable/filterable the same way Google-imported
// ones are (trip-planner interest filter, RAG tag matching) -- a typo like
// "มีที่จอดรถ" instead of "ที่จอดรถ" silently becomes an orphan tag that
// never matches anything. If import-places.js's lists change, update here
// too so the two don't drift apart.
export const AMENITY_OPTIONS = [
  'ที่จอดรถ', 'ทางลาดผู้พิการ', 'ห้องน้ำ', 'ที่นั่งกลางแจ้ง', 'เหมาะสำหรับเด็ก',
  'พาสัตว์เลี้ยงเข้าได้', 'บริการเดลิเวอรี่', 'สั่งกลับบ้านได้', 'จองโต๊ะล่วงหน้าได้', 'ชำระผ่านบัตร',
  'มีเมนูมังสวิรัติ', 'เสิร์ฟอาหารเช้า', 'เสิร์ฟมื้อกลางวัน', 'เสิร์ฟมื้อเย็น', 'เสิร์ฟบรันช์',
  'นั่งทานในร้านได้', 'มีกาแฟ', 'มีเครื่องดื่มแอลกอฮอล์', 'มีของหวาน', 'มีเมนูสำหรับเด็ก',
  'มีดนตรีสด', 'เหมาะสำหรับกลุ่มใหญ่', 'เหมาะสำหรับดูกีฬา', 'รับที่รถได้',
]

export const TAG_OPTIONS = [
  'วัฒนธรรม/ศาสนา', 'ธรรมชาติ', 'คาเฟ่', 'อาหารพื้นถิ่น', 'ครอบครัว',
  'หมูกระทะ/ปิ้งย่าง', 'บุฟเฟต์', 'อาหารทะเล', 'อาหารไทย', 'อาหารญี่ปุ่น', 'ซูชิ',
  'อาหารเวียดนาม', 'อาหารจีน', 'อาหารเกาหลี', 'อาหารอิตาเลียน', 'พิซซ่า', 'เบอร์เกอร์',
  'สเต็ก', 'อาหารเช้า', 'มังสวิรัติ', 'วีแกน', 'ของหวาน', 'เบเกอรี่', 'บาร์', 'ผับ/บาร์',
  'สุกี้', 'ลาบ/ก้อย', 'ส้มตำ', 'ปลาเผา', 'ไดโนเสาร์', 'ช้อปปิ้ง/หัตถกรรม',
]
