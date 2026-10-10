import os
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

# LLM: KKU's own Gemini gateway (OpenAI-compatible chat.completions API).
# Kept as `API_KEY` internally (matches the rest of this module) but read from
# the clearer env var name KKU_API_KEY -- the old project's .env used the
# generic name "API_KEY" for this, which read as an OpenAI key and wasn't.
API_KEY = os.environ.get("KKU_API_KEY")
# All env-overridable so swapping models/gateway (e.g. trying one of the KKU
# gateway's other providers) is a .env edit, not a code change. Defaults match
# what this app has always shipped with, so an unset .env behaves identically
# to before.
#
# LLM_PROVIDER picks the backend: "kku" (default, API_KEY above) or "vertex"
# (Vertex AI's OpenAI-compatible endpoint, auth via Application Default
# Credentials -- see src/core/llm_client.py). Vertex needs VERTEX_PROJECT, and
# model names there carry a "google/" prefix.
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "kku").strip().lower()
if LLM_PROVIDER not in ("kku", "vertex"):
    raise ValueError(f"LLM_PROVIDER must be 'kku' or 'vertex', got {LLM_PROVIDER!r}")
VERTEX_PROJECT = os.environ.get("VERTEX_PROJECT")
VERTEX_LOCATION = os.environ.get("VERTEX_LOCATION", "global")

if LLM_PROVIDER == "vertex":
    if not VERTEX_PROJECT:
        raise ValueError("LLM_PROVIDER=vertex requires VERTEX_PROJECT. Check chatbot-service/.env.")
    _host = "aiplatform.googleapis.com" if VERTEX_LOCATION == "global" else f"{VERTEX_LOCATION}-aiplatform.googleapis.com"
    _default_base_url = f"https://{_host}/v1/projects/{VERTEX_PROJECT}/locations/{VERTEX_LOCATION}/endpoints/openapi"
    _default_model, _default_trip_model, _default_desc_model = (
        "google/gemini-2.5-flash", "google/gemini-2.5-pro", "google/gemini-2.5-flash")
else:
    _default_base_url = "https://gen.ai.kku.ac.th/api/v1"
    _default_model, _default_trip_model, _default_desc_model = "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.7-flash"

BASE_URL = os.environ.get("LLM_BASE_URL", _default_base_url)
MODEL_NAME = os.environ.get("MODEL_NAME", _default_model)

# Trip planner (generator + judge) only -- kept separate from MODEL_NAME so
# trying a different model there doesn't also change chat/events extraction.
# Currently pointed at the pro tier of the same model family: lowest risk of
# breaking the response_format={"type": "json_object"} behavior this gateway
# needs (the stricter json_schema mode is confirmed broken on it), same
# provider integration as the already-proven gemini-2.5-flash, just a larger
# model. NOTE: judge.py's PASS_SCORE_THRESHOLD was calibrated against
# gemini-2.5-flash's scoring behavior -- re-run the live test battery before
# trusting that threshold after changing this.
TRIP_PLANNER_MODEL_NAME = os.environ.get("TRIP_PLANNER_MODEL_NAME", _default_trip_model)

# scripts/generate_descriptions.py only -- same "kept separate" reasoning as
# TRIP_PLANNER_MODEL_NAME above, plus it's genuinely useful here: this script
# burns through a model's daily quota on the KKU gateway fast (~600+ calls in
# one run), so being able to point it at a different provider (e.g. gpt-5.4)
# without touching chat/events/trip-planner is the point, not just hygiene.
DESCRIPTION_MODEL_NAME = os.environ.get("DESCRIPTION_MODEL_NAME", _default_desc_model)

# Not validated here (unlike SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY below) --
# scripts/embed_content.py imports this module too and never touches the LLM,
# so failing fast here would block it for no reason. A missing key surfaces
# naturally as an auth error the first time the chat/trip-plan endpoints
# actually call the KKU gateway.

# Serper.dev (Google Search results proxy) -- used only by
# scripts/generate_descriptions.py. Same "don't validate at import" reasoning
# as API_KEY above: nothing else in the app touches this. NOT Google Custom
# Search JSON API -- that's closed to new customers as of this writing
# (existing customers only, until 2027-01-01), so this project can't get one.
SERPER_API_KEY = os.environ.get("SERPER_API_KEY")

# Token-usage tracking (src/core/usage.py). Prices are USD per 1M tokens for
# the chat/trip model -- defaults are gemini-3.8-flash's intro rate (through
# 2026-12-31; doubles from 2027-01-01), so update them when the model or rate
# changes. USAGE_LOG_PATH is a JSONL file with one line per chat turn / trip
# (read by scripts/usage_report.py); set it empty to disable the file.
LLM_PRICE_INPUT_PER_M = float(os.environ.get("LLM_PRICE_INPUT_PER_M", "0.75"))
LLM_PRICE_OUTPUT_PER_M = float(os.environ.get("LLM_PRICE_OUTPUT_PER_M", "3.75"))
USAGE_LOG_PATH = os.environ.get("USAGE_LOG_PATH", "logs/usage.jsonl")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check chatbot-service/.env.")

# Must match the model used in scripts/embed_content.py -- query and stored
# vectors have to come from the same model or cosine distance is meaningless.
# Env-overridable like the LLM settings above, but changing it is NOT a free
# action like those are: every embedding already stored in `places`/
# `knowledge_base` was computed with the old model, so changing this without
# re-running scripts/embed_content.py against the whole table makes retrieval
# silently wrong (comparing vectors from two different embedding spaces),
# not loudly broken.
EMBEDDING_MODEL_NAME = os.environ.get("EMBEDDING_MODEL_NAME", "paraphrase-multilingual-MiniLM-L12-v2")

# Comma-separated list of origins allowed to call this service from a browser,
# e.g. "https://app.example.com,http://localhost:5173". Unset keeps the old
# open "*" behaviour so local dev works; set it in production -- this service
# has no auth of its own, so CORS is the only thing limiting browser callers.
CORS_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
