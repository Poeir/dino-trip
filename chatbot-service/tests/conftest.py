import os

# Tests use fake LLM clients with no `usage`; keep them out of the real
# logs/usage.jsonl. Must be set before src.core.config is imported.
os.environ["USAGE_LOG_PATH"] = ""
