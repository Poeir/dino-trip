# คู่มือ API — Dino Khon Kaen backend

เอกสารนี้อธิบาย REST API ของ `backend/` (Express) แบบภาษาคน รายละเอียดครบทุกช่อง (request/response schema)
อยู่ใน **`backend/openapi.yaml`** ซึ่งเป็น "แหล่งความจริง" ที่ test ตรวจทุกครั้งว่าตรงกับโค้ด

> เปรียบเทียบง่าย ๆ: API คือ "เคาน์เตอร์สั่งอาหาร" ของ backend — frontend เดินมาสั่ง (request) ด้วยเมนูที่กำหนด
> (method + path + ข้อมูล) แล้วได้ของกลับไป (response) เป็น JSON ไฟล์ `openapi.yaml` คือ "เมนู" ฉบับเต็ม

---

## 1. ภาพรวม

| | |
|---|---|
| Base URL (local) | `http://localhost:4000` (`npm run dev`) |
| Base URL (production) | `https://dinokhonkaen.app` — Caddy ส่ง `/api/*` ต่อให้ backend |
| รูปแบบข้อมูล | JSON (`Content-Type: application/json`) ยกเว้นการอัปโหลดรูปที่ใช้ `multipart/form-data` |
| ชื่อฟิลด์ | camelCase ใน API (ฐานข้อมูลเป็น snake_case — `lib/mappers.js` แปลงให้) |
| วันที่ | คอลัมน์ `date` ส่งเป็น `YYYY-MM-DD`, เวลาเป็น ISO 8601 |

API นี้ **ไม่ได้** รวมแชทบอท/วางแผนทริป (`/chat/`, `/trip/llm`) — สองอย่างนั้นอยู่ใน chatbot-service (FastAPI, Swagger ที่ `http://localhost:8000/docs`)
backend แค่ "ส่งต่อ" บาง endpoint ที่ต้องมีการยืนยันสิทธิ์ไปให้ chatbot-service (ดึงข้อมูลอีเวนท์ด้วย AI, สร้างคำอธิบายสถานที่, reindex, เวอร์ชันระบบ)

## 2. การล็อกอินและ session cookie

ระบบใช้ **cookie** ไม่ใช่ token ใน header:

1. `POST /api/auth/login` ด้วย `{ "email": "...", "password": "..." }`
2. ถ้าถูกต้อง เซิร์ฟเวอร์ตอบ `{ user: {...} }` พร้อม header `Set-Cookie: session_token=...; HttpOnly; SameSite=Lax`
3. เบราว์เซอร์ (หรือ Bruno) เก็บ cookie ไว้และส่งกลับมาเองทุกครั้ง — frontend เรียกด้วย `credentials: 'include'` (ดู `frontend/src/lib/apiClient.js`)
4. `POST /api/auth/logout` ลบ session และ cookie

รายละเอียดที่ควรรู้:
- cookie เป็น **httpOnly** — JavaScript ในหน้าเว็บอ่านไม่ได้ (กันขโมยผ่าน XSS)
- อายุ session 30 วัน · เปลี่ยนรหัสผ่าน/รีเซ็ตรหัสผ่าน/ถูกระงับ/ถูกลบ จะตัด session
- `GET /api/auth/me` ใช้ถามว่า "ตอนนี้ล็อกอินเป็นใคร" — ไม่ได้ล็อกอินจะได้ `{ "user": null }` (ไม่ใช่ error)
- `sameSite: lax` อาศัยว่า frontend กับ API อยู่โดเมนเดียวกันใน production
- สมัครแล้วต้องยืนยันอีเมลก่อน (`POST /api/auth/confirm`) ถึงจะล็อกอินได้

## 3. ระดับสิทธิ์

ใน `openapi.yaml` ทุก operation มีช่อง `x-auth`:

