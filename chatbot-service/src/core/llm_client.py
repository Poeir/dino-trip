"""The one place this service talks to an LLM. Every caller (chat, trip
planner + judge, event extraction, place descriptions, data scripts) uses the
provider and model set by LLM_PROVIDER / MODEL_NAME in config.py.

Two kinds of call:

- Text and streaming (the chatbot): `shared_client()` / `make_llm_client()`
  return an OpenAI-SDK client for the active provider -- the KKU gateway,
  Vertex AI, or Anthropic's OpenAI-compatible endpoint -- so the chat code is
  the same whichever is active. `sampling(t)` gives the temperature argument,
  or nothing on Claude, whose current models reject a temperature.

- JSON (`complete_json`): on Claude this uses the native Anthropic SDK with
  structured outputs, so the reply is guaranteed to match the schema (the
  OpenAI-compatible endpoint ignores response_format entirely). On kku/vertex
  it asks for a JSON object and parses it; the schema isn't enforced there.

Vertex doesn't take a static key: it needs a short-lived OAuth token (~1h) from
Application Default Credentials -- `gcloud auth application-default login` in
dev, `GOOGLE_APPLICATION_CREDENTIALS` (service-account JSON) on a VM. The token
is refreshed per request by `_GoogleAuth`, so a long-lived client never goes stale.

Clients are built once per (timeout, retries) and reused: building one loads
the TLS certificate store, measured at ~0.25s each, and a trip used to build
two per request.
"""
import json
import threading
from functools import lru_cache

import httpx
from openai import OpenAI

from src.core.config import (
    ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID, API_KEY, BASE_URL, LLM_PROVIDER, MODEL_NAME,
)
from src.services.trip_planner.json_utils import clean_json_string

_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

# Room for the model's thinking plus the JSON itself. Non-streamed calls must
# stay well under the SDK's long-request limit, which this does.
JSON_MAX_TOKENS = 16000


class LLMOutputError(Exception):
    """The model answered, but not with usable JSON (refusal, cut off, empty)."""


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


def _require_anthropic_key():
    if not ANTHROPIC_API_KEY:
        raise ValueError("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY. Check chatbot-service/.env.")


def _anthropic_headers():
    # Keys not scoped to a workspace must name one in a header.
    return {"anthropic-workspace-id": ANTHROPIC_WORKSPACE_ID} if ANTHROPIC_WORKSPACE_ID else None


def make_llm_client(**kwargs) -> OpenAI:
    """A new OpenAI-SDK client for the active provider. Prefer shared_client();
    this is for callers that need their own (tests, one-off scripts)."""
    if LLM_PROVIDER == "anthropic":
        _require_anthropic_key()
        return OpenAI(api_key=ANTHROPIC_API_KEY, base_url=BASE_URL, default_headers=_anthropic_headers(), **kwargs)
    if LLM_PROVIDER == "vertex":
        # api_key is required by the SDK but overridden by _GoogleAuth on each request.
        return OpenAI(api_key="vertex-adc", base_url=BASE_URL, http_client=httpx.Client(auth=_GoogleAuth()), **kwargs)
    return OpenAI(api_key=API_KEY, base_url=BASE_URL, **kwargs)


@lru_cache(maxsize=None)
def shared_client(timeout: float, max_retries: int = 0) -> OpenAI:
    """One long-lived OpenAI-SDK client per (timeout, retries)."""
    return make_llm_client(timeout=timeout, max_retries=max_retries)


@lru_cache(maxsize=None)
def _anthropic_client(timeout: float, max_retries: int):
    import anthropic  # only needed when Claude is the provider

    _require_anthropic_key()
    return anthropic.Anthropic(
        api_key=ANTHROPIC_API_KEY, base_url="https://api.anthropic.com",
        default_headers=_anthropic_headers(), timeout=timeout, max_retries=max_retries,
    )


def sampling(temperature: float) -> dict:
    """The temperature argument for an OpenAI-SDK call: none on Claude, whose
    current models return 400 for any non-default value."""
    return {} if LLM_PROVIDER == "anthropic" else {"temperature": temperature}


def complete_json(
    *, system: str, user: str, schema: dict, timeout: float, max_retries: int = 0,
    temperature: float = 0.0, usage=None, label: str = "llm", model: str | None = None,
) -> dict:
    """One LLM call that returns a parsed JSON object.

    `schema` is a JSON Schema for the reply (every object needs
    "additionalProperties": false). Claude is held to it; kku/vertex only get
    asked for JSON, so callers keep validating what they read. `temperature`
    applies to kku/vertex only. `model` overrides MODEL_NAME for one call
    (place descriptions walk a quota fallback chain on the KKU gateway).
    Usage is recorded on `usage` (a UsageTracker) before parsing, so a call
    whose output can't be used is still counted -- it was billed. Raises on
    any failure; retrying is the caller's choice."""
    model = model or MODEL_NAME
    if LLM_PROVIDER == "anthropic":
        response = _anthropic_client(timeout, max_retries).messages.create(
            model=model,
            max_tokens=JSON_MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={"format": {"type": "json_schema", "schema": schema}},
        )
        if usage is not None:
            usage.record_response(label, model, response)
        if response.stop_reason in ("refusal", "max_tokens"):
            raise LLMOutputError(f"stop_reason={response.stop_reason}")
        text = next((b.text for b in response.content if b.type == "text"), "")
        if not text:
            raise LLMOutputError("empty reply")
        return json.loads(text)

    response = shared_client(timeout, max_retries).chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        stream=False,
        temperature=temperature,
        response_format={"type": "json_object"},
    )
    if usage is not None:
        usage.record_response(label, model, response)
    content = response.choices[0].message.content
    if not content:
        raise LLMOutputError("empty reply")
    return json.loads(clean_json_string(content))
