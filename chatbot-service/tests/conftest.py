import os

# Tests use fake LLM clients with no `usage`; keep them out of the real
# logs/usage.jsonl. Must be set before src.core.config is imported.
os.environ["USAGE_LOG_PATH"] = ""
# Unit tests assume the default (KKU gateway) provider, whatever the dev .env
# sets: Claude would need ANTHROPIC_API_KEY just to build a client.
os.environ["LLM_PROVIDER"] = "kku"
os.environ.setdefault("KKU_API_KEY", "test-key")