| x-auth | ความหมาย | ไม่มีสิทธิ์จะได้ |
|---|---|---|
| `public` | ใครก็เรียกได้ | — |
| `optional` | ล็อกอินหรือไม่ก็ได้ ผลต่างกัน (`GET /api/auth/me`, `POST /api/trips`) | — |
| `user` | ต้องล็อกอิน (role ใดก็ได้) | `401 กรุณาเข้าสู่ระบบก่อน` |
| `admin` | ต้องล็อกอินและ `role = admin` | `401` ถ้าไม่ได้ล็อกอิน, `403 ไม่มีสิทธิ์เข้าถึงส่วนนี้` ถ้าไม่ใช่ admin |

admin ล็อกอินผ่าน `/api/auth/login` เดียวกับนักท่องเที่ยว ต่างกันแค่ `role` ในตาราง `users`
ทุก endpoint ใต้ `/api/admin/*` และ `/api/reindex` เป็น admin เท่านั้น รวมถึง POST/PUT/DELETE ของ places, events, knowledge-base, qrs, rewards

## 4. รูปแบบ error

ทุก error ตอบเป็น JSON รูปเดียวกัน ข้อความเป็นภาษาไทยพร้อมแสดงให้ผู้ใช้:

```json
{ "error": { "message": "กรุณาเข้าสู่ระบบก่อน" } }
```

| status | เมื่อไร |
|---|---|
| 400 | ข้อมูลไม่ถูกต้อง (ข้อความบอกว่าผิดตรงไหน) · id ที่ไม่ใช่ uuid → `ข้อมูลที่ส่งมาไม่ถูกต้อง` |
| 401 / 403 | ไม่ได้ล็อกอิน / ไม่มีสิทธิ์ (หรือบัญชีถูกระงับ, ยังไม่ยืนยันอีเมล ตอนล็อกอิน) |
| 404 | ไม่พบ (ทริป/คำขอของคนอื่นก็ตอบ 404 เหมือนไม่มีอยู่) · path ที่ไม่มี → `Not found: GET /api/...` |
| 409 | ซ้ำหรือทำไปแล้ว (เช่น สแกน QR ซ้ำ, มี QR อยู่แล้ว, คำขอถูกตรวจแล้ว) |
| 402 / 410 / 422 | แต้มไม่พอ (แลกของรางวัล) / QR หมดอายุ / ต้องเปิดตำแหน่งเพื่อสแกน |
| 429 | เรียกถี่เกินไป — มี header `Retry-After` (วินาที) |
| 500 | `เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง` (ไม่ส่งรายละเอียดจากฐานข้อมูลออกไป) |
| 502 | ติดต่อบริการภายนอกไม่ได้ (chatbot-service, Google, Cloudinary, อีเมล) |
| 503 | ฐานข้อมูลยังไม่ได้รัน migration ล่าสุด / ยังไม่ได้ตั้ง `GOOGLE_PLACES_API_KEY` / health check ต่อฐานข้อมูลไม่ได้ |

ข้อยกเว้น: `GET /api/users/{id}/avatar` ตอบ 404 แบบไม่มี body และหน้า SEO ตอบเป็น HTML

## 5. Rate limit

นับในหน่วยความจำของ process (รีสตาร์ทแล้วเริ่มนับใหม่) เกินแล้วได้ 429

