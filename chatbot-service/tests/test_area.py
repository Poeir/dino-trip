""""แถว X" place search: parsing the question, resolving X, picking the places
around it (src/services/rag/area.py), and how PlaceRetriever.search_chat_places
wires it together with the intent categories. The database reads are faked."""
import pytest

from src.services.rag import area
from src.services.rag.area import (
    area_candidates,
    is_specific,
    rank_in_area,
    resolve_area,
    split_area_query,
    wanted_categories,
)
from src.services.rag.retriever import PlaceRetriever

# Real coordinates: บึงแก่นนคร and its neighbours in the city, ท่าพระ ~12 km south.
LAKE = {"id": "lake", "name": "บึงแก่นนคร (เมืองขอนแก่น)", "category": "สวนสาธารณะ",
        "subdistrict": "ในเมือง", "district": "เมืองขอนแก่น", "lat": 16.4146, "lng": 102.8388, "review_count": 302}


def place(pid, name, category, lat, lng, subdistrict="ในเมือง", district="เมืองขอนแก่น", reviews=10):
    return {"id": pid, "name": name, "category": category, "subdistrict": subdistrict, "district": district,
            "lat": lat, "lng": lng, "review_count": reviews, "rating": 4.5}


TEMPLE = place("temple", "พระมหาธาตุแก่นนคร", "วัด", 16.4210, 102.8360, reviews=5000)
NOODLE_NEAR_LAKE = place("noodle", "ก๋วยเตี๋ยวริมบึง", "ร้านอาหาร", 16.4180, 102.8400, reviews=50)
RESTAURANT_NEAR_LAKE = place("rest", "ร้านข้าวหน้าบึง", "ร้านอาหาร", 16.4100, 102.8350, reviews=900)
FAR_CAFE = place("far", "คาเฟ่ไกล", "คาเฟ่", 16.4700, 102.8200, reviews=4000)  # ~6 km north
MALL = place("mall", "เซ็นทรัล ขอนแก่น", "ห้างสรรพสินค้า", 16.4330, 102.8250, reviews=9801)
MALL_CAMPUS = place("mall2", "เซ็นทรัล ขอนแก่น แคมปัส", "ห้างสรรพสินค้า", 16.4600, 102.8200, reviews=585)
THA_PHRA_NOODLE = place("timo", "ก๋วยเตี๋ยวตี๋ม่อ", "ร้านอาหาร", 16.3290, 102.8170, subdistrict="ท่าพระ", reviews=120)
THA_PHRA_GOLF = place("golf", "Singha Park Golf", "สถานที่ท่องเที่ยว", 16.3340, 102.8000, subdistrict="ท่าพระ", reviews=300)
NEAR_THA_PHRA = place("sanan", "ครัวสนั่นลั่น", "ร้านอาหาร", 16.3600, 102.8300, subdistrict="บ้านเป็ด", reviews=80)
CHUMPHAE = place("cp", "ถนนคนเดินชุมแพ", "ตลาด", 16.5400, 102.1000, subdistrict="ชุมแพ", district="ชุมแพ", reviews=206)

PLACES = [LAKE, TEMPLE, NOODLE_NEAR_LAKE, RESTAURANT_NEAR_LAKE, FAR_CAFE, MALL, MALL_CAMPUS,
          THA_PHRA_NOODLE, THA_PHRA_GOLF, NEAR_THA_PHRA, CHUMPHAE]


class TestSplitAreaQuery:
    def test_splits_what_from_where(self):
        assert split_area_query("ร้านอาหารแถวบึงแก่นนคร") == ("ร้านอาหาร", "บึงแก่นนคร")

    def test_the_place_name_stops_where_the_rest_of_the_question_starts(self):
        # No spaces in Thai: the name runs straight into "มีอะไรบ้าง".
        assert split_area_query("แถวเซ็นทรัลขอนแก่นมีอะไรบ้าง") == ("มีอะไรบ้าง", "เซ็นทรัลขอนแก่น")

    def test_what_keeps_the_part_after_the_place(self):
        what, where = split_area_query("แถวเซ็นทรัลมีร้านอาหารอร่อยๆไหม")
        assert where == "เซ็นทรัล"
        assert "ร้านอาหาร" in what

    def test_a_space_after_the_marker_is_fine(self):
        assert split_area_query("คาเฟ่ใกล้ บึงแก่นนคร")[1] == "บึงแก่นนคร"

    def test_repeated_marker_is_one_marker(self):
        assert split_area_query("ร้านอาหารแถวๆ ท่าพระ")[1] == "ท่าพระ"

    def test_no_marker_means_no_area(self):
        assert split_area_query("ร้านอาหารอีสานอร่อยๆ") is None


