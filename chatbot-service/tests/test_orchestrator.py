"""Unit tests for TripBuilderService.build_candidate_list's area_scope filter
-- the retriever's DB call is faked out (same FakeRetriever pattern as
test_agent.py) and find_place_by_name is monkeypatched, so these don't hit
Supabase or load the embedding model's actual search path."""
import pytest

from src.services.trip_planner import orchestrator as orchestrator_module
from src.services.trip_planner.orchestrator import TripBuilderService
from src.services.trip_planner.models import TripInput


class FakeRetriever:
    def __init__(self, places):
        self._places = places

    def search_and_expand(self, query, limit=5):
        return self._places


class FakeRetrieverByQuery:
    """Routes each call to a per-query canned result list, so tests can
    simulate one interest having far more real matches than another --
    the exact shape of the bug that motivated round-robin merging."""

    def __init__(self, results_by_query):
        self._results_by_query = results_by_query
        self.queries_seen = []

    def search_and_expand(self, query, limit=5):
        self.queries_seen.append(query)
        return self._results_by_query.get(query, [])


def make_place_row(place_id, name, district, category="คาเฟ่", price_level=None):
    return {
        "id": place_id, "name": name, "category": category, "rating": 4.5,
        "lat": 16.44, "lng": 102.84, "price_level": price_level, "district": district,
    }


def make_user_input(**overrides):
    defaults = dict(
        trip_duration_days=1, start_date="2026-08-10", accommodation_name="Hotel",
        interests=["คาเฟ่"], must_go=[],
    )
    defaults.update(overrides)
    return TripInput(**defaults)


@pytest.fixture
def service(monkeypatch):
    svc = TripBuilderService()
    # No accommodation/must_go rows in the DB for these tests -- falls back
    # to the dummy hotel Place, which is fine since these tests only assert
    # on the interest_list side of build_candidate_list.
    monkeypatch.setattr(orchestrator_module, "find_place_by_name", lambda name_query: None)
    return svc


class TestAreaScopeFilter:
    def test_mueang_scope_excludes_outlying_and_unclassified_places(self, service):
        service.retriever = FakeRetriever([
            make_place_row("p1", "InCity", district="เมืองขอนแก่น"),
            make_place_row("p2", "Outlying", district="ภูเวียง"),
            make_place_row("p3", "Unclassified", district=None),
        ])
        user_input = make_user_input(area_scope="เมือง")
        _, candidates, _ = service.build_candidate_list(user_input)
        names = [p.name for p in candidates]
        assert "InCity" in names
        assert "Outlying" not in names
        assert "Unclassified" not in names

    def test_default_scope_includes_everything(self, service):
        service.retriever = FakeRetriever([
            make_place_row("p1", "InCity", district="เมืองขอนแก่น"),
            make_place_row("p2", "Outlying", district="ภูเวียง"),
            make_place_row("p3", "Unclassified", district=None),
        ])
        user_input = make_user_input(area_scope="ทั่วขอนแก่น")
        _, candidates, _ = service.build_candidate_list(user_input)
        names = [p.name for p in candidates]
        assert {"InCity", "Outlying", "Unclassified"} <= set(names)

    def test_must_go_place_is_not_filtered_by_area_scope(self, service, monkeypatch):
        outlying_place_row = make_place_row("m1", "MustGoOutlying", district="ภูเวียง")
        monkeypatch.setattr(orchestrator_module, "find_place_by_name", lambda name_query: outlying_place_row)
        service.retriever = FakeRetriever([])

        user_input = make_user_input(area_scope="เมือง", must_go=["MustGoOutlying"])
        _, candidates, missing = service.build_candidate_list(user_input)
        names = [p.name for p in candidates]
        assert "MustGoOutlying" in names
        assert missing == []

    @pytest.mark.parametrize("district_value", [
        "อำเภอเมืองขอนแก่น", "เมือง", "อ.เมือง", "อ.เมืองขอนแก่น", "อำเภอเมือง", "Muang",
    ])
    def test_real_world_mueang_prefix_variants_are_all_recognized(self, service, district_value):
        # Regression: the live `places` table stores this district under at
        # least 6 different prefix/casing variants (confirmed by querying it
        # directly), not the single bare "เมืองขอนแก่น" string an exact-match
        # filter would have assumed -- an exact match against that string
        # matched zero of the 500 real rows tagged "อำเภอเมืองขอนแก่น".
        service.retriever = FakeRetriever([make_place_row("p1", "InCity", district=district_value)])
        user_input = make_user_input(area_scope="เมือง")
        _, candidates, _ = service.build_candidate_list(user_input)
        assert "InCity" in [p.name for p in candidates]

    @pytest.mark.parametrize("district_value", [
        "อำเภอ ภูเวียง", "อำเภอ อุบลรัตน์", "อำเภอชุมแพ", "อำเภอหนองเรือ", "อำเภอน้ำพอง", "อำเภอ เวียงเก่า",
    ])
    def test_real_world_outlying_district_variants_are_all_excluded(self, service, district_value):
        service.retriever = FakeRetriever([make_place_row("p1", "Outlying", district=district_value)])
        user_input = make_user_input(area_scope="เมือง")
        _, candidates, _ = service.build_candidate_list(user_input)
        assert "Outlying" not in [p.name for p in candidates]


class TestMultiInterestRoundRobin:
    """Regression: combining multiple interests into one query string let an
    interest with many real matches drown out one with few in the top-N
    ranking (confirmed live: 3 real "ไดโนเสาร์" places never appeared in a
    combined query, but all 3 appeared when queried alone). build_candidate_list
    now issues one retrieval call per interest and round-robin merges them."""

    def test_minority_interest_still_gets_a_slot(self, service):
        # "culture" has far more matches than "dino" -- a single combined
        # top-N query would have let culture crowd dino out entirely.
        culture_places = [make_place_row(f"c{i}", f"Culture{i}", district="เมืองขอนแก่น") for i in range(10)]
        dino_places = [make_place_row("d1", "Dino1", district="เมืองขอนแก่น")]
        service.retriever = FakeRetrieverByQuery({
            "วัฒนธรรม/ศาสนา": culture_places,
            "ไดโนเสาร์": dino_places,
        })
        user_input = make_user_input(interests=["วัฒนธรรม/ศาสนา", "ไดโนเสาร์"])
        _, candidates, _ = service.build_candidate_list(user_input)
        names = [p.name for p in candidates]
        assert "Dino1" in names

    def test_calls_retriever_once_per_interest_not_once_for_joined_string(self, service):
        service.retriever = FakeRetrieverByQuery({
            "วัฒนธรรม/ศาสนา": [make_place_row("c1", "Culture1", district="เมืองขอนแก่น")],
            "ไดโนเสาร์": [make_place_row("d1", "Dino1", district="เมืองขอนแก่น")],
        })
        user_input = make_user_input(interests=["วัฒนธรรม/ศาสนา", "ไดโนเสาร์"])
        service.build_candidate_list(user_input)
        assert service.retriever.queries_seen == ["วัฒนธรรม/ศาสนา", "ไดโนเสาร์"]

    def test_no_interests_falls_back_to_generic_single_query(self, service):
        service.retriever = FakeRetrieverByQuery({
            "สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น": [make_place_row("g1", "Generic1", district="เมืองขอนแก่น")],
        })
        user_input = make_user_input(interests=[])
        _, candidates, _ = service.build_candidate_list(user_input)
        assert "Generic1" in [p.name for p in candidates]
        assert service.retriever.queries_seen == ["สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น"]