| ขอบเขต | เพดาน |
|---|---|
| ทุก `/api/*` | 1200 ครั้ง/นาที/IP |
| login | 100 ครั้ง/15 นาที/IP และ 10 ครั้ง/15 นาที ต่อ IP+อีเมล |
| signup | 20 ครั้ง/ชั่วโมง/IP |
| forgot-password | 10 ครั้ง/ชั่วโมง/IP และ 3 ครั้ง/ชั่วโมง/อีเมล |
| confirm / reset-password | 30 ครั้ง/15 นาที/IP · ยืนยันอีเมลใหม่ 20 ครั้ง/15 นาที/IP |
| สแกน QR | 20 ครั้ง/นาที/ผู้ใช้ |
| บันทึก/ทำสำเนาทริป | 30 ครั้ง/ชั่วโมง/IP |
| โปรไฟล์ | แก้ข้อมูล/รูป 30 ครั้ง/นาที · เปลี่ยนรหัสผ่าน/อีเมล/ลบบัญชี 5 ครั้ง/15 นาที |
| รายงานสถานที่/อีเวนท์ | 20 ครั้ง/ชั่วโมง/ผู้ใช้ |
| เสนออีเวนท์ | 10 ครั้ง/ชั่วโมง · AI ดึงข้อมูล 20 ครั้ง/ชั่วโมง · อัปโหลดรูป 60 ครั้ง/ชั่วโมง |
| แบบสอบถาม | 40 ครั้ง/ชั่วโมง/IP |
| admin: AI คำอธิบายสถานที่ | 60 ครั้ง/ชั่วโมง |
| admin: ซิงก์ Google | สร้างงาน 20 ครั้ง/ชั่วโมง · ซิงก์รายตัว 120 ครั้ง/ชั่วโมง |
| admin: นำเข้าจาก Google | ค้นหา 120 ครั้ง/ชั่วโมง · นำเข้า 40 ครั้ง/ชั่วโมง |

## 6. Cache และการแบ่งหน้า

- รายการของ **places, events, knowledge-base, qrs, rewards** (สร้างด้วย `lib/crudRouter.js`) cache ในหน่วยความจำ **25 วินาที**
  ต่อชุด query string — หลังแก้ข้อมูลผ่าน API cache จะถูกล้างทันที แต่ถ้าข้อมูลเปลี่ยนจากที่อื่น (เช่น chatbot-service เขียน embedding) อาจเห็นช้าไม่เกิน 25 วินาที
- รายการเหล่านี้: **ไม่ส่ง** `page`/`limit` → ได้ array ทั้งหมด · **ส่ง** `page` หรือ `limit` → ได้
  `{ data, total, page, pageSize, totalPages }` (limit สูงสุด 100) · `?ids=a,b,c` ดึงตาม id ไม่ผ่าน cache
- endpoint อื่นที่แบ่งหน้า (trips, admin users ฯลฯ) ตอบรูป `{ data, total, page, pageSize, totalPages }` เสมอ
- หน้า SEO cache 5 นาที, sitemap 10 นาที

## 7. รายการ endpoint

สัญลักษณ์: 🌐 public · 👤 ต้องล็อกอิน · 🔑 admin · ◐ optional

### Health & SEO
| | method | path | ใช้ทำอะไร |
|---|---|---|---|
| 🌐 | GET | `/`, `/health`, `/api/health` | ชื่อ API / ตรวจว่าฐานข้อมูลตอบ |
| 🌐 | GET | `/robots.txt`, `/sitemap.xml` | สำหรับ search engine |
| 🌐 | GET | `/api/seo/page/{path}` | หน้า HTML พร้อม meta/JSON-LD ให้ bot (Caddy ส่งเฉพาะ bot มา) |

### Auth — `/api/auth`
| | method | path | ใช้ทำอะไร |
|---|---|---|---|
| 🌐 | POST | `/signup` | สมัคร (multipart แนบรูปได้) แล้วส่งอีเมลยืนยัน |
| 🌐 | POST | `/confirm` | ยืนยันอีเมลด้วย token แล้วล็อกอินให้ |
| 🌐 | POST | `/login` · `/logout` | เข้า/ออกจากระบบ |
| 🌐 | POST | `/forgot-password` · `/reset-password` | ลืมรหัสผ่าน |
| ◐ | GET | `/me` | ผู้ใช้ปัจจุบัน (หรือ null) |

### สถานที่ — `/api/places`
| | method | path | ใช้ทำอะไร |
|---|---|---|---|
| 🌐 | GET | `/` | รายการ (กรอง `category`, `subcategory`, `isActive`, `hasQR`, `search`, จัดเรียง `sort`) |
| 🌐 | GET | `/{id}` · `/meta/names` · `/{id}/photos` | รายละเอียด / ชื่อย่อทั้งหมด / รูปที่อัปโหลด |
| 🔑 | POST · PUT · DELETE | `/` · `/{id}` | เพิ่ม/แก้/ลบ (แก้ฟิลด์จาก Google จะล็อกฟิลด์นั้น) |
| 🔑 | POST · DELETE | `/{id}/photos` · `/{id}/photos/{photoId}` | จัดการรูป (สูงสุด 5) |
| 🔑 | POST | `/describe` | ให้ AI ร่างคำอธิบาย (ไม่บันทึก) |
| 👤 | POST · GET | `/{id}/reports` · `/{id}/reports/mine` | แจ้งข้อมูลผิด / ดูที่ตัวเองแจ้งค้างไว้ |

