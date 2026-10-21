"""Single place that builds the OpenAI-SDK client for whichever LLM backend
`LLM_PROVIDER` selects ("kku" gateway or "vertex" Vertex AI's OpenAI-compatible
endpoint), so callers don't each re-implement auth.

Vertex doesn't take a static key: it needs a short-lived OAuth token (~1h) from
Application Default Credentials -- `gcloud auth application-default login` in
dev, `GOOGLE_APPLICATION_CREDENTIALS` (service-account JSON) on a VM. The token
is refreshed per request by `_GoogleAuth`, so a long-lived client never goes stale.
"""
import threading

import httpx
from openai import OpenAI

from src.core.config import (
    ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_WORKSPACE_ID, API_KEY, BASE_URL, LLM_PROVIDER,
)

_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]


class _GoogleAuth(httpx.Auth):
    def __init__(self):
        self._creds = None
        self._lock = threading.Lock()

    def _token(self) -> str:
        # Imported lazily so the KKU path (and embed_content.py) doesn't need google-auth.
        import google.auth
        from google.auth.transport.requests import Request

        with self._lock:
            if self._creds is None:
                self._creds, _ = google.auth.default(scopes=_SCOPES)
            if not self._creds.valid:
                self._creds.refresh(Request())
            return self._creds.token

    def auth_flow(self, request):
        request.headers["Authorization"] = f"Bearer {self._token()}"
        yield request


def make_llm_client(provider: str | None = None, **kwargs) -> OpenAI:
    """Drop-in for `OpenAI(api_key=API_KEY, base_url=BASE_URL, **kwargs)`.

    `provider` overrides LLM_PROVIDER for one caller; "anthropic" is only used
    that way (chat experiment) because its OpenAI-compat endpoint rejects
    response_format json_object, which trip planner / events extraction need."""
    provider = provider or LLM_PROVIDER
    if provider == "anthropic":
        if not ANTHROPIC_API_KEY:
            raise ValueError("CHAT_LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY. Check chatbot-service/.env.")
        # Keys not scoped to a workspace must name one in a header.
        headers = {"anthropic-workspace-id": ANTHROPIC_WORKSPACE_ID} if ANTHROPIC_WORKSPACE_ID else None
        return OpenAI(api_key=ANTHROPIC_API_KEY, base_url=ANTHROPIC_BASE_URL, default_headers=headers, **kwargs)
    if provider == "vertex":
        # api_key is required by the SDK but overridden by _GoogleAuth on each request.
        return OpenAI(api_key="vertex-adc", base_url=BASE_URL, http_client=httpx.Client(auth=_GoogleAuth()), **kwargs)
    return OpenAI(api_key=API_KEY, base_url=BASE_URL, **kwargs)
