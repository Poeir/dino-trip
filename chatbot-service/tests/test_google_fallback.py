"""Google fallback for thin "แถว X" answers (rag/google_fallback.py) and how
retriever merges it. No network: Google and the DB RPCs are faked."""
import datetime

import pytest

from src.core.clock import BANGKOK_TZ
from src.services.rag import area, google_fallback as gf, retriever


def g(gid="a", name="ร้านดี", address="ตำบลพระยืน อำเภอ พระยืน ขอนแก่น 40320", rating=4.5, count=50,
      types=("cafe",), status="OPERATIONAL", **extra):
    return {"id": gid, "displayName": {"text": name}, "formattedAddress": address, "rating": rating,
            "userRatingCount": count, "types": list(types), "businessStatus": status, **extra}


@pytest.fixture
def on(monkeypatch):
    """Feature on, nothing real called: search returns what the test sets."""
    monkeypatch.setattr(gf, "GOOGLE_PLACES_API_KEY", "test-key")
    monkeypatch.setattr(gf, "GOOGLE_FALLBACK_DAILY_CAP", 100)
    monkeypatch.setattr(gf, "_rpc", lambda name, params: True)
    monkeypatch.setattr(gf, "record_candidates", lambda rows, where: None)
    gf._cache.clear()
    return monkeypatch


# ---------------------------------------------------------------- filtering


def test_keeps_a_good_place_in_the_area():
    assert gf.keep(g(), "พระยืน", set())


@pytest.mark.parametrize("place, why", [
    (g(address="ถ. เลี่ยงเมือง ตำบลเมืองเก่า อำเภอเมืองขอนแก่น ขอนแก่น"), "another area"),
    (g(address="อำเภอ พระยืน นครราชสีมา"), "another province"),
    (g(rating=3.9), "rating"),
    (g(count=3), "too few reviews"),
    (g(types=("general_contractor",)), "not a kind we recommend"),
    (g(status="CLOSED_PERMANENTLY"), "closed"),
    (g(name="Café Amazon สาขา ปตท.พระยืน"), "chain"),
    (g(name="Cookie Cafe"), "already in our DB"),
])
def test_drops(place, why):
    assert not gf.keep(place, "พระยืน", {"cookie cafe"}), why


def test_any_restaurant_subtype_counts():
    assert gf.wanted(["korean_barbecue_restaurant"])


def test_in_area_ignores_googles_spacing():
    assert gf.in_area("ตำบล ท่าพระ อำเภอเมืองขอนแก่น", "ท่าพระ")
    assert gf.in_area("อำเภอ มัญจาคีรี ขอนแก่น", "มัญจาคีรี")


def test_rating_is_weighted_by_review_count():
    few, many = g(rating=5.0, count=3), g(rating=4.7, count=131)
    assert gf.score(many) > gf.score(few)


# ---------------------------------------------------------------- open now (code, not the LLM)

NOW = datetime.datetime(2026, 10, 22, 17, 20, tzinfo=BANGKOK_TZ)


def test_open_now_with_closing_time():
    place = g(currentOpeningHours={"openNow": True, "nextCloseTime": "2026-10-22T11:00:00Z"})
    assert gf.open_note(place, NOW) == "ตอนนี้เปิดอยู่ (ตาม Google) ปิด 18:00 น."


def test_closed_opens_tomorrow():
    place = g(currentOpeningHours={"openNow": False, "nextOpenTime": "2026-10-23T01:00:00Z"})
    assert gf.open_note(place, NOW) == "ตอนนี้ปิดอยู่ (ตาม Google) เปิดอีกครั้งพรุ่งนี้ 8:00 น."


def test_no_hours_no_note():
    assert gf.open_note(g(), NOW) is None


def test_row_is_marked_unverified_and_links_out():
    row = gf.to_row(g(googleMapsUri="https://maps.google.com/?cid=1", nationalPhoneNumber="094 470 9495",
                      primaryTypeDisplayName={"text": "ร้านกาแฟ"}, reviews=[{"text": {"text": "กาแฟ\nอร่อย"}}],
                      priceRange={"startPrice": {"units": "100"}, "endPrice": {"units": "200"}}), "พระยืน", NOW)
    assert row["id"] == "google:a" and row["live_google"] is True
    assert gf.UNVERIFIED_TAG in row["tags"] and "ร้านกาแฟ" in row["tags"]
    assert gf.UNVERIFIED_TAG in row["description"] and "กาแฟ อร่อย" in row["description"]
    assert row["maps_url"] == "https://maps.google.com/?cid=1" and row["phone"] == "094 470 9495"
    assert row["price"] == "฿100-200 ต่อคน"


