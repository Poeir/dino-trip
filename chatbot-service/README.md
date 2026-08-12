---
title: Khon Kaen AI Trip Planner
emoji: 🧭
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Khon Kaen AI Trip Planner -- Chatbot Service

FastAPI backend serving the chatbot, trip planner, and event extraction
endpoints. See `/docs` for the interactive API reference once running.

## Required secrets

Set these in the Space's **Settings -> Variables and secrets**:

- `KKU_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SERPER_API_KEY` (only needed for `scripts/generate_descriptions.py`, not used at request time)

Optional overrides (defaults shown in `src/core/config.py`):

- `LLM_BASE_URL`
- `MODEL_NAME`
- `TRIP_PLANNER_MODEL_NAME`
- `DESCRIPTION_MODEL_NAME`
- `EMBEDDING_MODEL_NAME`

Places/knowledge_base data lives in Supabase and is seeded from
`../backend/scripts/` -- there is nothing to seed inside this Space.
