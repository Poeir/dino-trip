// The satisfaction questionnaire (16 Likert items + 3 demographics + 4 prior-experience items). Single
// source of truth: the public form fetches it from GET /api/survey/questions
// and the admin summary labels its tables from it. Question numbers map to the
// q1..q16 columns of `survey_responses` (migration 20261010000001) -- keep both
// in step if the wording or count ever changes.

export const SCALE = [
  { value: 5, label: 'มากที่สุด' },
  { value: 4, label: 'มาก' },
  { value: 3, label: 'ปานกลาง' },
  { value: 2, label: 'น้อย' },
  { value: 1, label: 'น้อยที่สุด' },
]

export const DIMENSIONS = [
  { key: 'function', label: 'ด้านการทำงานของระบบ' },
  { key: 'chatbot', label: 'ด้านแชทบอท AI' },
  { key: 'planner', label: 'ด้านการวางแผนเที่ยวด้วย AI' },
  { key: 'usability', label: 'ด้านความง่ายในการใช้งาน' },
  { key: 'design', label: 'ด้านการออกแบบและประสิทธิภาพ' },
  { key: 'overall', label: 'ด้านความพึงพอใจโดยรวม' },
]

// Worded as noun phrases to match the satisfaction scale ("ความง่ายในการใช้งาน
// ... มาก"). `skippable` questions are about a feature a respondent may never
// have used (chatbot, trip planner): they may answer "ยังไม่เคยใช้" (null), which
// is left out of that question's statistics instead of being forced into 1-5.
export const QUESTIONS = [
  { no: 1, dimension: 'function', text: 'ความครอบคลุมของฟีเจอร์สำหรับการวางแผนท่องเที่ยว' },
  { no: 2, dimension: 'function', text: 'ความถูกต้องของข้อมูลสถานที่ท่องเที่ยว' },
  { no: 3, dimension: 'function', text: 'ความตรงกับความต้องการของผลการค้นหาสถานที่' },
  { no: 4, dimension: 'chatbot', text: 'ความตรงกับคำถามของคำตอบจากแชทบอท', skippable: true },
  { no: 5, dimension: 'chatbot', text: 'ความน่าเชื่อถือของข้อมูลจากแชทบอท', skippable: true },
  { no: 6, dimension: 'chatbot', text: 'ความรวดเร็วในการตอบของแชทบอท', skippable: true },
  { no: 7, dimension: 'planner', text: 'ความเหมาะสมของแผนเที่ยวกับความสนใจของท่าน', skippable: true },
  { no: 8, dimension: 'planner', text: 'ความเป็นไปได้ในการทำตามตารางเวลาของแผนเที่ยว', skippable: true },
  { no: 9, dimension: 'planner', text: 'การช่วยประหยัดเวลาในการวางแผนเที่ยว', skippable: true },
  { no: 10, dimension: 'planner', text: 'ความรวดเร็วในการสร้างแผนเที่ยว', skippable: true },
  { no: 11, dimension: 'usability', text: 'ความง่ายในการใช้งานระบบ' },
  { no: 12, dimension: 'usability', text: 'ความง่ายในการค้นหาข้อมูลที่ต้องการ' },
  { no: 13, dimension: 'design', text: 'ความสวยงามของการออกแบบหน้าจอ' },
  { no: 14, dimension: 'design', text: 'ความเร็วในการโหลดหน้าเว็บ' },
  { no: 15, dimension: 'overall', text: 'ความพึงพอใจโดยรวมต่อระบบ' },
  { no: 16, dimension: 'overall', text: 'ความตั้งใจที่จะแนะนำระบบให้ผู้อื่น' },
]

