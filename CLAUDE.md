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
npm test                                  # node --test (backend/test/*.test.js)
node --test test/seo.test.js              # single backend test file
npx supabase db push --yes                # apply supabase/migrations/* (see migration caveat in Gotchas before using on the live DB)
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

## CI / Deploy

- CI: `ci-frontend.yml` runs only `npm run build` (the build is the frontend's only check); `ci-chatbot.yml` runs `pytest` with dummy `KKU_API_KEY`/`SUPABASE_*` env (`config.py` refuses to import without them). The backend has no CI job.
- Push to `main` touching any service or `deploy/**` triggers `deploy-chatbot.yml`, which SSHes to the VPS and runs `deploy/deploy.sh` (ff-only merge of `origin/main`, rebuilds chatbot → backend → caddy one at a time, `docker compose up`). The root `VERSION` file feeds `APP_VERSION`. Day-to-day work happens on `dev`; merging to `main` deploys.

## Architecture

**Data flow:** the frontend never talks to Supabase. It calls the Express API (`frontend/src/lib/apiClient.js`, `credentials: 'include'` for httpOnly session cookies; `AppContext.jsx` bulk-loads tables on page load) and, for chat/trip planning, chatbot-service directly via `VITE_CHATBOT_SERVICE_URL`. Backend connects via `DATABASE_URL` (knex, `lib/db.js`).

**chatbot-service has no auth.** Any backend route that needs it (admin reindex, event extraction, etc.) must go through `backend/src/lib/chatbotProxy.js` (`forwardToChatbotService`), with the Node route's auth middleware as the real gate. Don't point the browser at those endpoints.

**Backend:** `src/app.js` mounts one router per resource under `/api/*`; `routes/admin*.routes.js` are admin-guarded (`middleware/requireAdmin.js`). Simple tables use `lib/crudRouter.js`, which has an in-memory list cache (25s TTL, in-flight de-duplication) — any route that mutates a table outside crudRouter (photo upload/delete, sync jobs) must call `invalidateCache(table)`. The chatbot service also writes `embedding` columns directly, which is why the TTL exists. `lib/mappers.js` converts DB rows to API shape. `pg` DATE columns are deliberately parsed as plain `YYYY-MM-DD` strings.

**Place sync & reports** (`services/placeSync.js`, `placeSyncJobs.js`, `lib/placeFields.js`, `*Reports.routes.js`): backend-owned Google Places sync (no CLI). Admins can lock individual fields; a locked field's newer Google value is parked as a diff rather than applied. Users file reports on places/events, which admins review. `SYNC_FIELDS`/`REPORT_FIELDS` in `placeFields.js` mirror CHECK constraints in migration `20260929000002_place_sync_and_reports.sql` — change both together. Each synced place costs one billable Places API call (jobs cap at 500 items, `confirm:true` above 100).

**Chatbot/trip planner:** RAG with local `paraphrase-multilingual-MiniLM-L12-v2` embeddings (384-d) and Postgres functions `match_places` / `match_knowledge_base` with a similarity threshold (unrelated queries return empty). Trip planner is hybrid: the LLM picks/orders places; distances, durations, opening hours and costs are deterministic Python (`services/trip_planner/route_scheduler.py`, `orchestrator.py`). Malformed LLM JSON or planning failure returns HTTP 502 — no fallback guessing. LLM is the KKU gateway (OpenAI-compatible); config defaults in `src/core/config.py`.

## Gotchas

- After importing places or editing knowledge base/events, run `embed_content.py` or search results go stale.
- Migrations: as of 2026-09-29 the live DB has no `supabase_migrations` history, so `db push` would replay every old migration. Apply new ones individually (one transaction each) or repair history first, and re-check `pg_policies` / grants afterwards. SQL functions like `claim_qr_scan` are `security definer`, executable by `service_role` only; re-verify grants if a migration recreates them.
- Security: anonymous write on content tables is fixed (`20260929000001_drop_public_write_policies.sql`) — don't weaken auth/RLS. `crudRouter` mutations default to admin-only. Rate limits live in `lib/rateLimit.js` (auth, scan, profile, trips, reports, sync, plus a global per-IP cap) and in chatbot-service `src/core/rate_limit.py`. Still open: no CSP, upload type checked by client mimetype only, no account lockout beyond rate limits.
- Production is a single origin on the OVH VPS (`dinokhonkaen.app`): Caddy (`deploy/caddy/Caddyfile`) serves the SPA, proxies `/api` → backend and `/chat`, `/trip/llm` → chatbot (only `/trip/llm`; `/trip/result` and `/trip/<id>` are SPA pages). Vercel/Render are retired. The session cookie is `sameSite: 'lax'`, which relies on this single origin. Caddy also sends non-JS crawlers to `backend/src/routes/seo.routes.js` for pre-rendered meta/JSON-LD; keep titles in `lib/seo.js` and `frontend/src/lib/useSeo.js` in sync.
- Chatbot-service env in prod must set `MODEL_NAME` and `TRIP_PLANNER_MODEL_NAME` (the KKU gateway returns 401 "Invalid model" otherwise); a chat reply of "ระบบแชทขัดข้องชั่วคราว" usually means the LLM call failed or the daily quota is exhausted — check `docker compose logs chatbot` first. Env URLs (`FRONTEND_ORIGIN`, `VITE_API_URL`) must have no trailing slash.
- Versioning: root `VERSION` is the single source (keep `frontend/package.json` and `backend/package.json` equal to it). Admin dashboard shows per-service version/SHA via `GET /api/admin/stats/system`.
- Windows: edit files with the Edit tool, not Python heredocs (CRLF conversion, lost backslashes); shell scripts and Dockerfiles must stay LF.
- Frontend `data/seed.js` only holds UI constants (categories, trip-form lists, admin tabs); the old prototype sample data and its 408KB Google Places dump were removed. Real data comes from the API.
- Frontend performance rules that are easy to undo by accident: images go through `lib/cloudinary.js` `cld()` (via `ImageSlot`), non-landing routes are `lazyPage()` chunks (see `App.jsx`), the Thai address table loads through `useThaiAddress()`, fonts are self-hosted WOFF2 (no Google Fonts), and `deploy/caddy/Caddyfile` sets the Cache-Control headers.
