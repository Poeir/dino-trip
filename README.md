# Dino Khon Kaen

เว็บแนะนำที่เที่ยว/ร้านอาหารในขอนแก่น พร้อมแชทบอทและระบบวางแผนทริปที่ขับเคลื่อนด้วย LLM

## โครงสร้างโปรเจค

โปรเจคแบ่งเป็น 3 ส่วน แยกกันรันอิสระ (ไม่ใช่ monorepo แบบ shared build):

```
main repo/
├── frontend/         # เว็บแอป (React + Vite) — หน้าเว็บที่ผู้ใช้เห็น
├── backend/          # Express API + Supabase migrations/สคริปต์ import ข้อมูลสถานที่
└── chatbot-service/  # Python (FastAPI) — แชทบอท + trip planner แบบ RAG/LLM
```

| ส่วน | เทคโนโลยี | หน้าที่ |
|---|---|---|
| `frontend/` | React 18 + Vite + react-router-dom | UI ทั้งหมด: หน้าแรก, รายละเอียดสถานที่, แชท, ฟอร์มวางแผนทริป, หน้า admin |
| `backend/` | Node.js + Express + knex/pg | REST API ภายใต้ `/api/*` (places, events, knowledge-base, qrs, rewards, points, trips, profile, auth, รายงานข้อมูล, ซิงก์สถานที่ ฯลฯ), ระบบสมาชิก/session แบบ cookie, schema/migrations ของฐานข้อมูล (Postgres + pgvector), ซิงก์ข้อมูลสถานที่จาก Google Places, หน้า SEO สำหรับ crawler |
| `chatbot-service/` | Python + FastAPI | เสิร์ฟ endpoint `/chat/` (ตอบกลับแบบ stream ทีละ token), `/trip/llm`, การสกัดข้อมูลกิจกรรม และ admin reindex แยกเป็นเซอร์วิสของตัวเอง |

**ฐานข้อมูล**: Supabase (Postgres) โปรเจคเดียว ที่ทั้ง `backend/` (ผ่าน `DATABASE_URL`) และ `chatbot-service/` เชื่อมต่อเข้าไปด้วยกัน — frontend ไม่เชื่อมต่อ Supabase ตรง (ไม่มี anon key ฝั่ง client) แต่เรียกผ่าน `backend/` API แทน

**Production**: รันทั้งหมดบน VPS เครื่องเดียว (OVHcloud) ด้วย Docker Compose ใน `deploy/` — Caddy ให้บริการ HTTPS, เสิร์ฟ frontend, ส่ง `/api` ไป backend และ `/chat`, `/trip/llm` ไป chatbot-service (single origin ที่ `dinokhonkaen.app`) ดูหัวข้อ "Deploy" ด้านล่าง

## การรันโปรเจค (local)

ต้องรัน 3 process พร้อมกัน (frontend คุยกับ backend API และ chatbot-service ผ่าน `fetch()` ธรรมดา):

### 1. Backend API

```bash
cd backend
npm install
cp .env.example .env   # แล้วกรอก DATABASE_URL / FRONTEND_ORIGIN / CHATBOT_SERVICE_URL / Cloudinary / Gmail / GOOGLE_PLACES_API_KEY
npm run dev             # http://localhost:4000
npm test                # node --test
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # แล้วกรอกค่า VITE_API_URL / VITE_CHATBOT_SERVICE_URL / VITE_GOOGLE_MAPS_API_KEY
npm run dev            # http://localhost:5173
```

### 3. Chatbot service

```bash
cd chatbot-service
python -m venv venv
venv\Scripts\activate        # Windows
cp .env.example .env         # แล้วกรอก KKU_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000   # http://localhost:8000
pytest                                       # ไม่รวมเทสต์ที่เรียก LLM/DB จริง (pytest -m live จะเสียเงิน)
```

API docs (Swagger) ดูได้ที่ `http://localhost:8000/docs`

