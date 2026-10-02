# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The user writes in Thai and prefers replies in Thai by default. UI strings and API error messages are Thai. `README.md` (Thai) has the full setup/env-var tables.

## Layout

Three independently-run services (not a shared-build monorepo):

- `frontend/` — React 18 + Vite + react-router-dom (JS, no TS, no linter/test runner)
- `backend/` — Express (ESM) + knex/pg against Supabase Postgres (+ pgvector); owns migrations in `backend/supabase/migrations/`
- `chatbot-service/` — Python FastAPI: chatbot (`/chat/`, SSE streaming), trip planner (`/trip/llm`), event extraction, admin reindex

## Commands

```bash
# backend (http://localhost:4000)
cd backend && npm run dev                 # node --watch src/server.js
npx supabase db push --yes                # apply supabase/migrations/*
npm run fetch:places | import:places | seed:events-knowledge   # one-off data scripts

# frontend (http://localhost:5173)
cd frontend && npm run dev | build | preview

# chatbot-service (http://localhost:8000, Swagger at /docs)
cd chatbot-service && venv\Scripts\activate
uvicorn src.main:app --reload --port 8000
pytest                                     # default run excludes -m live
pytest tests/test_route_scheduler.py::test_name   # single test
pytest -m live                             # hits real LLM + DB (costs money)
python scripts/embed_content.py            # re-embed after importing/editing places or knowledge base
```

## Architecture

**Data flow:** the frontend never talks to Supabase. It calls the Express API (`frontend/src/lib/apiClient.js`, `credentials: 'include'` for httpOnly session cookies; `AppContext.jsx` bulk-loads tables on page load) and, for chat/trip planning, chatbot-service directly via `VITE_CHATBOT_SERVICE_URL`. Backend connects via `DATABASE_URL` (knex, `lib/db.js`).

**chatbot-service has no auth.** Any backend route that needs it (admin reindex, event extraction, etc.) must go through `backend/src/lib/chatbotProxy.js` (`forwardToChatbotService`), with the Node route's auth middleware as the real gate. Don't point the browser at those endpoints.

**Backend:** `src/app.js` mounts one router per resource under `/api/*`; `routes/admin*.routes.js` are admin-guarded (`middleware/requireAdmin.js`). Simple tables use `lib/crudRouter.js`, which has an in-memory list cache (25s TTL, in-flight de-duplication) — any route that mutates a table outside crudRouter (photo upload/delete, sync jobs) must call `invalidateCache(table)`. The chatbot service also writes `embedding` columns directly, which is why the TTL exists. `lib/mappers.js` converts DB rows to API shape. `pg` DATE columns are deliberately parsed as plain `YYYY-MM-DD` strings.

**Place sync & reports** (`services/placeSync.js`, `placeSyncJobs.js`, `lib/placeFields.js`, `*Reports.routes.js`): backend-owned Google Places sync (no CLI). Admins can lock individual fields; a locked field's newer Google value is parked as a diff rather than applied. Users file reports on places/events, which admins review. `SYNC_FIELDS`/`REPORT_FIELDS` in `placeFields.js` mirror CHECK constraints in migration `20260929000002_place_sync_and_reports.sql` — change both together. Each synced place costs one billable Places API call (jobs cap at 500 items, `confirm:true` above 100).

**Chatbot/trip planner:** RAG with local `paraphrase-multilingual-MiniLM-L12-v2` embeddings (384-d) and Postgres functions `match_places` / `match_knowledge_base` with a similarity threshold (unrelated queries return empty). Trip planner is hybrid: the LLM picks/orders places; distances, durations, opening hours and costs are deterministic Python (`services/trip_planner/route_scheduler.py`, `orchestrator.py`). Malformed LLM JSON or planning failure returns HTTP 502 — no fallback guessing. LLM is the KKU gateway (OpenAI-compatible); config defaults in `src/core/config.py`.

## Gotchas

- After importing places or editing knowledge base/events, run `embed_content.py` or search results go stale.
- Security checklist still open: anonymous write on content tables, rate limiting coverage (`lib/rateLimit.js`), prod cookie/HTTPS settings. Don't weaken auth/RLS (`20260929000001_drop_public_write_policies.sql`).
- Frontend `data/khon_kaen_places.json` / `seed.js` are leftover prototype data; real data comes from the API.
