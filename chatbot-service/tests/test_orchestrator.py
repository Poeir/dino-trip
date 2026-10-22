"""Unit tests for TripBuilderService.build_candidate_list's area_scope filter
-- the retriever's DB call is faked out (same FakeRetriever pattern as
test_agent.py) and find_place_by_name is monkeypatched, so these don't hit
Supabase or load the embedding model's actual search path."""
import pytest

from src.services.trip_planner import orchestrator as orchestrator_module
from src.services.trip_planner.orchestrator import TripBuilderService
from src.services.trip_planner.models import Place, TripInput


class FakeRetriever:
    def __init__(self, places, restaurants=()):
        self._places = places
        self._restaurants = list(restaurants)

    def search_and_expand(self, query, limit=5):
        return self._places

    def list_restaurants(self):
        return self._restaurants

    def list_by_categories(self, categories):
        return [r for r in self._places if r.get("category") in categories]


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


class TestBudgetCategoryFilter:
    """A หรูหรา trip drops "ตลาด" from the candidate pool by category: the
    price filter can't, since markets almost never carry a price_level."""

    def market_and_mall(self):
        return FakeRetriever([
            make_place_row("mk", "NightMarket", "เมืองขอนแก่น", category="ตลาด"),
            make_place_row("ml", "Mall", "เมืองขอนแก่น", category="ห้างสรรพสินค้า"),
        ])

    def test_luxury_budget_excludes_markets_but_keeps_malls(self, service):
        service.retriever = self.market_and_mall()
        _, candidates, _, _ = service.build_candidate_list(make_user_input(budget_level="หรูหรา"))
        assert "NightMarket" not in names(candidates)
        assert "Mall" in names(candidates)

    @pytest.mark.parametrize("budget_level", ["ประหยัด", "ปานกลาง"])
    def test_other_budgets_keep_markets(self, service, budget_level):
        service.retriever = self.market_and_mall()
        _, candidates, _, _ = service.build_candidate_list(make_user_input(budget_level=budget_level))
        assert {"NightMarket", "Mall"} <= names(candidates)

    def test_must_go_market_is_kept_on_a_luxury_budget(self, service, monkeypatch):
        market = make_place_row("mk", "NightMarket", "เมืองขอนแก่น", category="ตลาด")
        monkeypatch.setattr(orchestrator_module, "find_place_by_name", lambda name_query: market)
        service.retriever = FakeRetriever([])
        _, candidates, _, must_go_ids = service.build_candidate_list(
            make_user_input(budget_level="หรูหรา", must_go=["NightMarket"]),
        )
        assert "NightMarket" in names(candidates)
        assert must_go_ids == {"mk"}


