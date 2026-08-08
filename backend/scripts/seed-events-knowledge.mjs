// One-time seed: populate `events` and `knowledge_base` (both empty) with
// real, web-researched content about Khon Kaen -- the province's four major
// annual festivals, and chatbot knowledge-base articles covering the three
// categories the admin UI supports (transport, food-culture, dino).
//
// Sources checked 2026-07-27: khon_kaen.moc.go.th, khonkaenlink.info,
// th.wikipedia.org (Khon Kaen province + Phu Wiang Dinosaur Museum pages),
// khonkaen.go.th, 12go.asia.
//
// Usage: cd backend && npm run seed:events-knowledge

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy backend/.env.example to backend/.env and fill them in.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const events = [
  {
    name: 'เทศกาลไหมนานาชาติ ประเพณีผูกเสี่ยว และงานกาชาดจังหวัดขอนแก่น ประจำปี 2569',
    category: 'เทศกาลประจำปี',
    date_range: '29 พฤศจิกายน – 10 ธันวาคม 2569',
    venue_name: 'บริเวณศาลากลางจังหวัดขอนแก่น',
    admission: 'เข้าชมฟรี',
    organizer: 'จังหวัดขอนแก่น ร่วมกับสำนักงานพาณิชย์จังหวัดขอนแก่น',
    suitable_for: ['ครอบครัว', 'นักท่องเที่ยวต่างชาติ', 'ผู้สนใจผ้าไหม'],
    description: 'งานประจำปีที่ยิ่งใหญ่ที่สุดของขอนแก่น รวมนิทรรศการและออกร้านผ้าไหมมัดหมี่ พิธีผูกเสี่ยว (ผูกข้อมือสร้างสายสัมพันธ์ฉันมิตร) งานกาชาด ขบวนแห่เปิดงาน และการแสดงศิลปวัฒนธรรมอีสาน',
    status: 'upcoming',
    img: 'https://upload.wikimedia.org/wikipedia/commons/a/a3/Traditional_Thai_silk_making.jpg',
  },
  {
    name: 'งานประเพณีสุดยอดสงกรานต์อีสาน เทศกาลดอกคูนเสียงแคน และถนนข้าวเหนียว ประจำปี 2569',
    category: 'เทศกาลประจำปี',
    date_range: '11–15 เมษายน 2569',
    venue_name: 'บึงแก่นนคร และถนนข้าวเหนียว',
    admission: 'เข้าชมฟรี',
    organizer: 'เทศบาลนครขอนแก่น',
    suitable_for: ['ครอบครัว', 'วัยรุ่น', 'นักท่องเที่ยว'],
    description: 'เทศกาลสงกรานต์ที่ยิ่งใหญ่ที่สุดของภาคอีสาน มีพิธีเปิดและคอนเสิร์ตที่บึงแก่นนคร การประกวดเทพธิดาดอกคูนเสียงแคน ขบวนแห่พระพุทธรูปศักดิ์สิทธิ์จาก 20 คุ้มวัด และกิจกรรม Human Wave เล่นน้ำสงกรานต์แบบไร้แอลกอฮอล์บนถนนข้าวเหนียว',
    status: 'published',
    img: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Grand_songkran_%28Thai_New_Year_%29_Water_Festival.jpg',
  },
  {
    name: 'ประเพณีลอยกระทง บึงแก่นนคร ขอนแก่น ประจำปี 2569',
    category: 'เทศกาลประจำปี',
    date_range: '25 พฤศจิกายน 2569',
    venue_name: 'บึงแก่นนคร (และบึงหนองโคตร, บึงทุ่งสร้าง, บึงหนองแวง)',
    admission: 'เข้าชมฟรี',
    organizer: 'เทศบาลนครขอนแก่น',
    suitable_for: ['ครอบครัว', 'คู่รัก'],
    description: 'งานลอยกระทงประจำปีที่ใหญ่ที่สุดในขอนแก่น จัดขึ้นที่บึงแก่นนครและบึงสำคัญทั่วเมือง มีพิธีทำกระทง การประกวดกระทง การแสดงทางวัฒนธรรม และตลาดสินค้า OTOP',
    status: 'upcoming',
    img: 'https://upload.wikimedia.org/wikipedia/commons/4/46/Phra_Mahathat_Kaen_Nakhon_temple%2C_Khon_Kaen%2C_Thailand.jpg',
  },
  {
    name: 'งานบวงสรวงพระธาตุขามแก่น',
    category: 'ประเพณีทางศาสนา',
    date_range: 'วันเพ็ญเดือน 6 (ราวเดือนพฤษภาคม) ของทุกปี',
    venue_name: 'วัดเจติยภูมิ (พระธาตุขามแก่น) อำเภอน้ำพอง',
    admission: 'เข้าชมฟรี',
    organizer: 'จังหวัดขอนแก่น ร่วมกับวัดเจติยภูมิ',
    suitable_for: ['ครอบครัว', 'ผู้สนใจศาสนาและวัฒนธรรม'],
    description: 'พิธีบวงสรวงสักการะพระธาตุขามแก่น ปูชนียสถานศักดิ์สิทธิ์คู่บ้านคู่เมืองขอนแก่นตามคำขวัญประจำจังหวัด จัดขึ้นเป็นประจำทุกปีในวันเพ็ญเดือน 6',
    status: 'published',
    img: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Phra_That_Kham_Kaen_9102.jpg',
  },
]

