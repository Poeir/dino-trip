"""Unit tests for TripBuilderService.build_candidate_list's area_scope filter
-- the retriever's DB call is faked out (same FakeRetriever pattern as
test_agent.py) and find_place_by_name is monkeypatched, so these don't hit
Supabase or load the embedding model's actual search path."""
import pytest

from src.services.trip_planner import orchestrator as orchestrator_module
from src.services.trip_planner.orchestrator import TripBuilderService
from src.services.trip_planner.models import TripInput


class FakeRetriever:
    def __init__(self, places, restaurants=()):
        self._places = places
        self._restaurants = list(restaurants)

    def search_and_expand(self, query, limit=5):
        return self._places

    def list_restaurants(self):
        return self._restaurants


class FakeRetrieverByQuery:
    """Routes each call to a per-query canned result list, so tests can
    simulate one interest having far more real matches than another --
    the exact shape of the bug that motivated round-robin merging."""

    def __init__(self, results_by_query, restaurants=()):
        self._results_by_query = results_by_query
        self._restaurants = list(restaurants)
        self.queries_seen = []

    def search_and_expand(self, query, limit=5):
        self.queries_seen.append(query)
        return self._results_by_query.get(query, [])

    def list_restaurants(self):
        return self._restaurants


def make_place_row(place_id, name, district, category="คาเฟ่", price_level=None, **extra):
    row = {
        "id": place_id, "name": name, "category": category, "rating": 4.5,
        "lat": 16.44, "lng": 102.84, "price_level": price_level, "district": district,
    }
    row.update(extra)
    return row


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
        _, candidates, _, _ = service.build_candidate_list(user_input)
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
        _, candidates, _, _ = service.build_candidate_list(user_input)
        names = [p.name for p in candidates]
        assert {"InCity", "Outlying", "Unclassified"} <= set(names)

    def test_must_go_place_is_not_filtered_by_area_scope(self, service, monkeypatch):
        outlying_place_row = make_place_row("m1", "MustGoOutlying", district="ภูเวียง")
        monkeypatch.setattr(orchestrator_module, "find_place_by_name", lambda name_query: outlying_place_row)
        service.retriever = FakeRetriever([])

        user_input = make_user_input(area_scope="เมือง", must_go=["MustGoOutlying"])
        _, candidates, missing, must_go_ids = service.build_candidate_list(user_input)
        names = [p.name for p in candidates]
        assert "MustGoOutlying" in names
        assert missing == []
        assert must_go_ids == {"m1"}

    def test_must_go_ids_excludes_interest_candidates(self, service, monkeypatch):
        # must_go_ids identifies only the places the user explicitly asked
        # for -- route_scheduler/llm_extractor use it to give those
        # priority over everything else, so an interest-sourced candidate
        # (found via RAG, not requested by name) must never end up in it.
        must_go_row = make_place_row("m1", "MustGoPlace", district="เมืองขอนแก่น")
        monkeypatch.setattr(orchestrator_module, "find_place_by_name", lambda name_query: must_go_row)
        service.retriever = FakeRetriever([make_place_row("p1", "InterestPlace", district="เมืองขอนแก่น")])

        user_input = make_user_input(must_go=["MustGoPlace"])
        _, candidates, _, must_go_ids = service.build_candidate_list(user_input)
        assert must_go_ids == {"m1"}
        assert "p1" not in must_go_ids

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
        _, candidates, _, _ = service.build_candidate_list(user_input)
        assert "InCity" in [p.name for p in candidates]

    @pytest.mark.parametrize("district_value", [
        "อำเภอ ภูเวียง", "อำเภอ อุบลรัตน์", "อำเภอชุมแพ", "อำเภอหนองเรือ", "อำเภอน้ำพอง", "อำเภอ เวียงเก่า",
    ])
    def test_real_world_outlying_district_variants_are_all_excluded(self, service, district_value):
        service.retriever = FakeRetriever([make_place_row("p1", "Outlying", district=district_value)])
        user_input = make_user_input(area_scope="เมือง")
        _, candidates, _, _ = service.build_candidate_list(user_input)
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
        _, candidates, _, _ = service.build_candidate_list(user_input)
        names = [p.name for p in candidates]
        assert "Dino1" in names

    def test_calls_retriever_once_per_interest_not_once_for_joined_string(self, service):
        service.retriever = FakeRetrieverByQuery({
            "วัฒนธรรม/ศาสนา": [make_place_row("c1", "Culture1", district="เมืองขอนแก่น")],
            "ไดโนเสาร์": [make_place_row("d1", "Dino1", district="เมืองขอนแก่น")],
        })
        user_input = make_user_input(interests=["วัฒนธรรม/ศาสนา", "ไดโนเสาร์"])
        service.build_candidate_list(user_input)
        # Trailing call is the unconditional meal reserve (see
        # build_candidate_list) -- fires regardless of interests since
        # neither fixture place above is category "ร้านอาหาร".
        assert service.retriever.queries_seen == ["วัฒนธรรม/ศาสนา", "ไดโนเสาร์", "ร้านอาหารแนะนำ ขอนแก่น"]

    def test_no_interests_falls_back_to_generic_single_query(self, service):
        service.retriever = FakeRetrieverByQuery({
            "สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น": [make_place_row("g1", "Generic1", district="เมืองขอนแก่น")],
        })
        user_input = make_user_input(interests=[])
        _, candidates, _, _ = service.build_candidate_list(user_input)
        assert "Generic1" in [p.name for p in candidates]
        # Trailing call is the unconditional meal reserve (see
        # build_candidate_list) -- fires regardless of interests since
        # "Generic1" above is category "คาเฟ่", not "ร้านอาหาร".
        assert service.retriever.queries_seen == ["สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น", "ร้านอาหารแนะนำ ขอนแก่น"]


