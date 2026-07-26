import os
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

# LLM: KKU's own Gemini gateway (OpenAI-compatible chat.completions API).
# Kept as `API_KEY` internally (matches the rest of this module) but read from
# the clearer env var name KKU_API_KEY -- the old project's .env used the
# generic name "API_KEY" for this, which read as an OpenAI key and wasn't.
API_KEY = os.environ.get("KKU_API_KEY")
BASE_URL = "https://gen.ai.kku.ac.th/api/v1"
MODEL_NAME = "gemini-2.5-flash"

# Not validated here (unlike SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY below) --
# scripts/embed_content.py imports this module too and never touches the LLM,
# so failing fast here would block it for no reason. A missing key surfaces
# naturally as an auth error the first time the chat/trip-plan endpoints
# actually call the KKU gateway.

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check chatbot-service/.env.")

# Must match the model used in scripts/embed_content.py -- query and stored
# vectors have to come from the same model or cosine distance is meaningless.
EMBEDDING_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