### ตั้งค่าฐานข้อมูล/นำเข้าข้อมูล (ใช้เฉพาะตอน setup ไม่ต้องรันตลอด)

```bash
cd backend
npx supabase db push --yes       # apply migrations ใน supabase/migrations/ (ใช้กับ DB ใหม่เท่านั้น ดูหมายเหตุด้านล่าง)
npm run fetch:places               # ดึงข้อมูลสดจาก Google Places API (New) -> backend/data/places.json
npm run import:places              # import จาก backend/data/places.json เข้า Supabase
npm run seed:events-knowledge      # seed ข้อมูลกิจกรรม/knowledge base เริ่มต้น (ถ้ามี)
```

> **ระวัง:** DB ที่ใช้งานจริงไม่มีประวัติ `supabase_migrations` ถ้ารัน `db push` จะ replay migration เก่าทั้งหมด — กับ DB เดิมให้ apply เฉพาะไฟล์ใหม่ทีละไฟล์ (หรือซ่อม history ก่อน) แล้วตรวจ RLS/grants หลังรัน

หลัง import ข้อมูลใหม่ ต้องรัน embedding ใหม่ด้วย (ที่ `chatbot-service/`):

```bash
cd chatbot-service
python scripts/embed_content.py
```

## Environment variables

| ไฟล์ | ตัวแปร | ใช้ทำอะไร |
|---|---|---|
| `frontend/.env` | `VITE_API_URL` | URL ของ backend Express API (default `http://localhost:4000`) |
| | `VITE_CHATBOT_SERVICE_URL` | URL ของ chatbot-service (default `http://localhost:8000`) |
| | `VITE_GOOGLE_MAPS_API_KEY` | Google Maps JS key (แผนที่ทริป, ตัวเลือกพิกัดของ admin) — ใช้ key แยกจาก backend และจำกัดด้วย HTTP referrer |
| | `VITE_SITE_URL` | URL สาธารณะของเว็บ ใส่ใน canonical/Open Graph ตอน build (production ตั้งจาก `CHAT_DOMAIN`) |
| `backend/.env` | `DATABASE_URL` | connection string ของ Postgres (knex) — ถ้า host ตรงเป็น IPv6 ให้ใช้ session pooler พอร์ต 5432 |
| | `FRONTEND_ORIGIN` | origin ของ frontend (ต้องตรงเป๊ะ ไม่มี `/` ท้าย) สำหรับ CORS + session cookie |
| | `CHATBOT_SERVICE_URL` | ให้ backend proxy คำสั่ง admin (reindex, สกัดกิจกรรม) ไปที่ chatbot-service |
| | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | เก็บรูปสถานที่/กิจกรรม/รางวัล |
| | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | ส่งอีเมลยืนยัน/รีเซ็ตรหัสผ่าน (ต้องเป็น App Password) |
| | `GOOGLE_PLACES_API_KEY` | ใช้ซิงก์/นำเข้าสถานที่ (ต้องเปิด Places API (New) + ผูก billing; คิดเงินต่อสถานที่) |
| | `PORT` | พอร์ตของ backend API (default `4000`) |
| `chatbot-service/.env` | `KKU_API_KEY` | KKU LLM gateway (OpenAI-compatible) |
| | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | query ข้อมูลสถานที่ + pgvector search |
| | `MODEL_NAME`, `TRIP_PLANNER_MODEL_NAME` | โมเดลของแชท/trip planner — บน production ต้องตั้ง ไม่งั้น gateway ตอบ 401 "Invalid model" |
| | `CORS_ORIGINS` | origin ที่เรียก service ได้ (คั่นด้วย `,` ไม่มี `/` ท้าย) |
| | `LLM_BASE_URL`, `DESCRIPTION_MODEL_NAME`, `EMBEDDING_MODEL_NAME`, `SERPER_API_KEY` | ไม่บังคับ (ดู `.env.example`; เปลี่ยน embedding model ต้อง re-embed) |

## Chatbot / Trip Planner (RAG)

