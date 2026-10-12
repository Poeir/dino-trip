"""Per-role LLM provider for the eval only (production keeps one LLM_PROVIDER).

Vertex AI here serves Gemini only, while the KKU gateway serves many families,
so an eval wants "generate with one, judge with the other". A model spec is

    kku:claude-sonnet-5.5      explicit provider
    vertex:gemini-2.5-pro      "google/" is added when the name has no "/"
    gemini-3.8-flash           no prefix -> LLM_PROVIDER (what production uses)

so a spec without a prefix behaves exactly as before. Nothing under src/ is
touched: the production client is reused when the provider is the active one,
and only the other provider is built here.
"""
import os

import httpx
from openai import OpenAI

from src.core.config import API_KEY, LLM_PROVIDER, VERTEX_LOCATION, VERTEX_PROJECT
from src.core.llm_client import _GoogleAuth, make_llm_client

PROVIDERS = ("kku", "vertex")
# Only used when KKU is NOT the active provider (otherwise config.BASE_URL, which
# honours LLM_BASE_URL, is used).
_KKU_BASE_URL = os.environ.get("EVAL_KKU_BASE_URL", "https://gen.ai.kku.ac.th/api/v1")


def parse_spec(spec):
    """'provider:model' | 'model' -> (provider, model). None/'' -> (LLM_PROVIDER, None)."""
    if not spec:
        return LLM_PROVIDER, None
    head, sep, rest = spec.partition(":")
    if sep and head.strip().lower() in PROVIDERS:
        provider, model = head.strip().lower(), rest.strip()
        if not model:
            raise ValueError(f"model name missing in {spec!r}")
        if provider == "vertex" and "/" not in model:
            model = f"google/{model}"
        return provider, model
    # No provider prefix: the name is passed through untouched, as before.
    return LLM_PROVIDER, spec.strip()


def _vertex_base_url():
    host = "aiplatform.googleapis.com" if VERTEX_LOCATION == "global" else f"{VERTEX_LOCATION}-aiplatform.googleapis.com"
    return f"https://{host}/v1/projects/{VERTEX_PROJECT}/locations/{VERTEX_LOCATION}/endpoints/openapi"


def check_provider(provider):
    """Fail before any job is queued, not once per job."""
    if provider == "vertex" and not VERTEX_PROJECT:
        raise SystemExit("provider 'vertex' needs VERTEX_PROJECT in chatbot-service/.env")
    if provider == "kku" and not API_KEY:
        raise SystemExit("provider 'kku' needs KKU_API_KEY in chatbot-service/.env")


def make_client(provider, **kwargs) -> OpenAI:
    check_provider(provider)
    if provider == LLM_PROVIDER:
        return make_llm_client(**kwargs)
    if provider == "vertex":
        return OpenAI(api_key="vertex-adc", base_url=_vertex_base_url(), http_client=httpx.Client(auth=_GoogleAuth()), **kwargs)
    return OpenAI(api_key=API_KEY, base_url=_KKU_BASE_URL, **kwargs)
