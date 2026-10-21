import pytest

from src.services import place_description as pd


class FakeLLM:
    """Stands in for llm_client.complete_json. `outcomes` is consumed one per
    call: a str is returned as the JSON `description`, an Exception is raised."""

    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.models_used = []

    def __call__(self, *, model, **_):
        self.models_used.append(model)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return {"description": outcome}


@pytest.fixture
def fake_llm(monkeypatch):
    def install(outcomes):
        fake = FakeLLM(outcomes)
        monkeypatch.setattr(pd, "complete_json", fake)
        return fake
    return install


def place(**over):
    base = {
        "name": "น้ำตกทดสอบ", "category": "สถานที่ท่องเที่ยว", "district": None,
        "tags": ["ธรรมชาติ"], "amenities": [], "rating": 4.5, "review_count": 10,
        "reviews": [{"stars": 5, "text": "น้ำใส ร่มรื่น"}],
    }
    base.update(over)
    return base


def test_reviews_only_when_search_finds_nothing(monkeypatch, fake_llm):
    monkeypatch.setattr(pd, "search_for_place", lambda *_: [])
    fake_llm(["คำอธิบายจากรีวิว"])
    out = pd.generate_description(place())
    assert out == {"description": "คำอธิบายจากรีวิว", "source": "reviews_only"}


def test_search_assisted_when_search_has_results(monkeypatch, fake_llm):
    monkeypatch.setattr(pd, "search_for_place", lambda *_: [{"title": "t", "snippet": "s", "link": "https://e.com"}])
    fake_llm(["คำอธิบาย"])
    assert pd.generate_description(place(reviews=[]))["source"] == "search_assisted"


def test_template_without_calling_llm_when_no_sources(monkeypatch, fake_llm):
    monkeypatch.setattr(pd, "search_for_place", lambda *_: [])
    llm = fake_llm([])
    out = pd.generate_description(place(reviews=[]))
    assert out["source"] == "template_only"
    assert out["description"] == "น้ำตกทดสอบ - สถานที่ท่องเที่ยว ธรรมชาติในขอนแก่น"
    assert llm.models_used == []


def test_template_when_llm_keeps_failing(monkeypatch, fake_llm):
    monkeypatch.setattr(pd, "search_for_place", lambda *_: [])
    llm = fake_llm([RuntimeError("boom"), RuntimeError("boom")])
    assert pd.generate_description(place())["source"] == "template_only"
    assert len(llm.models_used) == pd.MAX_LLM_ATTEMPTS


def test_daily_limit_moves_to_next_model(monkeypatch, fake_llm):
    monkeypatch.setattr(pd, "search_for_place", lambda *_: [])
    monkeypatch.setattr(pd, "MODEL_FALLBACK_CHAIN", ["m1", "m2"])
    llm = fake_llm([RuntimeError("daily limit reached"), "ok"])
    chain = pd.ModelChain()
    out = pd.generate_description(place(), chain)
    assert out["description"] == "ok"
    assert llm.models_used == ["m1", "m2"]
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
