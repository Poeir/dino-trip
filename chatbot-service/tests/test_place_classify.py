from src.services import place_classify


def _fake(reply):
    def complete_json(**kwargs):
        complete_json.prompt = kwargs["user"]
        return reply
    return complete_json


def test_picks_category_and_subcategory(monkeypatch):
    monkeypatch.setattr(place_classify, "complete_json", _fake(
        {"category": "ร้านอาหาร", "subcategory": "อาหารอีสาน", "confidence": "high", "reason": "ขายส้มตำ"}))
    out = place_classify.classify_place({"name": "แซ่บนัว", "types": ["food"]})
    assert out == {"category": "ร้านอาหาร", "subcategory": "อาหารอีสาน", "confidence": "high", "reason": "ขายส้มตำ"}


def test_none_and_unknown_values_become_null(monkeypatch):
    monkeypatch.setattr(place_classify, "complete_json", _fake(
        {"category": place_classify.NONE, "subcategory": "อาหารอีสาน", "confidence": "high", "reason": ""}))
    out = place_classify.classify_place({"name": "ด่านเก็บเงิน"})
    assert out["category"] is None and out["subcategory"] is None

    monkeypatch.setattr(place_classify, "complete_json", _fake(
        {"category": "โรงแรม", "subcategory": None, "confidence": "maybe", "reason": ""}))
    out = place_classify.classify_place({"name": "x"})
    assert out["category"] is None and out["confidence"] == "low"


def test_fixed_category_wins_and_subcategory_must_match_it(monkeypatch):
    fake = _fake({"category": "ร้านอาหาร", "subcategory": "เบเกอรี่/ของหวาน", "confidence": "high", "reason": ""})
    monkeypatch.setattr(place_classify, "complete_json", fake)
    out = place_classify.classify_place({"name": "Bake House"}, fixed_category="คาเฟ่")
    assert out["category"] == "คาเฟ่" and out["subcategory"] == "เบเกอรี่/ของหวาน"
    assert "หมวดถูกกำหนดแล้วเป็น: คาเฟ่" in fake.prompt

    monkeypatch.setattr(place_classify, "complete_json", _fake(
        {"category": "คาเฟ่", "subcategory": "อาหารอีสาน", "confidence": "high", "reason": ""}))
    out = place_classify.classify_place({"name": "x"}, fixed_category="คาเฟ่")
    assert out["subcategory"] is None