class TestLuxuryBudget:
    """หรูหรา: restaurants and cafes by their price range (pricing.py), plus
    premium cafes and malls added on top of the interests."""

    def test_only_premium_cafes_and_restaurants_are_candidates(self, service):
        service.retriever = FakeRetriever([
            make_place_row("c1", "PremiumCafe", "เมืองขอนแก่น", price="฿400-600 ต่อคน", price_level=2),
            make_place_row("c2", "MidCafe", "เมืองขอนแก่น", price="฿200-400 ต่อคน", price_level=2),
            make_place_row("c3", "UnknownCafe", "เมืองขอนแก่น"),
            make_place_row("w1", "Temple", "เมืองขอนแก่น", category="วัด"),
        ])
        _, candidates, _, _ = service.build_candidate_list(make_user_input(budget_level="หรูหรา"))
        assert {"PremiumCafe", "Temple"} <= names(candidates)
        assert not {"MidCafe", "UnknownCafe"} & names(candidates)

    def test_malls_and_premium_cafes_join_without_a_matching_interest(self, service):
        temple = make_place_row("w1", "Temple", "เมืองขอนแก่น", category="วัด")
        extras = [
            make_place_row("ml", "Mall", "เมืองขอนแก่น", category="ห้างสรรพสินค้า"),
            make_place_row("c1", "PremiumCafe", "เมืองขอนแก่น", price="฿400-600 ต่อคน", price_level=2),
            make_place_row("c2", "CheapCafe", "เมืองขอนแก่น", price="฿1-200 ต่อคน", price_level=1),
        ]

        class Retriever(FakeRetriever):
            def list_by_categories(self, categories):
                return [r for r in extras if r["category"] in categories]

        service.retriever = Retriever([temple])
        _, candidates, _, _ = service.build_candidate_list(make_user_input(budget_level="หรูหรา", interests=["วัด"]))
        assert {"Temple", "Mall", "PremiumCafe"} <= names(candidates)
        assert "CheapCafe" not in names(candidates)

    def test_other_budgets_get_no_extras(self, service):
        mall = make_place_row("ml", "Mall", "เมืองขอนแก่น", category="ห้างสรรพสินค้า")

        class Retriever(FakeRetriever):
            def list_by_categories(self, categories):
                return [mall]

        service.retriever = Retriever([make_place_row("w1", "Temple", "เมืองขอนแก่น", category="วัด")])
        _, candidates, _, _ = service.build_candidate_list(make_user_input(budget_level="ปานกลาง", interests=["วัด"]))
        assert "Mall" not in names(candidates)

    def test_meal_reserve_takes_premium_restaurants_first(self, service):
        restaurants = [  # no hours data counts as open
            make_place_row(f"r{i}", name, "เมืองขอนแก่น", category="ร้านอาหาร", price=price, price_level=2)
            for i, (name, price) in enumerate([("Mid", "฿200-400 ต่อคน"), ("Premium", "฿600-800 ต่อคน"),
                                               ("Mid2", "฿200-400 ต่อคน"), ("Premium2", "฿400-600 ต่อคน")])
        ]
        service.retriever = FakeRetriever([], restaurants=restaurants)
        _, candidates, _, _ = service.build_candidate_list(make_user_input(budget_level="หรูหรา"))
        picked = [p.name for p in candidates if p.category == "ร้านอาหาร"]
        assert picked[:2] == ["Premium", "Premium2"]


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
        # The meal search and the generic daytime search (read only when the
        # interests can't fill the days) always run alongside the interest
        # searches (see build_candidate_list), in parallel, so order isn't fixed.
        assert sorted(service.retriever.queries_seen) == sorted([
            "วัฒนธรรม/ศาสนา", "ไดโนเสาร์", "ร้านอาหารแนะนำ ขอนแก่น", "สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น",
        ])

    def test_no_interests_falls_back_to_generic_single_query(self, service):
        service.retriever = FakeRetrieverByQuery({
            "สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น": [make_place_row("g1", "Generic1", district="เมืองขอนแก่น")],
        })
        user_input = make_user_input(interests=[])
        _, candidates, _, _ = service.build_candidate_list(user_input)
        assert "Generic1" in [p.name for p in candidates]
        assert sorted(service.retriever.queries_seen) == sorted(["สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น", "ร้านอาหารแนะนำ ขอนแก่น"])


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

    def test_blank_accommodation_still_has_a_name(self, service):
        # The form's "where are you staying" left empty: the closing slot is
        # saved with a name (backend tripPayload.js requires one).
        service.retriever = FakeRetriever([])
        accommodation, _, _, _ = service.build_candidate_list(make_user_input(accommodation_name=""))
        assert accommodation.name == "ใจกลางเมืองขอนแก่น"


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


class FakeCategoryRetriever:
    def __init__(self, rows):
        self._rows = rows

    def list_by_categories(self, categories):
        return [r for r in self._rows if r["category"] in categories]


class TestSparePool:
    """build_spare_pool: neutral places to fill dead time on trips whose
    interests can't -- well-established, near the accommodation, a market
    only when its time of day is known. Never shown to the LLM."""

    @staticmethod
    def spare_row(place_id, category="สวนสาธารณะ", **extra):
        row = make_place_row(place_id, place_id, "เมืองขอนแก่น", category=category, review_count=500)
        row.update(extra)
        return row

    def _pool(self, service, rows, exclude=(), **input_overrides):
        service.retriever = FakeCategoryRetriever(rows)
        hotel = Place(id="hotel", name="Hotel", category="ที่พัก", lat=16.44, lng=102.84)
        return service.build_spare_pool(make_user_input(**input_overrides), hotel, set(exclude))

    def test_every_spare_is_flagged(self, service):
        pool = self._pool(service, [self.spare_row("park")])
        assert [p.id for p in pool] == ["park"] and pool[0].is_spare

    def test_quality_bar_is_rating_4_and_200_reviews(self, service):
        pool = self._pool(service, [
            self.spare_row("ok", rating=4.0, review_count=200),
            self.spare_row("low_rating", rating=3.9),
            self.spare_row("few_reviews", review_count=199),
        ])
        assert names(pool) == {"ok"}

    def test_only_neutral_categories(self, service):
        pool = self._pool(service, [
            self.spare_row("park"), self.spare_row("landmark", category="สถานที่ท่องเที่ยว"),
            self.spare_row("temple", category="วัด"), self.spare_row("museum", category="พิพิธภัณฑ์"),
            self.spare_row("cafe", category="คาเฟ่"),
        ])
        assert names(pool) == {"park", "landmark"}

    def test_market_only_when_its_time_of_day_is_known(self, service):
        pool = self._pool(service, [
            self.spare_row("ตลาดโต้รุ่ง", category="ตลาด"),
            self.spare_row("ตลาดจอมพล", category="ตลาด"),
            self.spare_row("ตลาดตองแปด", category="ตลาด", market_time="all_day"),
            self.spare_row("ตลาดศิลานคร", category="ตลาด", market_time="evening"),
        ])
        assert names(pool) == {"ตลาดโต้รุ่ง", "ตลาดศิลานคร"}

    def test_luxury_budget_gets_no_market_spares(self, service):
        rows = [self.spare_row("ตลาดโต้รุ่ง", category="ตลาด"), self.spare_row("park")]
        assert names(self._pool(service, rows, budget_level="หรูหรา")) == {"park"}

    def test_candidates_already_in_play_and_closed_places_are_left_out(self, service):
        pool = self._pool(service, [
            self.spare_row("taken"), self.spare_row("shut", business_status="CLOSED_PERMANENTLY"), self.spare_row("free"),
        ], exclude={"taken"})
        assert names(pool) == {"free"}

    def test_area_scope_and_distance_from_the_accommodation(self, service):
        rows = [
            self.spare_row("city"),
            self.spare_row("other_district", district="ภูเวียง"),
            self.spare_row("city_but_far", lat=16.80),      # ~40 km away
        ]
        assert names(self._pool(service, rows, area_scope="เมือง")) == {"city"}
        assert names(self._pool(service, rows, area_scope="ทั่วขอนแก่น")) == {"city", "other_district"}

    def test_nearest_first(self, service):
        pool = self._pool(service, [self.spare_row("far", lat=16.50), self.spare_row("near", lat=16.445)])
        assert [p.id for p in pool] == ["near", "far"]


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