- Embedding model: `paraphrase-multilingual-MiniLM-L12-v2` (384 มิติ) รันบนเครื่อง local ผ่าน `sentence-transformers`
- ค้นหาสถานที่/knowledge base ด้วย cosine similarity ผ่าน Postgres function `match_places` / `match_knowledge_base` (pgvector) พร้อม similarity threshold — query ที่ไม่เกี่ยวข้องเลยจะได้ผลลัพธ์ว่างแทนที่จะได้ของที่ใกล้เคียงที่สุดเท่าที่มี
- `/chat/` ตอบกลับแบบ stream (Server-Sent Events) ทีละ token ให้ frontend เรนเดอร์ระหว่างที่ LLM กำลังตอบ ส่วน `places` ที่เกี่ยวข้องจะมาพร้อม event `done` ตอนจบเท่านั้น
- Trip planner เป็นแบบ hybrid: LLM เลือก/จัดลำดับสถานที่ตาม context, ส่วนการคำนวณ (ระยะทาง, เวลาที่ใช้, เวลาเปิด-ปิด, ค่าใช้จ่าย) เป็น deterministic Python ล้วนๆ ไม่พึ่ง LLM
- ถ้า LLM ตอบ JSON ผิดรูปแบบหรือ trip planning ล้มเหลว จะคืน HTTP 502 ให้ frontend แสดง error ตรงๆ (ไม่มี fallback เดามั่ว)
- `knowledge_base`/`events` seed เริ่มต้นได้ผ่าน `npm run seed:events-knowledge` (ที่ `backend/`) — เพิ่มข้อมูลอื่นเพิ่มเติมได้ผ่านหน้า admin แล้วรัน `embed_content.py` ใหม่

## Deploy

- Production รันบน VPS ด้วย `deploy/docker-compose.yml` (caddy + frontend, backend, chatbot) ตั้งค่าผ่าน `deploy/.env` (`CHAT_DOMAIN`, `OLD_DOMAIN`), `deploy/backend.env`, `deploy/chatbot.env` (ดูไฟล์ `*.example`; ห้าม commit ไฟล์จริง)
- push เข้า `main` ที่แตะ `frontend/`, `backend/`, `chatbot-service/` หรือ `deploy/` จะ trigger GitHub Action `deploy-chatbot.yml` ที่ SSH เข้า VPS แล้วรัน `deploy/deploy.sh` (merge แบบ ff-only, build ทีละ service, รีโหลด Caddy, รอ `/health`)
- CI: `ci-frontend.yml` (`npm run build`) และ `ci-chatbot.yml` (`pytest`); backend ยังไม่มี CI
- เวอร์ชันระบบอยู่ที่ไฟล์ `VERSION` ที่ root (ตอนนี้ `0.1.0`, preview) และต้องตรงกับ `package.json` ของ frontend/backend; หน้า admin แสดงเวอร์ชัน/commit ของแต่ละ service

## หมายเหตุ

- ระบบสมาชิกเป็นของตัวเอง (สมัคร/ล็อกอินด้วยอีเมล, session cookie แบบ httpOnly, ยืนยันอีเมล, รีเซ็ตรหัสผ่าน) ไม่ได้ผูกกับ Google login; มี QR สะสมแต้ม, แลกรางวัล, ประวัติทริป และหน้า admin จัดการผู้ใช้/เนื้อหา
- Google Places sync ทำผ่านหน้า admin (backend เป็นเจ้าของ ไม่มี CLI สำหรับ resync): admin ล็อกฟิลด์ที่แก้เองได้ ค่าใหม่จาก Google ของฟิลด์ที่ล็อกจะถูกพักไว้ให้รีวิว และผู้ใช้แจ้งข้อมูลผิดของสถานที่/กิจกรรมได้ สคริปต์ `fetch:places` / `import:places` ใช้เป็น seed ครั้งแรกเท่านั้น
- ค่า rate limit, RLS และ cookie สำหรับ production ดูสถานะล่าสุดใน `CLAUDE.md` (ยังไม่มี CSP)
