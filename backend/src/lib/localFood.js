// Which restaurants carry the "อาหารพื้นถิ่น" (local food) interest tag.
//
// Until 2026-10-21 every ร้านอาหาร got it (googlePlaceRow.js and
// import-places-multi.js tagged by category), so all 311 restaurants matched
// the trip form's "อาหารพื้นถิ่น" interest and the planner, ranking by
// popularity, served chains: of the top 25 for that interest only 2 were Isan
// (the rest Sukishi, สุกี้ตี๋น้อย, sushi, yakiniku, mala...).
//
// "Local" here = Isan food and everyday Thai local food (noodles, rice-and-
// curry, made-to-order, Khon Kaen's แหนมเนือง). Not: chains, buffets, shabu /
// sukiyaki / BBQ-grill, Japanese, Korean, Western, mala.
import { classifySubcategory } from './placeSubcategory.js'

export const LOCAL_FOOD_TAG = 'อาหารพื้นถิ่น'

// Isan dishes in the name: local whatever else the name says (an Isan hot
// pot place that also does หมูกระทะ is still an Isan place). A bare "ตำ" is
// skipped inside ต้นตำรับ ("original recipe"), ตำบล (sub-district) and ตำรวจ.
// "หมูย่างเกาหลี" is the Thai name for a หมูกระทะ grill, not Isan grilled pork.
const ISAN_NAME_RE = /ส้มตำ|ตำ(?!รับ|บล|รวจ)|ลาบ|ก้อย|อีสาน|ไก่ย่าง|ปลาเผา|กุ้งเผา|แจ่วฮ้อน|จิ้มจุ่ม|ซอยจุ๊|ซุปหน่อไม้|ต้มแซ่บ|แซ่บ|อ่อม|ข้าวเหนียว|หมูย่าง(?!เกาหลี)|ปลาจุ่ม|ข้าวปุ้น|ข้าวเปียก|แหนมเนือง|isan/i

// Not local: chains, buffet / hot pot / grill styles, foreign cuisines.
const NOT_LOCAL_NAME_RE = /ญี่ปุ่น|japan|sushi|ซูชิ|ราเม็ง|ramen|อุด้ง|udon|izakaya|อิซากายะ|ยากินิ|yakiniku|omakase|โอมากาเสะ|เกาหลี|korea|seoul|โซล|ชาบู|shabu|สุกี้|sukiyaki|บุฟเฟ|buffet|หม่าล่า|mala|หมูกระทะ|หมูกะทะ|ปิ้งย่าง|เนื้อย่าง|grill|bbq|barbecue|บาร์บีคิว|butcher|wagyu|steak|สเต็ก|pizza|พิซซ่า|pasta|พาสต้า|burger|เบอร์เกอร์|italian|อิตาเลียน|hot ?pot|ฮอทพอท|dim ?sum|ติ่มซำ|kfc|เคเอฟซี|mcdonald|แมคโดนัลด์|starbucks|sizzler|ซิซซ์เล่อร์|swensen|สเวนเซ่น|oishi|โออิชิ|fuji|ฟูจิ|yayoi|ยาโยอิ|bar ?b ?q|\bmk\b|เอ็มเค/i

// Everyday Thai local food in the name.
const THAI_LOCAL_NAME_RE = /ก๋วยเตี๋ยว|ก๊วยเตี๋ยว|เตี๋ยว|เย็นตาโฟ|บะหมี่|เกาเหลา|ราดหน้า|ผัดไทย|ข้าวซอย|ขนมจีน|ข้าวแกง|ตามสั่ง|กับข้าว|ข้าวมันไก่|ข้าวขาหมู|ข้าวหมูแดง|ข้าวต้ม|โจ๊ก|ปาท่องโก๋|ไข่กระทะ|ครัว|สวนอาหาร|อาหารไทย|ร้านข้าว/i

// อาหารเช้า: Khon Kaen's breakfast shops (ไข่กระทะ, Vietnamese-style bread)
// are a local thing in themselves; dim sum is caught by NOT_LOCAL_NAME_RE first.
const LOCAL_SUBCATEGORIES = new Set(['อาหารอีสาน', 'ก๋วยเตี๋ยว', 'เวียดนาม', 'อาหารเช้า'])
const LOCAL_TAGS = ['อาหารไทย', 'ส้มตำ', 'ลาบ/ก้อย', 'ปลาเผา']
// Google types turned into tags (see FOOD_TYPE_TAGS): trusted only when the
// name says nothing either way.
const NOT_LOCAL_TAGS = ['อาหารญี่ปุ่น', 'ซูชิ', 'อาหารเกาหลี', 'อาหารอิตาเลียน', 'พิซซ่า', 'เบอร์เกอร์', 'สเต็ก', 'บุฟเฟต์', 'สุกี้', 'หมูกระทะ/ปิ้งย่าง', 'บาร์', 'ผับ/บาร์']

// `tags` is the row's other tags (LOCAL_FOOD_TAG itself is ignored);
// `subcategory` the stored one, else the rule-based guess is used.
export function isLocalFood({ name, category, tags, subcategory }) {
  if (category !== 'ร้านอาหาร') return false
  const text = String(name ?? '')
  const tagList = (tags || []).filter((t) => t !== LOCAL_FOOD_TAG)
  if (ISAN_NAME_RE.test(text)) return true
  if (NOT_LOCAL_NAME_RE.test(text)) return false
  if (THAI_LOCAL_NAME_RE.test(text)) return true
  const sub = subcategory || classifySubcategory({ name: text, category, tags: tagList })
  if (LOCAL_SUBCATEGORIES.has(sub)) return true
  if (tagList.some((t) => NOT_LOCAL_TAGS.includes(t))) return false
  return tagList.some((t) => LOCAL_TAGS.includes(t))
}