class TestCandidateRanking:
    """Every tag match scores 1.0 in the search, so build_candidate_list
    re-ranks each interest's results (orchestrator._rerank): relevance tier
    first, then mostly popularity and partly closeness to the accommodation."""

    def ids(self, service, rows, **input_overrides):
        class NoJitter:  # ranking noise off, so these orderings are exact
            def uniform(self, a, b):
                return a
        service.rng = NoJitter()
        service.retriever = FakeRetriever(rows)
        _, candidates, _, _ = service.build_candidate_list(make_user_input(**input_overrides))
        return [p.id for p in candidates]

    def test_many_reviews_beat_a_perfect_score_from_a_few(self, service):
        rows = [
            make_place_row("few", "Few", "เมืองขอนแก่น", rating=5.0, review_count=3),
            make_place_row("popular", "Popular", "เมืองขอนแก่น", rating=4.6, review_count=2000),
        ]
        order = self.ids(service, rows)
        assert order.index("popular") < order.index("few")

    def test_a_weaker_match_never_passes_a_tag_match(self, service):
        rows = [
            make_place_row("loose", "Loose", "เมืองขอนแก่น", rating=4.9, review_count=5000, match_score=0.55),
            make_place_row("tagged", "Tagged", "เมืองขอนแก่น", rating=4.0, review_count=20, match_score=1.0),
        ]
        order = self.ids(service, rows)
        assert order.index("tagged") < order.index("loose")

    def test_closer_to_the_accommodation_wins_between_equally_popular_places(self, service):
        rows = [
            make_place_row("far", "Far", "อำเภอภูเวียง", rating=4.5, review_count=500, lat=16.66, lng=102.37),
            make_place_row("near", "Near", "เมืองขอนแก่น", rating=4.5, review_count=500, lat=16.44, lng=102.84),
        ]
        order = self.ids(service, rows, accommodation_lat=16.43, accommodation_lng=102.83)
        assert order.index("near") < order.index("far")

    def test_popularity_outweighs_distance(self, service):
        rows = [
            make_place_row("near_unknown", "NearUnknown", "เมืองขอนแก่น", rating=4.0, review_count=10, lat=16.44, lng=102.84),
            make_place_row("far_famous", "FarFamous", "อำเภอภูเวียง", rating=4.8, review_count=3000, lat=16.66, lng=102.37),
        ]
        order = self.ids(service, rows, accommodation_lat=16.43, accommodation_lng=102.83)
        assert order.index("far_famous") < order.index("near_unknown")


class TestCategoryDiversity:
    def test_categories_alternate_within_a_relevance_tier(self):
        rows = [{"id": f"p{i}", "category": "สวนสาธารณะ", "match_score": 1.0} for i in range(4)] + [
            {"id": "w1", "category": "วัด", "match_score": 1.0},
            {"id": "m1", "category": "พิพิธภัณฑ์", "match_score": 1.0},
        ]
        order = [r["id"] for r in orchestrator_module._diversify(rows)]
        # Two parks, then the other categories, before the remaining parks.
        assert order[:4] == ["p0", "p1", "w1", "m1"]

    def test_a_weaker_match_still_never_passes_a_tag_match(self):
        rows = [{"id": f"p{i}", "category": "สวนสาธารณะ", "match_score": 1.0} for i in range(3)] + [
            {"id": "loose", "category": "วัด", "match_score": 0.5},
        ]
        assert [r["id"] for r in orchestrator_module._diversify(rows)][-1] == "loose"


