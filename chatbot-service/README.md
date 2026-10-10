# Khon Kaen AI Trip Planner -- Chatbot Service

FastAPI service for the chatbot (RAG, SSE streaming), the trip planner,
event extraction and admin reindexing. Interactive API reference at `/docs`
once running. This service has no auth of its own: admin endpoints must be
reached through the backend (`backend/src/lib/chatbotProxy.js`), never
directly from the browser.

## Endpoints

- `POST /chat/` -- chatbot, streamed as Server-Sent Events
- `POST /trip/llm` -- trip planner (LLM picks places, Python computes times/costs)
- `POST /events/extract` -- event extraction
- `POST /admin/reindex`, `GET /admin/reindex/status`, `GET /admin/reindex/pending`
- `GET /health`, `GET /version` (version + git SHA; not exposed publicly by Caddy)

## Run locally

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn src.main:app --reload --port 8000
pytest              # excludes -m live (real LLM + DB, costs money)
```

## Environment

Required: `KKU_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

In production also set `MODEL_NAME` and `TRIP_PLANNER_MODEL_NAME` (the KKU
gateway rejects the code's defaults with `401 Invalid model`) and
`CORS_ORIGINS` (comma-separated, no trailing slash; defaults to `*`).

Optional (defaults in `src/core/config.py`): `LLM_BASE_URL`,
`DESCRIPTION_MODEL_NAME`, `EMBEDDING_MODEL_NAME` (changing it needs a
re-embed), `RATE_LIMIT_CHAT_PER_MINUTE`, `RATE_LIMIT_CHAT_PER_HOUR`,
`RATE_LIMIT_TRIP_PER_HOUR`, `APP_VERSION`, `GIT_SHA`.
`SERPER_API_KEY` is only used by `scripts/generate_descriptions.py`.

## Data and deploy

Places and knowledge-base data live in Supabase and are seeded from
`../backend/scripts/`; after importing or editing them run
`python scripts/embed_content.py`.

In production this runs as the `chatbot` service in `../deploy/docker-compose.yml`
behind Caddy (see the root README). The Dockerfile listens on `${PORT:-7860}`.