class TestSplitBareAreaQuery:
    """An area named without "แถว" -- the live "อยากไปเที่ยวท่าพระ" that came back
    as three temples elsewhere."""

    @pytest.mark.parametrize(
        "query, what",
        [
            ("อยากไปเที่ยวท่าพระ", "อยากไปเที่ยว"),
            ("ที่เที่ยวท่าพระ", "ที่เที่ยว"),
            ("ไปท่าพระ", "ไป"),
            ("ร้านอาหารที่ท่าพระ", "ร้านอาหารที่"),
            ("ร้านอาหารในตำบลท่าพระ", "ร้านอาหารในตำบล"),
            ("เที่ยวท่าพระมีอะไรบ้าง", "เที่ยว มีอะไรบ้าง"),
            ("อยากไปเที่ยวท่าพระ ช่วยแนะนำหน่อย", "อยากไปเที่ยว ช่วยแนะนำหน่อย"),
        ],
    )
    def test_names_an_area_after_a_going_out_word(self, query, what):
        assert area.split_bare_area_query(query, PLACES) == (what, "ท่าพระ")

    @pytest.mark.parametrize(
        "query",
        [
            "ร้านอาหารอีสานอร่อยๆ",             # no area in it
            "สถานีท่าพระอยู่ไหน",               # the name inside another name, no prefix word
            "เที่ยวท่าพระเก่า",                # the name continues into another word
            "อยากไปเที่ยวบึงแก่นนคร",           # a landmark: asks about that place itself
            "อยากไปเที่ยวขอนแก่น",              # province-wide, not a neighbourhood
        ],
    )
    def test_anything_else_is_left_to_the_normal_search(self, query):
        assert area.split_bare_area_query(query, PLACES) is None

    def test_an_area_the_table_does_not_have_is_ignored(self):
        assert area.split_bare_area_query("อยากไปเที่ยวหนองเรือ", PLACES) is None


class TestResolveArea:
    def test_a_subdistrict_name(self):
        assert resolve_area("ท่าพระ", PLACES) == {"kind": "subdistrict", "name": "ท่าพระ"}

    def test_admin_prefix_is_ignored(self):
        assert resolve_area("ตำบลท่าพระ", PLACES) == {"kind": "subdistrict", "name": "ท่าพระ"}

    def test_a_name_that_is_both_prefers_the_district(self):
        assert resolve_area("ชุมแพ", PLACES) == {"kind": "district", "name": "ชุมแพ"}

    def test_a_landmark_by_its_name_without_the_parenthetical(self):
        assert resolve_area("บึงแก่นนคร", PLACES)["place"]["id"] == "lake"

    def test_spacing_does_not_matter(self):
        assert resolve_area("เซ็นทรัลขอนแก่น", PLACES)["place"]["id"] == "mall"

    def test_a_shortened_name_picks_the_most_reviewed_place_starting_with_it(self):
        assert resolve_area("เซ็นทรัล", PLACES)["place"]["id"] == "mall"

    def test_a_subdistrict_followed_by_stray_words(self):
        # "แถวในเมืองอะมีมั้ย": the question's tail runs into the name.
        assert resolve_area("ในเมืองอะมี", PLACES) == {"kind": "subdistrict", "name": "ในเมือง"}

    @pytest.mark.parametrize("where", ["ขอนแก่น", "เมืองขอนแก่น", "ฉัน", "นี้", "มข."])
    def test_too_broad_or_unknown_resolves_to_nothing(self, where):
        assert resolve_area(where, PLACES) is None


class TestAreaCandidates:
    def test_landmark_keeps_close_places_and_leaves_itself_out(self):
        ids = [p["id"] for p in area_candidates({"kind": "landmark", "place": LAKE}, PLACES, limit=3)]
        assert "lake" not in ids
        assert {"temple", "noodle", "rest"} <= set(ids)
        assert "far" not in ids  # ~6 km: outside even the wider radius

    def test_landmark_note_gives_the_distance(self):
        rows = area_candidates({"kind": "landmark", "place": LAKE}, PLACES, limit=3)
        note = next(p["area_note"] for p in rows if p["id"] == "temple")
        assert "บึงแก่นนคร" in note and "กม." in note

    def test_thin_subdistrict_adds_its_neighbours_after_its_own_places(self):
        rows = area_candidates({"kind": "subdistrict", "name": "ท่าพระ"}, PLACES, limit=3)
        tiers = {p["id"]: p["area_tier"] for p in rows}
        assert tiers["timo"] == tiers["golf"] == 0
        assert tiers["sanan"] == 1
        assert "lake" not in tiers  # ~10 km away