const knowledgeBase = [
  {
    title: 'การเดินทางมาขอนแก่น',
    category: 'transport',
    content: 'มี 3 ทางเลือกหลัก: (1) เครื่องบิน ลงสนามบินขอนแก่น (KKC) ห่างจากตัวเมืองเพียง 8 กม. (แท็กซี่ ~15 นาที) ใช้เวลาบินจากกรุงเทพฯ ประมาณ 1 ชั่วโมง (2) รถไฟและรถทัวร์จากกรุงเทพฯ ใช้เวลาประมาณ 8-10 ชั่วโมง ราคารถทัวร์เริ่มต้นราว 443 บาท (3) รถยนต์ส่วนตัวผ่านถนนมิตรภาพ (ทล.2) ใช้เวลาประมาณ 5-6 ชั่วโมง ตัวเมืองขอนแก่นตั้งอยู่บริเวณจุดตัดถนนมิตรภาพและทางหลวงหมายเลข 12 ทำให้เป็นศูนย์กลางคมนาคมของภาคอีสาน',
    is_pinned: false,
    is_active: true,
  },
  {
    title: 'ประวัติศาสตร์และข้อมูลทั่วไปจังหวัดขอนแก่น',
    category: 'food-culture',
    content: 'ก่อตั้งเป็นเมืองในปี พ.ศ. 2340 โดยเพี้ยเมืองแพน ที่แยกตัวจากเมืองสุวรรณภูมิพร้อมไพร่พล 330 คน มาตั้งถิ่นฐาน ก่อนยกฐานะเป็นจังหวัดในปี พ.ศ. 2459 พื้นที่นี้มีร่องรอยชุมชนโบราณมานานกว่า 2,500 ปี และเคยได้รับอิทธิพลวัฒนธรรมทวารวดีช่วงพุทธศตวรรษที่ 12-16 ปัจจุบันขอนแก่นมีพื้นที่ 10,885.99 ตร.กม. (อันดับ 15 ของประเทศ) ประชากรราว 1.76 ล้านคน (อันดับ 4) คำขวัญประจำจังหวัด: "พระธาตุขามแก่น เสียงแคนดอกคูน ศูนย์รวมผ้าไหม ร่วมใจผูกเสี่ยว เที่ยวขอนแก่นนครใหญ่ ไดโนเสาร์สิรินธรเน่ สุดเท่เหรียญทองมวยโอลิมปิก" ต้นไม้ประจำจังหวัด: กัลปพฤกษ์ ดอกไม้ประจำจังหวัด: ราชพฤกษ์',
    is_pinned: true,
    is_active: true,
  },
  {
    title: 'ผ้าไหมขอนแก่น สินค้าขึ้นชื่อประจำจังหวัด',
    category: 'food-culture',
    content: 'ขอนแก่นได้ชื่อว่าเป็น "ศูนย์รวมผ้าไหม" ตามคำขวัญประจำจังหวัด เป็นแหล่งผลิตและจำหน่ายผ้าไหมมัดหมี่คุณภาพสูงที่มีชื่อเสียงระดับประเทศ โดยเฉพาะผ้าไหมจากอำเภอชนบท ทุกปีจังหวัดจัดงานเทศกาลไหมนานาชาติ ประเพณีผูกเสี่ยว และงานกาชาดจังหวัดขอนแก่น เพื่อเฉลิมฉลองและส่งเสริมสินค้าผ้าไหมท้องถิ่น ควบคู่กับพิธีผูกเสี่ยวและกิจกรรมกาชาด',
    is_pinned: false,
    is_active: true,
  },
  {
    title: 'เทศกาลและประเพณีสำคัญประจำปีของขอนแก่น',
    category: 'food-culture',
    content: 'ขอนแก่นมีเทศกาลใหญ่ตลอดทั้งปี ได้แก่ งานบวงสรวงพระธาตุขามแก่นในวันเพ็ญเดือน 6 (พฤษภาคม), งานประเพณีสุดยอดสงกรานต์อีสาน เทศกาลดอกคูนเสียงแคนและถนนข้าวเหนียวช่วงเมษายน, ประเพณีลอยกระทงที่บึงแก่นนครในเดือนพฤศจิกายน และเทศกาลไหมนานาชาติ ประเพณีผูกเสี่ยว และงานกาชาดจังหวัดขอนแก่นช่วงปลายพฤศจิกายนถึงต้นธันวาคม ดูรายละเอียดวันที่และสถานที่จัดงานแต่ละงานได้ในหน้าอีเวนท์',
    is_pinned: false,
    is_active: true,
  },
  {
    title: 'ไดโนเสาร์ภูเวียง และพิพิธภัณฑ์ไดโนเสาร์ภูเวียง',
    category: 'dino',
    content: 'ขอนแก่นเป็นจังหวัดแรกของไทยที่พบฟอสซิลไดโนเสาร์ โดยพบครั้งแรกที่อำเภอภูเวียงเมื่อปี พ.ศ. 2519 โดยนายสุธรรม แย้มนิยม นักธรณีวิทยากรมทรัพยากรธรณี ขณะสำรวจแร่ยูเรเนียมที่ห้วยประตูตีหมา ต่อมาพบไดโนเสาร์สกุลและชนิดใหม่ของโลกคือ "ภูเวียงโกซอรัส สิรินธรเน" (Phuwiangosaurus sirindhornae) ไดโนเสาร์ซอโรพอดกินพืชคอยาว ยาว 15-20 เมตร อายุราว 130 ล้านปี ได้รับพระราชทานพระราชานุญาตให้อัญเชิญพระนามาภิไธยสมเด็จพระกนิษฐาธิราชเจ้า กรมสมเด็จพระเทพรัตนราชสุดาฯ มาตั้งเป็นชื่อชนิด จังหวัดจึงเปิด "พิพิธภัณฑ์ไดโนเสาร์ภูเวียง" ในปี พ.ศ. 2544 เป็นพิพิธภัณฑ์ไดโนเสาร์แห่งแรกของประเทศไทย ตั้งอยู่ในเขตอุทยานแห่งชาติภูเวียง',
    is_pinned: false,
    is_active: true,
  },
]

async function main() {
  console.log(`Seeding ${events.length} events...`)
  const { data: eventRows, error: eventError } = await supabase
    .from('events')
    .insert(events)
    .select('id, name, status')

  if (eventError) {
    console.error('Event insert failed:', eventError.message)
    process.exit(1)
  }
  console.log(`Inserted ${eventRows.length} events.`)

  console.log(`Seeding ${knowledgeBase.length} knowledge_base articles...`)
  const { data: kbRows, error: kbError } = await supabase
    .from('knowledge_base')
    .insert(knowledgeBase)
    .select('id, title, category')

  if (kbError) {
    console.error('Knowledge base insert failed:', kbError.message)
    process.exit(1)
  }
  console.log(`Inserted ${kbRows.length} knowledge_base articles.`)
}

main()
