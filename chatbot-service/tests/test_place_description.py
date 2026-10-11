import json
from types import SimpleNamespace

from src.services import place_description as pd


class FakeClient:
    """Minimal stand-in for the OpenAI client. `outcomes` is consumed one per
    call: a str is returned as the model's JSON `description`, an Exception is
    raised."""

    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.models_used = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, model, **_):
        self.models_used.append(model)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        msg = SimpleNamespace(content=json.dumps({"description": outcome}))
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def place(**over):
    base = {
        "name": "น้ำตกทดสอบ", "category": "สถานที่ท่องเที่ยว", "district": None,
        "tags": ["ธรรมชาติ"], "amenities": [], "rating": 4.5, "review_count": 10,
        "reviews": [{"stars": 5, "text": "น้ำใส ร่มรื่น"}],
    }
    base.update(over)
    return base


def test_reviews_only_when_search_finds_nothing(monkeypatch):
    monkeypatch.setattr(pd, "search_for_place", lambda *_: [])
    client = FakeClient(["คำอธิบายจากรีวิว"])
    out = pd.generate_description(client, place())
    assert out == {"description": "คำอธิบายจากรีวิว", "source": "reviews_only"}


def test_search_assisted_when_search_has_results(monkeypatch):
    monkeypatch.setattr(pd, "search_for_place", lambda *_: [{"title": "t", "snippet": "s", "link": "https://e.com"}])
    client = FakeClient(["คำอธิบาย"])
    assert pd.generate_description(client, place(reviews=[]))["source"] == "search_assisted"


def test_template_without_calling_llm_when_no_sources(monkeypatch):
    monkeypatch.setattr(pd, "search_for_place", lambda *_: [])
    client = FakeClient([])
    out = pd.generate_description(client, place(reviews=[]))
    assert out["source"] == "template_only"
    assert out["description"] == "น้ำตกทดสอบ - สถานที่ท่องเที่ยว ธรรมชาติในขอนแก่น"
    assert client.models_used == []


def test_template_when_llm_keeps_failing(monkeypatch):
    monkeypatch.setattr(pd, "search_for_place", lambda *_: [])
    client = FakeClient([RuntimeError("boom"), RuntimeError("boom")])
    assert pd.generate_description(client, place())["source"] == "template_only"
    assert len(client.models_used) == pd.MAX_LLM_ATTEMPTS


def test_daily_limit_moves_to_next_model(monkeypatch):
    monkeypatch.setattr(pd, "search_for_place", lambda *_: [])
    monkeypatch.setattr(pd, "MODEL_FALLBACK_CHAIN", ["m1", "m2"])
    client = FakeClient([RuntimeError("daily limit reached"), "ok"])
    chain = pd.ModelChain()
    out = pd.generate_description(client, place(), chain)
    assert out["description"] == "ok"
    assert client.models_used == ["m1", "m2"]
    assert chain.model == "m2"


def test_fetch_page_text_skips_blocked_and_non_http():
    assert pd.fetch_page_text("https://www.facebook.com/x") is None
    assert pd.fetch_page_text("file:///etc/passwd") is None
    assert pd.fetch_page_text("ftp://example.com/x") is None


def test_needs_processing_detects_generic_and_fallback_descriptions():
    base = {"name": "ร้าน", "category": "คาเฟ่", "tags": [], "amenities": []}
    assert pd.needs_processing({**base, "description": "คาเฟ่ในขอนแก่น คะแนนรีวิว 4.5 ดาว"})
    assert pd.needs_processing({**base, "description": pd.template_description("ร้าน", "คาเฟ่", [], [])})
    assert not pd.needs_processing({**base, "description": "ร้านกาแฟบรรยากาศดี มีมุมถ่ายรูปริมบึง"})