class TestRankInArea:
    def candidates(self):
        return area_candidates({"kind": "landmark", "place": LAKE}, PLACES, limit=3)

    def test_generic_ask_filters_by_kind_and_ranks_by_reviews(self):
        top = rank_in_area(self.candidates(), "ร้านอาหาร", None, limit=3)
        assert [p["id"] for p in top] == ["rest", "noodle"]

    def test_specific_ask_keeps_only_what_the_search_found(self):
        top = rank_in_area(self.candidates(), "ร้านก๋วยเตี๋ยว", ["far", "noodle"], limit=3)
        assert [p["id"] for p in top] == ["noodle"]

    def test_specific_ask_the_area_does_not_have_returns_nothing(self):
        assert rank_in_area(self.candidates(), "ร้านซูชิ", ["far"], limit=3) == []

    def test_own_places_come_before_the_outer_ring(self):
        rows = area_candidates({"kind": "subdistrict", "name": "ท่าพระ"}, PLACES, limit=3)
        top = rank_in_area(rows, "ร้านอาหาร", None, limit=3)
        assert [p["id"] for p in top] == ["timo", "sanan"]


class TestWhatIsAsked:
    @pytest.mark.parametrize("what", ["ร้านอาหาร", "มีอะไรบ้าง", "อยากเที่ยว ช่วยแนะนำหน่อย", "ที่เที่ยว", "ฝนตกไปไหนดี", "อยากได้ที่เที่ยว", "อยากได้คาเฟ่"])
    def test_generic(self, what):
        assert not is_specific(what)

    @pytest.mark.parametrize("what", ["ร้านก๋วยเตี๋ยว", "คาเฟ่บรรยากาศดี", "ร้านอาหารอีสาน"])
    def test_specific(self, what):
        assert is_specific(what)

    def test_going_out_is_not_limited_to_attractions(self):
        assert wanted_categories("อยากเที่ยว") == []
        assert "วัด" in wanted_categories("ที่เที่ยว")

    def test_situation_words_name_categories(self):
        assert wanted_categories("ฝนตก") == ["พิพิธภัณฑ์", "ห้างสรรพสินค้า"]


class FakeRetriever(PlaceRetriever):
    """search_chat_places with its three database reads replaced."""

    def __init__(self, search=(), by_category=(), fail=False):
        self.search_calls = []
        self._search, self._by_category, self._fail = list(search), list(by_category), fail

    def _directory(self):
        if self._fail:
            raise RuntimeError("db down")
        return PLACES

    def search_and_expand(self, query, limit=5):
        self.search_calls.append((query, limit))
        return self._search[:limit]

    def list_by_categories(self, categories):
        return [p for p in self._by_category if p["category"] in categories]


class TestSearchChatPlaces:
    def test_area_question_returns_places_around_it(self):
        r = FakeRetriever()
        out = r.search_chat_places("ร้านอาหารแถวบึงแก่นนคร", limit=3)
        assert [p["id"] for p in out] == ["rest", "noodle"]
        assert all(p["area_note"] for p in out)
        assert r.search_calls == []  # a generic ask needs no ranking search

    def test_area_named_without_a_marker_is_still_searched_as_an_area(self):
        # "อยากไปเที่ยวท่าพระ" used to skip the area logic and return temples elsewhere.
        r = FakeRetriever(search=[FAR_CAFE])
        out = r.search_chat_places("อยากไปเที่ยวท่าพระ", limit=3)
        assert [p["id"] for p in out][:2] == ["golf", "timo"]  # ท่าพระ's own places, most-reviewed first
        assert out[0]["area_note"] == "อยู่ในตำบลท่าพระ"
        assert r.search_calls == []

    def test_specific_area_question_ranks_with_the_plain_search(self):
        r = FakeRetriever(search=[FAR_CAFE, NOODLE_NEAR_LAKE])
        out = r.search_chat_places("ร้านก๋วยเตี๋ยวแถวบึงแก่นนคร", limit=3)
        assert [p["id"] for p in out] == ["noodle"]

    def test_unresolved_area_falls_back_to_the_plain_search(self):
        r = FakeRetriever(search=[FAR_CAFE])
        assert r.search_chat_places("ร้านอาหารใกล้ฉัน", limit=3) == [FAR_CAFE]
        assert r.search_calls == [("ร้านอาหารใกล้ฉัน", 3)]

    def test_intent_keeps_matching_categories_and_tops_up_by_reviews(self):
        museum = place("museum", "พิพิธภัณฑ์", "พิพิธภัณฑ์", 16.4, 102.8, reviews=700)
        park = place("park", "สวน", "สวนสาธารณะ", 16.4, 102.8)
        r = FakeRetriever(search=[park, museum], by_category=[MALL_CAMPUS, MALL, museum])
        out = r.search_chat_places("ฝนตกควรไปเที่ยวไหนดี", limit=3)
        assert [p["id"] for p in out] == ["museum", "mall", "mall2"]

    def test_a_database_failure_falls_back_to_the_plain_search(self):
        r = FakeRetriever(search=[FAR_CAFE], fail=True)
        assert r.search_chat_places("ร้านอาหารแถวบึงแก่นนคร", limit=3) == [FAR_CAFE]


def test_landmark_radius_constants_are_ordered():
    assert area.LANDMARK_RADIUS_KM < area.WIDER_RADIUS_KM
