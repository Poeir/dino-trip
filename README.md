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
| `backend/` | Node.js + Express + Supabase CLI | REST API (`/api/places`, `/api/events`, `/api/knowledge-base`, `/api/qrs`, `/api/rewards`) ที่ frontend เรียกใช้, schema/migrations ของฐานข้อมูล (Postgres + pgvector), สคริปต์ดึง/นำเข้าข้อมูลสถานที่จาก Google Places |
| `chatbot-service/` | Python + FastAPI | เสิร์ฟ endpoint `/chat/` (ตอบกลับแบบ stream ทีละ token) และ `/trip/llm` แยกเป็นเซอร์วิสของตัวเอง รันบนเครื่อง local |

**ฐานข้อมูล**: Supabase (Postgres) โปรเจคเดียว ที่ทั้ง `backend/` และ `chatbot-service/` เชื่อมต่อเข้าไปด้วยกัน — frontend ไม่เชื่อมต่อ Supabase ตรงอีกต่อไป (ไม่มี anon key ฝั่ง client) แต่เรียกผ่าน `backend/` API แทน

## การรันโปรเจค (local)

ต้องรัน 3 process พร้อมกัน (frontend คุยกับ backend API และ chatbot-service ผ่าน `fetch()` ธรรมดา):

### 1. Backend API

```bash
cd backend
npm install
cp .env.example .env   # แล้วกรอก SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GOOGLE_PLACES_API_KEY
npm run dev             # http://localhost:4000
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # แล้วกรอกค่า VITE_API_URL / VITE_CHATBOT_SERVICE_URL
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
```

API docs (Swagger) ดูได้ที่ `http://localhost:8000/docs`

### ตั้งค่าฐานข้อมูล/นำเข้าข้อมูล (ใช้เฉพาะตอน setup ไม่ต้องรันตลอด)

```bash
cd backend
npx supabase db push --yes       # apply migrations ทั้งหมดใน supabase/migrations/
npm run fetch:places               # ดึงข้อมูลสดจาก Google Places API (New) -> backend/data/places.json
npm run import:places              # import จาก backend/data/places.json เข้า Supabase
npm run seed:events-knowledge      # seed ข้อมูลกิจกรรม/knowledge base เริ่มต้น (ถ้ามี)
```

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
| `backend/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ใช้โดย `src/server.js` (API) และสคริปต์ migration/import (service role key, ห้ามหลุดไปฝั่ง frontend) |
| | `GOOGLE_PLACES_API_KEY` | ใช้เฉพาะ `scripts/fetch-places.js` (ต้องเปิด Places API (New) + ผูก billing) |
| | `PORT` | พอร์ตของ backend API (default `4000`) |
| `chatbot-service/.env` | `KKU_API_KEY` | KKU LLM gateway (OpenAI-compatible, model `gemini-2.5-flash`) |
| | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | query ข้อมูลสถานที่ + pgvector search |

## Chatbot / Trip Planner (RAG)

- Embedding model: `paraphrase-multilingual-MiniLM-L12-v2` (384 มิติ) รันบนเครื่อง local ผ่าน `sentence-transformers`
- ค้นหาสถานที่/knowledge base ด้วย cosine similarity ผ่าน Postgres function `match_places` / `match_knowledge_base` (pgvector) พร้อม similarity threshold — query ที่ไม่เกี่ยวข้องเลยจะได้ผลลัพธ์ว่างแทนที่จะได้ของที่ใกล้เคียงที่สุดเท่าที่มี
- `/chat/` ตอบกลับแบบ stream (Server-Sent Events) ทีละ token ให้ frontend เรนเดอร์ระหว่างที่ LLM กำลังตอบ ส่วน `places` ที่เกี่ยวข้องจะมาพร้อม event `done` ตอนจบเท่านั้น
- Trip planner เป็นแบบ hybrid: LLM เลือก/จัดลำดับสถานที่ตาม context, ส่วนการคำนวณ (ระยะทาง, เวลาที่ใช้, เวลาเปิด-ปิด, ค่าใช้จ่าย) เป็น deterministic Python ล้วนๆ ไม่พึ่ง LLM
- ถ้า LLM ตอบ JSON ผิดรูปแบบหรือ trip planning ล้มเหลว จะคืน HTTP 502 ให้ frontend แสดง error ตรงๆ (ไม่มี fallback เดามั่ว)
- `knowledge_base`/`events` seed เริ่มต้นได้ผ่าน `npm run seed:events-knowledge` (ที่ `backend/`) — เพิ่มข้อมูลอื่นเพิ่มเติมได้ผ่านหน้า admin แล้วรัน `embed_content.py` ใหม่

## หมายเหตุ

- `frontend/` เดิมเป็น prototype ที่ mock ข้อมูลทั้งหมดในตัวเอง ตอนนี้เชื่อมกับฐานข้อมูลจริงผ่าน backend API (`backend/src/`) แล้ว แต่ระบบ auth ยังเป็น mock (ยังไม่ผูกกับ Google login จริง)
- Google Places sync ยังไม่เป็นแบบ live — ข้อมูลนำเข้าเป็น one-time fetch/import ผ่านสคริปต์ใน `backend/scripts/` (`fetch:places` แล้วค่อย `import:places`), admin เพิ่มสถานที่ตรงผ่านหน้า admin ได้เลย
