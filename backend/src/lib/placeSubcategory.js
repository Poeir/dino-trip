// Sub-types for the two food categories. Keep in step with SUBCATEGORIES in
// frontend/src/data/seed.js. Order of RULES matters: the first match wins, so
// specific cuisines come before the broad ones (Korean BBQ -> ญี่ปุ่น/เกาหลี,
// not ปิ้งย่าง/ชาบู).
export const SUBCATEGORIES = {
  'ร้านอาหาร': ['อาหารอีสาน', 'ปิ้งย่าง/ชาบู', 'ก๋วยเตี๋ยว', 'ญี่ปุ่น/เกาหลี', 'อาหารเช้า', 'เวียดนาม', 'อื่นๆ'],
  'คาเฟ่': ['เบเกอรี่/ของหวาน', 'บาร์/bistro', 'คาเฟ่ทั่วไป'],
}

export function isValidSubcategory(category, value) {
  return !!SUBCATEGORIES[category]?.includes(value)
}

// Matched against the name only for cuisines; `tags` (Google-derived, known to
// be noisy, e.g. a หมูกระทะ shop tagged "อาหารญี่ปุ่น") are used only where the
// tag is specific enough to trust.
const RULES = {
  'ร้านอาหาร': [
    ['เวียดนาม', /เวียดนาม|แหนมเนือง|ปากหม้อ|เฝอ|ญวน|viet/i, ['อาหารเวียดนาม']],
    ['ญี่ปุ่น/เกาหลี', /ญี่ปุ่น|japan|sushi|ซูชิ|ราเม็ง|ramen|อุด้ง|udon|izakaya|อิซากายะ|ยากินิ[กค]ุ?|yakiniku|omakase|โอมากาเสะ|เกาหลี|korea|seoul|โซล|แดจังกึม|kimchi|กิมจิ/i, ['ซูชิ']],
    ['ปิ้งย่าง/ชาบู', /หมูกระทะ|หมูกะทะ|ชาบู|shabu|สุกี้|sukiyaki|ปิ้งย่าง|บุฟเฟ|buffet|bbq|barbecue|บาร์บีคิว|เนื้อย่าง|จิ้มจุ่ม|หมูจุ่ม|หม่าล่า|แจ่วฮ้อน|grill|butcher|wagyu/i, ['หมูกระทะ/ปิ้งย่าง', 'สุกี้', 'บุฟเฟต์']],
    ['ก๋วยเตี๋ยว', /ก๋วยเตี๋ยว|ก๊วยเตี๋ยว|เตี๋ยว|เย็นตาโฟ|บะหมี่|เกาเหลา|ราดหน้า|ผัดไทย|noodle|ข้าวซอย/i, []],
    ['อาหารเช้า', /อาหารเช้า|โจ๊ก|ติ่มซำ|dim ?sum|ปาท่องโก๋|breakfast|brunch/i, ['อาหารเช้า']],
    ['อาหารอีสาน', /ส้มตำ|ตำนัว|ตำกระเทย|อีสาน|ลาบ|ก้อย|ไก่ย่าง|ปลาเผา|กุ้งเผา|ซุปหน่อไม้|ซอยจุ๊|isan|หมูย่าง|แซ่บ|นัว/i, ['ส้มตำ', 'ลาบ/ก้อย', 'ปลาเผา']],
  ],
  'คาเฟ่': [
    ['บาร์/bistro', /\bbar\b|cafebar|pub\b|บาร์|ผับ|bistro|บิสโทร|beer|เบียร์/i, ['บาร์', 'ผับ/บาร์'], /milk ?bar/i],
    ['เบเกอรี่/ของหวาน', /bakery|bake|เบเกอรี|cake|เค้ก|ขนม|ไอศกรีม|ice ?cream|dessert|ของหวาน|โรตี|waffle|วาฟเฟิล|donut|โดนัท|croissant|ครัวซองต์|bingsu|บิงซู|พาย|cookie|คุกกี้|gelato|bread|pastry|crepe|เครป/i, ['เบเกอรี่', 'ของหวาน']],
  ],
}

// Rule-based first pass. Returns a subcategory, or null when no rule is sure
// (the caller leaves it for the LLM pass / an admin).
export function classifySubcategory({ name, category, tags }) {
  const rules = RULES[category]
  if (!rules) return null
  const text = String(name ?? '')
  const tagList = tags || []
  for (const [label, nameRe, specificTags, nameExclude] of rules) {
    if (nameExclude?.test(text)) continue
    if (nameRe.test(text) || tagList.some((t) => specificTags.includes(t))) return label
  }
  return null
}