class TestDaytimeTopUp:
    def test_evening_only_interests_get_daytime_places_added(self, service):
        evening = [
            make_place_row(f"m{i}", f"NightMarket{i}", "เมืองขอนแก่น", category="ตลาด", market_time="evening")
            for i in range(3)
        ]
        daytime = [make_place_row(f"d{i}", f"Sight{i}", "เมืองขอนแก่น", category=cat)
                   for i, cat in enumerate(["สถานที่ท่องเที่ยว", "วัด", "สวนสาธารณะ", "พิพิธภัณฑ์"] * 2)]
        service.retriever = FakeRetrieverByQuery({
            "ช้อปปิ้ง/หัตถกรรม": evening,
            "สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น": daytime,
        })
        _, candidates, _, _ = service.build_candidate_list(make_user_input(interests=["ช้อปปิ้ง/หัตถกรรม"], trip_pace="standard"))
        assert sum(1 for p in candidates if p.name.startswith("Sight")) >= 5   # standard 09-18: at least 5 a day

    def test_interests_with_enough_daytime_places_are_left_alone(self, service):
        # Varied enough to fill a day within the per-category caps.
        daytime = [make_place_row(f"d{i}", f"Sight{i}", "เมืองขอนแก่น", category=cat)
                   for i, cat in enumerate(["วัด", "พิพิธภัณฑ์", "สวนสาธารณะ"] * 3)]
        generic = [make_place_row("g1", "Generic1", "เมืองขอนแก่น", category="สถานที่ท่องเที่ยว")]
        service.retriever = FakeRetrieverByQuery({"วัฒนธรรม/ศาสนา": daytime, "สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น": generic})
        _, candidates, _, _ = service.build_candidate_list(make_user_input(interests=["วัฒนธรรม/ศาสนา"]))
        assert "Generic1" not in [p.name for p in candidates]


class TestDaytimeCapacity:
    def test_a_category_counts_only_up_to_its_daily_cap(self):
        cafes = [Place(id=f"c{i}", name=f"Cafe{i}", category="คาเฟ่") for i in range(10)]
        assert orchestrator_module._daytime_capacity(cafes, days=2) == 4      # 2 cafes a day
        parks = [Place(id=f"p{i}", name=f"Park{i}", category="สวนสาธารณะ") for i in range(10)]
        assert orchestrator_module._daytime_capacity(parks, days=1) == 3      # 3 of any other category

    def test_restaurants_and_evening_places_do_not_count(self):
        places = [Place(id="r", name="R", category="ร้านอาหาร"),
                  Place(id="m", name="ตลาดโต้รุ่ง", category="ตลาด", market_time="evening")]
        assert orchestrator_module._daytime_capacity(places, days=1) == 0

    def test_a_cafe_only_trip_gets_other_daytime_places_added(self, service):
        cafes = [make_place_row(f"c{i}", f"Cafe{i}", "เมืองขอนแก่น", category="คาเฟ่") for i in range(12)]
        sights = [make_place_row(f"s{i}", f"Sight{i}", "เมืองขอนแก่น", category=cat)
                  for i, cat in enumerate(["วัด", "สวนสาธารณะ", "พิพิธภัณฑ์", "สถานที่ท่องเที่ยว"] * 3)]
        service.retriever = FakeRetrieverByQuery({"คาเฟ่": cafes, "สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น": sights})
        _, candidates, _, _ = service.build_candidate_list(
            make_user_input(trip_duration_days=2, interests=["คาเฟ่"], trip_pace="standard"))
        # standard 09-18 needs 5 a day = 10; the cafes can supply only 4 of them.
        assert sum(1 for p in candidates if p.name.startswith("Sight")) >= 6


class TestFoodPreferenceCandidates:
    def test_restaurants_of_the_wanted_kind_are_offered(self, service):
        restaurants = [make_place_row(f"r{i}", f"Isan{i}", "เมืองขอนแก่น", category="ร้านอาหาร", subcategory="อาหารอีสาน",
                                      hours_periods=None) for i in range(5)]
        restaurants += [make_place_row(f"j{i}", f"Sushi{i}", "เมืองขอนแก่น", category="ร้านอาหาร", subcategory="ญี่ปุ่น/เกาหลี",
                                       hours_periods=None) for i in range(5)]
        service.retriever = FakeRetriever([make_place_row("c1", "Cafe1", "เมืองขอนแก่น")], restaurants=restaurants)
        _, candidates, _, _ = service.build_candidate_list(make_user_input(food_preferences=["อาหารอีสาน"]))
        names = [p.name for p in candidates]
        assert sum(1 for n in names if n.startswith("Isan")) >= 2
        assert not any(n.startswith("Sushi") for n in names)
