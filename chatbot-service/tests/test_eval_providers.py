"""Eval-only provider selection (evals/trip_prompt/providers.py). No network."""
import pytest

from evals.trip_prompt import providers


@pytest.fixture
def kku_active(monkeypatch):
    monkeypatch.setattr(providers, "LLM_PROVIDER", "kku")
    monkeypatch.setattr(providers, "API_KEY", "k-test")
    monkeypatch.setattr(providers, "VERTEX_PROJECT", "proj-1")
    monkeypatch.setattr(providers, "VERTEX_LOCATION", "global")


class TestParseSpec:
    def test_no_spec_means_active_provider(self, kku_active):
        assert providers.parse_spec(None) == ("kku", None)
        assert providers.parse_spec("") == ("kku", None)

    def test_plain_name_passes_through_untouched(self, kku_active, monkeypatch):
        assert providers.parse_spec("gemini-3.8-flash") == ("kku", "gemini-3.8-flash")
        monkeypatch.setattr(providers, "LLM_PROVIDER", "vertex")
        # unchanged behaviour: no prefix is invented for a name given without a provider
        assert providers.parse_spec("gemini-2.5-pro") == ("vertex", "gemini-2.5-pro")

    def test_explicit_kku(self, kku_active):
        assert providers.parse_spec("kku:claude-sonnet-5.5") == ("kku", "claude-sonnet-5.5")

    def test_explicit_vertex_gets_google_prefix_once(self, kku_active):
        assert providers.parse_spec("vertex:gemini-2.5-pro") == ("vertex", "google/gemini-2.5-pro")
        assert providers.parse_spec("vertex:google/gemini-2.5-pro") == ("vertex", "google/gemini-2.5-pro")

    def test_colon_in_a_model_name_is_not_a_provider(self, kku_active):
        assert providers.parse_spec("llama:70b") == ("kku", "llama:70b")

    def test_provider_without_model_is_rejected(self, kku_active):
        with pytest.raises(ValueError):
            providers.parse_spec("kku:")


class TestMakeClient:
    def test_active_provider_uses_the_production_client(self, kku_active, monkeypatch):
        sentinel = object()
        monkeypatch.setattr(providers, "make_llm_client", lambda **kw: sentinel)
        assert providers.make_client("kku") is sentinel

    def test_vertex_while_kku_is_active(self, kku_active):
        client = providers.make_client("vertex")
        assert str(client.base_url).startswith("https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global/")

    def test_vertex_regional_host(self, kku_active, monkeypatch):
        monkeypatch.setattr(providers, "VERTEX_LOCATION", "us-central1")
        assert str(providers.make_client("vertex").base_url).startswith("https://us-central1-aiplatform.googleapis.com/")

    def test_kku_while_vertex_is_active(self, kku_active, monkeypatch):
        monkeypatch.setattr(providers, "LLM_PROVIDER", "vertex")
        client = providers.make_client("kku")
        assert client.api_key == "k-test"
        assert str(client.base_url).startswith(providers._KKU_BASE_URL)

    def test_missing_vertex_project_fails_before_any_job(self, kku_active, monkeypatch):
        monkeypatch.setattr(providers, "VERTEX_PROJECT", None)
        with pytest.raises(SystemExit):
            providers.check_provider("vertex")

    def test_missing_kku_key_fails_before_any_job(self, kku_active, monkeypatch):
        monkeypatch.setattr(providers, "API_KEY", None)
        with pytest.raises(SystemExit):
            providers.check_provider("kku")