### อีเวนท์ — `/api/events` และคำขออีเวนท์ — `/api/event-requests`
| | method | path | ใช้ทำอะไร |
|---|---|---|---|
| 🌐 | GET | `/api/events` · `/api/events/{id}` · `/{id}/photos` | รายการ (กรอง `status=upcoming/ongoing/ended/cancelled`) / รายละเอียด / รูป |
| 🔑 | POST · PUT · DELETE | `/api/events`, `/api/events/{id}`, `/{id}/photos...` | จัดการอีเวนท์และรูป |
| 🔑 | POST | `/api/events/extract` | AI ดึงข้อมูลจากข้อความโพสต์ |
| 👤 | POST · GET | `/api/events/{id}/reports` · `/reports/mine` | แจ้งข้อมูลอีเวนท์ผิด |
| 👤 | POST · GET | `/api/event-requests` · `/mine` | เสนออีเวนท์ใหม่ (รออนุมัติได้ 5 รายการ) / ดูของตัวเอง |
| 👤 | PUT · DELETE | `/api/event-requests/{id}` | แก้/ถอนคำขอที่ยังรออนุมัติ |
| 👤 | GET · POST · DELETE | `/api/event-requests/{id}/photos...` | รูปของคำขอ |
| 👤 | POST | `/api/event-requests/extract` | AI ดึงข้อมูลจากโพสต์ (≤5000 ตัวอักษร) |

### ฐานความรู้, QR, แต้ม, ของรางวัล
| | method | path | ใช้ทำอะไร |
|---|---|---|---|
| 🌐 | GET | `/api/knowledge-base`, `/{id}` | ฐานความรู้ของแชทบอท |
| 🔑 | POST · PUT · DELETE | `/api/knowledge-base...` | จัดการฐานความรู้ |
| 🌐 | GET | `/api/qrs`, `/{id}`, `/meta/places` | QR ทั้งหมด / สถานที่ที่สแกนได้ตอนนี้ |
| 🔑 | POST · PUT · DELETE · GET | `/api/qrs...`, `/meta/stats` | จัดการ QR / สถิติสแกน |
| 👤 | POST | `/api/qrs/{id}/scan` | สแกนรับแต้ม (ส่ง `lat`/`lng`) |
| 👤 | GET | `/api/points/me` | ยอดแต้ม |
| 🌐 | GET | `/api/rewards`, `/{id}` | ของรางวัล |
| 🔑 | POST · PUT · DELETE | `/api/rewards...`, `/{id}/image` | จัดการของรางวัลและรูป |

### ทริป, โปรไฟล์, ผู้ใช้
| | method | path | ใช้ทำอะไร |
|---|---|---|---|
| ◐ | POST | `/api/trips` | บันทึกแผนทริป (ไม่ล็อกอิน = เก็บเป็นสถิติ ได้ 202) |
| 👤 | GET · PATCH · DELETE | `/api/trips`, `/api/trips/{id}` | รายการ / เปลี่ยนชื่อ-ติดดาว / ลบ |
| 👤 | PATCH · POST | `/api/trips/{id}/items/{itemId}` · `/{id}/duplicate` | กดชอบ stop / ทำสำเนา |
| 👤 | GET · PATCH · DELETE | `/api/profile` | ดู / แก้ข้อมูล / ลบบัญชี |
| 👤 | GET | `/api/profile/history` | ประวัติแต้ม |
| 👤 | PUT · DELETE | `/api/profile/avatar` | รูปโปรไฟล์ |
| 👤 | POST · DELETE | `/api/profile/password`, `/api/profile/email` | เปลี่ยนรหัสผ่าน / ขอ-ยกเลิกเปลี่ยนอีเมล |
| 🌐 | POST | `/api/profile/email/confirm` | ยืนยันอีเมลใหม่จากลิงก์ |
| 🌐 | GET | `/api/users/{id}/avatar` | ไฟล์รูปโปรไฟล์ |
| 🌐 | GET · POST | `/api/survey/questions`, `/status`, `/api/survey` | แบบสอบถาม (1 ครั้งต่อเบราว์เซอร์) |