class TestAccommodationLocation:
    """build_candidate_list's first return value (`_` in every test above) --
    verifies real coordinates from the frontend's map picker/geolocation are
    used directly instead of find_place_by_name()'s name-matching against
    the curated `places` table (which a real accommodation's name almost
    never matches), and that omitting them preserves the old
    find_place_by_name -> DEFAULT_HOTEL_LOCATION fallback chain untouched."""

    def test_supplied_coordinates_are_used_directly(self, service, monkeypatch):
        # find_place_by_name should never even be consulted when coordinates
        # are supplied -- assert that by making it explode if called.
        def _boom(name_query):
            raise AssertionError("find_place_by_name should not be called when coordinates are supplied")
        monkeypatch.setattr(orchestrator_module, "find_place_by_name", _boom)
        service.retriever = FakeRetriever([])

        user_input = make_user_input(accommodation_name="My Hotel", accommodation_lat=16.5, accommodation_lng=102.9)
        accommodation, _, _, _ = service.build_candidate_list(user_input)
        assert accommodation.lat == 16.5
        assert accommodation.lng == 102.9
        assert accommodation.name == "My Hotel"

    def test_missing_coordinates_falls_back_to_default_hotel_location(self, service):
        # `service` fixture already monkeypatches find_place_by_name to
        # return None -- this is the "old client / nothing picked" path.
        service.retriever = FakeRetriever([])
        user_input = make_user_input()  # no accommodation_lat/lng override
        accommodation, _, _, _ = service.build_candidate_list(user_input)
        assert accommodation.lat == orchestrator_module.DEFAULT_HOTEL_LOCATION["lat"]
        assert accommodation.lng == orchestrator_module.DEFAULT_HOTEL_LOCATION["lng"]


def daily_hours(open_h, close_h=23):
    """hours_periods for a place open every day from open_h to close_h:59."""
    return [
        {"open": {"day": d, "hour": open_h, "minute": 0}, "close": {"day": d, "hour": close_h, "minute": 59}}
        for d in range(7)
    ]


def restaurant_row(place_id, name, open_h, **extra):
    return make_place_row(place_id, name, "เมืองขอนแก่น", category="ร้านอาหาร", hours_periods=daily_hours(open_h), **extra)


class RaisesOnListRestaurants(FakeRetriever):
    def list_restaurants(self):
        raise AssertionError("the full restaurant list should not have been needed")


def names(candidates):
    return {p.name for p in candidates}


