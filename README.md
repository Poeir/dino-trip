# Dino Khon Kaen

เว็บแนะนำที่เที่ยว/ร้านอาหารในขอนแก่น พร้อมแชทบอทและระบบวางแผนทริปที่ขับเคลื่อนด้วย LLM

## โครงสร้างโปรเจค

โปรเจคแบ่งเป็น 3 ส่วน แยกกันรันอิสระ (ไม่ใช่ monorepo แบบ shared build):

```
main repo/
├── frontend/         # เว็บแอป (React + Vite) — หน้าเว็บที่ผู้ใช้เห็น
├── backend/          # Supabase migrations + สคริปต์ import ข้อมูลสถานที่
└── chatbot-service/  # Python (FastAPI) — แชทบอท + trip planner แบบ RAG/LLM
```

| ส่วน | เทคโนโลยี | หน้าที่ |
|---|---|---|
| `frontend/` | React 18 + Vite | UI ทั้งหมด: หน้าแรก, รายละเอียดสถานที่, แชท, ฟอร์มวางแผนทริป, หน้า admin |
| `backend/` | Node.js + Supabase CLI | schema/migrations ของฐานข้อมูล (Postgres + pgvector), สคริปต์ import ข้อมูลสถานที่จาก Google Places |
| `chatbot-service/` | Python + FastAPI | เสิร์ฟ endpoint `/chat/` และ `/trip/llm` แยกเป็นเซอร์วิสของตัวเอง รันบนเครื่อง local |

**ฐานข้อมูล**: Supabase (Postgres) โปรเจคเดียว ที่ทั้ง `backend/` และ `chatbot-service/` เชื่อมต่อเข้าไปด้วยกัน — ไม่มีฐานข้อมูลแยกของ chatbot-service เอง

## การรันโปรเจค (local)

ต้องรัน 2 process พร้อมกัน (frontend คุยกับ chatbot-service ผ่าน `fetch()` ธรรมดา ไม่ผ่าน Supabase):

### 1. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # แล้วกรอกค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev            # http://localhost:5173
```

### 2. Chatbot service

```bash
cd chatbot-service
python -m venv venv
venv\Scripts\activate        # Windows
cp .env.example .env         # แล้วกรอก KKU_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000   # http://localhost:8000
```

API docs (Swagger) ดูได้ที่ `http://localhost:8000/docs`

### 3. Backend (ใช้เฉพาะตอนตั้งค่าฐานข้อมูล/นำเข้าข้อมูล ไม่ต้องรันตลอด)

```bash
cd backend
npm install
cp .env.example .env   # แล้วกรอก SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

npx supabase db push --yes       # apply migrations ทั้งหมดใน supabase/migrations/
npm run import:places             # import ข้อมูลจาก khon_kaen_places.json (schema แบบ flat)
npm run import:places-multi       # import ข้อมูลชุด 87 สถานที่ (schema แบบ nested "DinoDB")
```

หลัง import ข้อมูลใหม่ ต้องรัน embedding ใหม่ด้วย (ที่ `chatbot-service/`):

```bash
cd chatbot-service
python scripts/embed_content.py
```

## Environment variables

| ไฟล์ | ตัวแปร | ใช้ทำอะไร |
|---|---|---|
| `frontend/.env` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | เชื่อม Supabase ฝั่ง client (anon key เท่านั้น) |
| | `VITE_CHATBOT_SERVICE_URL` | URL ของ chatbot-service (default `http://localhost:8000`) |
| `backend/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ใช้รัน migration/import script (service role key, ห้ามหลุดไปฝั่ง frontend) |
| `chatbot-service/.env` | `KKU_API_KEY` | KKU LLM gateway (OpenAI-compatible, model `gemini-2.5-flash`) |
| | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | query ข้อมูลสถานที่ + pgvector search |

## Chatbot / Trip Planner (RAG)

- Embedding model: `paraphrase-multilingual-MiniLM-L12-v2` (384 มิติ) รันบนเครื่อง local ผ่าน `sentence-transformers`
- ค้นหาสถานที่/knowledge base ด้วย cosine similarity ผ่าน Postgres function `match_places` / `match_knowledge_base` (pgvector)
- Trip planner เป็นแบบ hybrid: LLM เลือก/จัดลำดับสถานที่ตาม context, ส่วนการคำนวณ (ระยะทาง, เวลาที่ใช้, เวลาเปิด-ปิด, ค่าใช้จ่าย) เป็น deterministic Python ล้วนๆ ไม่พึ่ง LLM
- ถ้า LLM ตอบ JSON ผิดรูปแบบหรือ trip planning ล้มเหลว จะคืน HTTP 502 ให้ frontend แสดง error ตรงๆ (ไม่มี fallback เดามั่ว)
- `knowledge_base` table ปัจจุบันยังว่าง — ถ้าต้องการให้แชทตอบเรื่องทั่วไป (ประวัติศาสตร์/ประเพณี) ได้ ต้องเพิ่มข้อมูลผ่านหน้า admin แล้วรัน `embed_content.py` ใหม่

## หมายเหตุ

- `frontend/` เดิมเป็น prototype ที่ mock ข้อมูลทั้งหมดในตัวเอง ตอนนี้เชื่อมกับ Supabase จริงแล้ว แต่ระบบ auth ยังเป็น mock (ยังไม่ผูกกับ Google login จริง)
- Google Places sync ยังไม่เป็นแบบ live — ข้อมูลนำเข้าเป็น one-time import ผ่านสคริปต์ใน `backend/scripts/`, admin เพิ่มสถานที่ตรงผ่านหน้า admin ได้เลย