### Admin (ทั้งหมด 🔑)
| path | ใช้ทำอะไร |
|---|---|
| `/api/admin/users`, `/{id}`, `/{id}/suspend · unsuspend · delete · restore · points · revoke-sessions · resend-verification` | จัดการบัญชีผู้ใช้ (ทุกการกระทำลง audit log) |
| `/api/admin/redemptions`, `/{id}/cancel` | แลกของรางวัลที่เคาน์เตอร์ / ยกเลิก |
| `/api/admin/stats`, `/stats/trips`, `/stats/system` | ตัวเลขแดชบอร์ด / สถิติทริป / เวอร์ชันแต่ละ service |
| `/api/admin/trips`, `/{id}`, `/{id}/delete` | ดู/ลบแผนทริปทั้งหมด |
| `/api/admin/place-reports`, `/count`, `/resolve` · `/api/admin/event-reports` (เหมือนกัน) | คิวรายงานข้อมูลผิด |
| `/api/admin/event-requests`, `/count`, `/{id}/approve`, `/{id}/reject` | อนุมัติคำขออีเวนท์ |
| `/api/admin/survey/summary`, `/responses`, `/export`, `/{id}` | ผลแบบสอบถาม / CSV / ลบคำตอบ |
| `/api/admin/place-sync/...` | ซิงก์ Google Places, ล็อกฟิลด์, รับ/ปัดตกค่าใหม่ (**มีค่าใช้จ่ายต่อแห่ง**) |
| `/api/admin/place-import/search`, `/api/admin/place-import` | ค้นหาและนำเข้าสถานที่จาก Google (**มีค่าใช้จ่าย**) |
| `/api/reindex`, `/status`, `/pending` | สั่ง embed ข้อมูลใหม่ให้แชทบอท |

รายละเอียด body/response ของแต่ละตัวดูใน Swagger UI หรือ `openapi.yaml`

## 8. ดูเอกสารแบบโต้ตอบ (Swagger UI)

```bash
cd backend
npm run dev
# เปิด http://localhost:4000/api/docs
```

- เปิดเฉพาะเมื่อ `NODE_ENV` ไม่ใช่ `production` (production เปิดได้ด้วย `ENABLE_API_DOCS=true` แต่ Docker image ไม่ได้ใส่ไฟล์ spec ไว้ จึงปิดอยู่เสมอ)
- สเปกแบบ JSON: `http://localhost:4000/api/docs/openapi.json`
- กด "Try it out" ได้เลย — ถ้าต้องการเรียก endpoint ที่ต้องล็อกอิน ให้เรียก `POST /api/auth/login` ใน Swagger ก่อน เบราว์เซอร์จะเก็บ cookie ให้
- ตรวจความถูกต้องของสเปก: `npm run lint:openapi`

## 9. ทดลองยิง API ด้วย Bruno