class TestMealReserveUsability:
    """The meal reserve only holds restaurants that can be visited within the
    trip's daily window (default 09:00-18:00), and enough lunch-capable ones
    when that window covers lunch."""

    def test_evening_only_restaurant_from_retrieval_is_excluded_and_a_lunch_one_kept(self, service):
        service.retriever = FakeRetriever([
            restaurant_row("late", "LateRestaurant", 18),
            restaurant_row("noon1", "NoonRestaurant1", 10),
            restaurant_row("noon2", "NoonRestaurant2", 10),
        ])
        _, candidates, _, _ = service.build_candidate_list(make_user_input())
        assert "LateRestaurant" not in names(candidates)
        assert {"NoonRestaurant1", "NoonRestaurant2"} <= names(candidates)

    def test_must_go_restaurant_is_kept_even_if_it_cannot_be_visited_in_the_window(self, service, monkeypatch):
        late = restaurant_row("late", "LateRestaurant", 18)
        monkeypatch.setattr(orchestrator_module, "find_place_by_name", lambda name_query: late)
        service.retriever = FakeRetriever([], restaurants=[restaurant_row("noon", "Noon", 10)])
        _, candidates, _, must_go_ids = service.build_candidate_list(make_user_input(must_go=["LateRestaurant"]))
        assert "LateRestaurant" in names(candidates)
        assert "late" in must_go_ids

    def test_lunch_capable_restaurants_are_added_from_the_full_list_when_retrieval_has_none(self, service):
        # retrieval only surfaces a restaurant that opens after the day ends
        service.retriever = FakeRetriever(
            [restaurant_row("late", "LateRestaurant", 18)],
            restaurants=[restaurant_row("noon1", "NoonA", 10, rating=4.8), restaurant_row("noon2", "NoonB", 10, rating=4.1)],
        )
        _, candidates, _, _ = service.build_candidate_list(make_user_input())
        assert {"NoonA", "NoonB"} <= names(candidates)
        assert "LateRestaurant" not in names(candidates)

    def test_full_list_is_best_rated_first(self, service):
        service.retriever = FakeRetriever(
            [],
            restaurants=[
                restaurant_row("low", "Low", 10, rating=3.0), restaurant_row("high", "High", 10, rating=4.9),
                restaurant_row("mid", "Mid", 10, rating=4.2),
            ],
        )
        _, candidates, _, _ = service.build_candidate_list(make_user_input())
        # a 1-day trip reserves 2: the two best-rated, not the first two in table order
        assert {"High", "Mid"} <= names(candidates)
        assert "Low" not in names(candidates)

    def test_full_list_is_not_read_when_retrieval_already_covers_the_reserve(self, service):
        service.retriever = RaisesOnListRestaurants([
            restaurant_row("noon1", "Noon1", 10), restaurant_row("noon2", "Noon2", 10),
        ])
        _, candidates, _, _ = service.build_candidate_list(make_user_input())
        assert {"Noon1", "Noon2"} <= names(candidates)

    def test_lunch_is_not_required_when_the_trip_window_misses_lunch(self, service):
        # 15:00-20:00 never reaches the lunch window, so evening restaurants are enough
        service.retriever = RaisesOnListRestaurants([
            restaurant_row("e1", "Evening1", 16), restaurant_row("e2", "Evening2", 16),
        ])
        _, candidates, _, _ = service.build_candidate_list(make_user_input(start_time="15:00", end_time="20:00"))
        assert {"Evening1", "Evening2"} <= names(candidates)

    def test_budget_filter_still_applies_to_full_list_restaurants(self, service):
        service.retriever = FakeRetriever(
            [], restaurants=[restaurant_row("pricey", "Pricey", 10, price_level=4), restaurant_row("ok", "Ok", 10, price_level=1)],
        )
        _, candidates, _, _ = service.build_candidate_list(make_user_input(budget_level="ประหยัด"))
        assert "Pricey" not in names(candidates)
        assert "Ok" in names(candidates)

    def test_area_scope_filter_still_applies_to_full_list_restaurants(self, service):
        service.retriever = FakeRetriever(
            [],
            restaurants=[
                make_place_row("far", "Far", "อำเภอชุมแพ", category="ร้านอาหาร", hours_periods=daily_hours(10)),
                restaurant_row("city", "City", 10),
            ],
        )
        _, candidates, _, _ = service.build_candidate_list(make_user_input(area_scope="เมือง"))
        assert "Far" not in names(candidates)
        assert "City" in names(candidates)
