"""llm_client.complete_json, the one JSON entry point for every LLM caller.
No network: the provider clients are replaced with fakes."""
import json
from types import SimpleNamespace

import pytest

from src.core import llm_client
from src.core.usage import UsageTracker

SCHEMA = {"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"], "additionalProperties": False}


class FakeAnthropic:
    def __init__(self, response):
        self.response = response
        self.kwargs = None
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.kwargs = kwargs
        return self.response


def anthropic_response(text, stop_reason="end_turn"):
    return SimpleNamespace(
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)],
        stop_reason=stop_reason,
        usage=SimpleNamespace(input_tokens=120, output_tokens=30),
    )


@pytest.fixture
def on_claude(monkeypatch):
    def install(response):
        fake = FakeAnthropic(response)
        monkeypatch.setattr(llm_client, "LLM_PROVIDER", "anthropic")
        monkeypatch.setattr(llm_client, "_anthropic_client", lambda timeout, retries: fake)
        return fake
    return install


class TestClaude:
    def test_sends_the_schema_and_no_temperature(self, on_claude):
        fake = on_claude(anthropic_response('{"a": 1}'))
        out = llm_client.complete_json(system="sys", user="hi", schema=SCHEMA, timeout=5, temperature=0.2, model="claude-x")
        assert out == {"a": 1}
        assert fake.kwargs["output_config"] == {"format": {"type": "json_schema", "schema": SCHEMA}}
        assert fake.kwargs["system"] == "sys"
        assert fake.kwargs["messages"] == [{"role": "user", "content": "hi"}]
        assert "temperature" not in fake.kwargs

    def test_usage_is_recorded_in_anthropic_units(self, on_claude):
        on_claude(anthropic_response('{"a": 1}'))
        usage = UsageTracker("trip")
        llm_client.complete_json(system="s", user="u", schema=SCHEMA, timeout=5, usage=usage, label="generate")
        assert usage.summary()["input_tokens"] == 120
        assert usage.summary()["output_tokens"] == 30

    @pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens"])
    def test_unusable_stop_reasons_raise_but_are_still_counted(self, on_claude, stop_reason):
        on_claude(anthropic_response('{"a"', stop_reason=stop_reason))
        usage = UsageTracker("trip")
        with pytest.raises(llm_client.LLMOutputError):
            llm_client.complete_json(system="s", user="u", schema=SCHEMA, timeout=5, usage=usage)
        assert usage.summary()["llm_calls"] == 1

    def test_sampling_drops_temperature(self, monkeypatch):
        monkeypatch.setattr(llm_client, "LLM_PROVIDER", "anthropic")
        assert llm_client.sampling(0.3) == {}


class TestGemini:
    def fake_openai(self, monkeypatch, content):
        calls = []

        def create(**kwargs):
            calls.append(kwargs)
            msg = SimpleNamespace(content=content)
            return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=None)

        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        monkeypatch.setattr(llm_client, "LLM_PROVIDER", "kku")
        monkeypatch.setattr(llm_client, "shared_client", lambda timeout, retries=0: client)
        return calls

    def test_asks_for_json_with_temperature_and_strips_fences(self, monkeypatch):
        calls = self.fake_openai(monkeypatch, "```json\n" + json.dumps({"a": 2}) + "\n```")
        out = llm_client.complete_json(system="s", user="u", schema=SCHEMA, timeout=5, temperature=0.2, model="gem")
        assert out == {"a": 2}
        assert calls[0]["response_format"] == {"type": "json_object"}
        assert calls[0]["temperature"] == 0.2
        assert calls[0]["model"] == "gem"

    def test_empty_reply_raises(self, monkeypatch):
        self.fake_openai(monkeypatch, None)
        with pytest.raises(llm_client.LLMOutputError):
            llm_client.complete_json(system="s", user="u", schema=SCHEMA, timeout=5)

    def test_sampling_keeps_temperature(self, monkeypatch):
        monkeypatch.setattr(llm_client, "LLM_PROVIDER", "kku")
        assert llm_client.sampling(0.3) == {"temperature": 0.3}


def test_shared_client_is_built_once():
    assert llm_client.shared_client(7.0, 0) is llm_client.shared_client(7.0, 0)
