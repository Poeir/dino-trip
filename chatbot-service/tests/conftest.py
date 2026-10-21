import os

# Tests use fake LLM clients with no `usage`; keep them out of the real
# logs/usage.jsonl. Must be set before src.core.config is imported.
os.environ["USAGE_LOG_PATH"] = ""
# Unit tests assume the default (non-Claude) chat setup, whatever the dev .env sets.
os.environ["CHAT_LLM_PROVIDER"] = ""