# ---------------------------------------------------------------- cost guards


def test_off_without_a_key(monkeypatch):
    monkeypatch.setattr(gf, "GOOGLE_PLACES_API_KEY", None)
    monkeypatch.setattr(gf, "_search", lambda text: pytest.fail("must not call Google"))
    assert gf.search("คาเฟ่", "พระยืน") == []


def test_daily_cap_reached(on):
    on.setattr(gf, "_rpc", lambda name, params: False)
    on.setattr(gf, "_search", lambda text: pytest.fail("must not call Google over the cap"))
    assert gf.search("คาเฟ่", "พระยืน") == []


def test_cap_counts_in_memory_without_the_migration(on):
    def missing(name, params):
        raise Exception("Could not find the function public.claim_google_fallback_call")

    on.setattr(gf, "_rpc", missing)
    on.setattr(gf, "GOOGLE_FALLBACK_DAILY_CAP", 2)
    on.setattr(gf, "_mem_usage", {"day": None, "calls": 0})
    assert [gf._claim_call() for _ in range(3)] == [True, True, False]


def test_same_question_is_paid_for_once(on):
    calls = []
    on.setattr(gf, "_search", lambda text: calls.append(text) or [g()])
    gf.search("คาเฟ่", "พระยืน")
    gf.search("คาเฟ่", "พระยืน")
    assert calls == ["คาเฟ่ แถวพระยืน ขอนแก่น"]


def test_google_failure_returns_nothing(on):
    def boom(text):
        raise TimeoutError("slow")

    on.setattr(gf, "_search", boom)
    assert gf.search("คาเฟ่", "พระยืน") == []


def test_top_up_best_first_and_recorded(on):
    recorded = []
    on.setattr(gf, "record_candidates", lambda rows, where: recorded.append((rows, where)))
    on.setattr(gf, "_search", lambda text: [g("low", "ร้านเล็ก", rating=5.0, count=12), g("top", "ร้านดัง", rating=4.6, count=400),
                                            g("far", "ร้านในเมือง", address="อำเภอเมืองขอนแก่น ขอนแก่น")])
    rows = gf.top_up("คาเฟ่", "พระยืน", 2, set())
    assert [r["name"] for r in rows] == ["ร้านดัง", "ร้านเล็ก"]
    assert recorded and recorded[0][1] == "พระยืน"


# ---------------------------------------------------------------- which area to look up


@pytest.mark.parametrize("where, expected", [
    ("ท่าพระ", "ท่าพระ"),
    ("อำเภอมัญจาคีรี", "มัญจาคีรี"),
    ("บ้านไผ่", "บ้านไผ่"),
    ("ขอนแก่น", None),
    ("เคียง", None),
    ("นี้", None),
    ("บ้าน", None),
    ("บ้านฉัน", None),
])
def test_google_area_name(where, expected):
    assert area.google_area_name(where) == expected


# ---------------------------------------------------------------- merging into the chat search


def _db(name, tier=0):
    return {"id": name, "name": name, "area_tier": tier}


def test_full_area_never_calls_google(on):
    on.setattr(gf, "top_up", lambda *a: pytest.fail("area already has enough"))
    found = [_db("a"), _db("b"), _db("c")]
    assert retriever._top_up_from_google(found, "คาเฟ่", {"kind": "district", "name": "บ้านไผ่"}, "บ้านไผ่", 3, []) == found


def test_thin_area_ours_first_then_google_then_the_wider_ring(on):
    asked = []
    on.setattr(gf, "top_up", lambda what, where, need, known: asked.append((where, need)) or [{"id": "google:x", "name": "G"}])
    found = [_db("inside"), _db("ring", tier=1)]
    out = retriever._top_up_from_google(found, "คาเฟ่", {"kind": "district", "name": "พระยืน"}, "พระยืน", 3, [])
    assert [p["name"] for p in out] == ["inside", "G", "ring"]
    assert asked == [("พระยืน", 2)]


def test_landmark_areas_are_left_alone(on):
    on.setattr(gf, "top_up", lambda *a: pytest.fail("can't tell if a Google place is near a landmark"))
    landmark = {"kind": "landmark", "place": {"name": "บึงแก่นนคร"}}
    assert retriever._top_up_from_google([], "คาเฟ่", landmark, "บึงแก่นนคร", 3, []) == []


def test_off_means_unchanged(monkeypatch):
    monkeypatch.setattr(gf, "GOOGLE_PLACES_API_KEY", None)
    found = [_db("a")]
    assert retriever._top_up_from_google(found, "คาเฟ่", None, "พระยืน", 3, []) == found