// Mirrors the CHECK constraints on survey_responses.
export const DEMOGRAPHICS = [
  {
    key: 'gender', column: 'gender', label: 'เพศ',
    options: [
      { value: 'male', label: 'ชาย' },
      { value: 'female', label: 'หญิง' },
      { value: 'unspecified', label: 'ไม่ระบุ' },
    ],
  },
  {
    // Respondents pick an exact age; the group is derived from it (ageGroupOf)
    // so the report can still show the usual brackets. `derived` = no input of its own.
    key: 'ageGroup', column: 'age_group', label: 'อายุ', derived: true,
    options: [
      { value: 'under20', label: 'ต่ำกว่า 20 ปี' },
      { value: '20-29', label: '20–29 ปี' },
      { value: '30-39', label: '30–39 ปี' },
      { value: '40plus', label: '40 ปีขึ้นไป' },
    ],
  },
  {
    key: 'occupation', column: 'occupation', label: 'อาชีพ',
    options: [
      { value: 'student', label: 'นักศึกษา' },
      { value: 'staff', label: 'บุคลากร' },
      { value: 'tourist', label: 'นักท่องเที่ยวทั่วไป' },
      { value: 'other', label: 'อื่น ๆ' },
    ],
  },
]

// Short "before using Dino" questions (single choice, not scored). They give the
// report a baseline (how people plan trips today, prior AI use, time spent) and
// let satisfaction be compared between groups. Same shape as DEMOGRAPHICS.
export const EXPERIENCE = [
  {
    key: 'planMethod', column: 'exp_plan_method', label: 'ก่อนใช้ Dino ท่านวางแผนเที่ยวด้วยวิธีใดเป็นหลัก',
    options: [
      { value: 'search', label: 'ค้นหาจากเว็บไซต์/Google' },
      { value: 'social', label: 'โซเชียลมีเดีย/รีวิว (Facebook, TikTok, Instagram)' },
      { value: 'maps', label: 'Google Maps' },
      { value: 'friends', label: 'สอบถามเพื่อนหรือคนรู้จัก' },
      { value: 'app', label: 'แอป/เว็บวางแผนเที่ยวโดยเฉพาะ' },
      { value: 'ai', label: 'ใช้ AI เช่น ChatGPT, Gemini' },
      { value: 'none', label: 'ไม่ได้วางแผน ไปตามสถานการณ์' },
    ],
  },
  {
    key: 'planTime', column: 'exp_plan_time', label: 'โดยปกติท่านใช้เวลาวางแผนเที่ยวหนึ่งครั้งประมาณเท่าใด',
    options: [
      { value: 'lt30m', label: 'น้อยกว่า 30 นาที' },
      { value: '30m-1h', label: '30 นาที – 1 ชั่วโมง' },
      { value: '1-3h', label: 'มากกว่า 1 – 3 ชั่วโมง' },
      { value: 'gt3h', label: 'มากกว่า 3 ชั่วโมง' },
    ],
  },
  {
    key: 'aiUsage', column: 'exp_ai_usage', label: 'ก่อนใช้ Dino ท่านเคยใช้แชทบอท AI (เช่น ChatGPT, Gemini) หรือไม่',
    options: [
      { value: 'often', label: 'ใช้เป็นประจำ' },
      { value: 'sometimes', label: 'เคยใช้บ้าง' },
      { value: 'never', label: 'ไม่เคยใช้' },
    ],
  },
  {
    key: 'khonKaenVisit', column: 'exp_khonkaen', label: 'ท่านรู้จักหรือเคยเที่ยวขอนแก่นมาก่อนหรือไม่',
    options: [
      { value: 'local', label: 'อาศัยอยู่ในขอนแก่น/พื้นที่ใกล้เคียง' },
      { value: 'visited', label: 'เคยมาเที่ยวแล้ว' },
      { value: 'never', label: 'ยังไม่เคยมา' },
    ],
  },
]

export const AGE_MIN = 10
export const AGE_MAX = 99
export const OCCUPATION_OTHER_MAX = 100

export function ageGroupOf(age) {
  if (age < 20) return 'under20'
  if (age < 30) return '20-29'
  if (age < 40) return '30-39'
  return '40plus'
}

export const COMMENT_FIELDS = [
  { key: 'strengths', column: 'strengths', label: 'สิ่งที่ท่านพึงพอใจมากที่สุดในระบบนี้' },
  { key: 'improvements', column: 'improvements', label: 'สิ่งที่ท่านคิดว่าควรปรับปรุง' },
]

export const MAX_COMMENT_LENGTH = 1000
export const QUESTION_COLUMNS = QUESTIONS.map((q) => `q${q.no}`)