[Bruno](https://www.usebruno.com/) คือโปรแกรมยิง API (คล้าย Postman) ที่เก็บ request เป็นไฟล์ในโปรเจค มี 2 ทาง:

**ทางที่แนะนำ — เปิด collection ที่เตรียมไว้** (`backend/bruno/`)
1. Bruno → **Open Collection** → เลือกโฟลเดอร์ `backend/bruno`
2. มุมขวาบนเลือก environment **local** แล้วกรอก `userEmail`, `userPassword`, `adminEmail`, `adminPassword` (รหัสผ่านเป็น secret ไม่ถูกบันทึกลงไฟล์)
3. รัน **03 Auth / Login (user)** หรือ **Login (admin)** ก่อน — Bruno เก็บ cookie `session_token` ใน cookie jar และส่งให้ request ถัดไปเอง
   (สคริปต์ใน Login ยังเก็บสำเนาไว้ในตัวแปร `sessionCookie` เพื่อให้ CLI ใช้ได้)
4. ใส่ id จริงในตัวแปร environment (`placeId`, `eventId`, `tripId`, ...) ก่อนเรียก request ที่มี id
5. แต่ละ request มีแท็บ **Docs** อธิบายสิทธิ์/พฤติกรรม และ **Assert** ตรวจ status code ที่ควรได้

ทางนี้ได้ docs, assertion, ตัวอย่าง body และสคริปต์ login ครบ

**อีกทาง — Import จาก OpenAPI:** Bruno → **Import Collection** → **OpenAPI V3** → เลือก `backend/openapi.yaml`
(หรือ URL `http://localhost:4000/api/docs/openapi.json`) ได้ request ครบ 132 ตัวจัดตามหมวด แต่ไม่มี docs/assertion/สคริปต์ login
เหมาะเมื่ออยากได้ของสดจากสเปกล่าสุดเร็ว ๆ

⚠️ request ที่เป็น POST/PUT/PATCH/DELETE **เปลี่ยนข้อมูลจริง** อย่ารันทั้ง collection กับ production
รันอัตโนมัติแบบปลอดภัย (อ่านอย่างเดียว) ได้ด้วย Bruno CLI:

```bash
cd backend/bruno
npx @usebruno/cli run "00 Smoke" --env local
```

แก้ `openapi.yaml` แล้วสร้าง collection ใหม่ได้ด้วย `npm run bruno:generate` (ไฟล์ใน `environments/` จะไม่ถูกเขียนทับ)

## 10. การทดสอบ

```bash
cd backend
npm test           # ทุก test (unit + API) ด้วย node --test
npm run test:api   # เฉพาะ API tests
```

API tests (`test/api.*.test.js`) เปิดแอปจริงบนพอร์ตสุ่ม แต่ **ไม่ใช้ฐานข้อมูลจริงและไม่เรียกบริการภายนอก**:
- `test/helpers/apiHarness.js` เปลี่ยน connection ของ knex เป็นตัวปลอมที่ตอบตาม SQL ที่ test กำหนด (ค่าเริ่มต้นคือผลว่าง)
  และตั้ง `DATABASE_URL` เป็นค่าหลอกก่อนโหลดแอป — `.env` ที่อาจมี URL ของ production จะไม่ถูกใช้
- chatbot-service ถูกแทนด้วยเซิร์ฟเวอร์จำลองในเครื่อง
- `GOOGLE_PLACES_API_KEY`, SMTP, Cloudinary ถูกล้างค่า — endpoint ที่ใช้ Google จะหยุดที่ 503 ไม่มีการเรียกที่เสียเงิน

สิ่งที่ตรวจ:
- `api.spec.test.js` — ทุก route ใน Express มีใน `openapi.yaml` และกลับกัน · ทุก operation ที่เป็น `user`/`admin` ตอบ 401 เมื่อไม่ล็อกอิน · ทุก `admin` ตอบ 403 สำหรับนักท่องเที่ยว
- `api.public.test.js` — health, SEO, login/signup/token flows, rate limit, รูปแบบ list/pagination/cache, error mapping, แบบสอบถาม, Swagger UI
- `api.protected.test.js` — validation ของ admin CRUD, การสแกน QR, ทริป, รายงาน, คำขออีเวนท์, โปรไฟล์, admin users/redemptions/stats, proxy ไป chatbot-service, guard ของ endpoint Google

**เพิ่ม route ใหม่แล้ว test แดง?** แปลว่ายังไม่ได้เพิ่มใน `openapi.yaml` — เพิ่ม operation (ใส่ `x-auth`, `operationId`, `tags`) แล้วรัน `npm run bruno:generate`
