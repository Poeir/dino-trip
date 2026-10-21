"""The trip's end point (TripInput.trip_end, trip_ends.py): the last day ends at
an airport / bus terminal / station / district / pin instead of the
accommodation, early enough for the departure. No network, no LLM."""
from datetime import date, time

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.services.trip_planner import route_scheduler as rs
from src.services.trip_planner import trip_ends
from src.services.trip_planner.llm_extractor import LLMTripPlanner
from src.services.trip_planner.models import JudgeVerdict, Place, TripEnd, TripInput

HOTEL = Place(id="hotel", name="Hotel", category="ที่พัก", lat=16.44, lng=102.84)
AIRPORT = trip_ends.resolve_trip_end(TripEnd(kind="airport"), lambda _: None)
MONDAY = date(2026, 8, 3)


def make_place(id, lat, lng, category="สถานที่ท่องเที่ยว"):
    return Place(id=id, name=id, category=category, rating=4.5, review_count=500, lat=lat, lng=lng, hours_periods=None)


def trip(days=1, **overrides):
    base = dict(trip_duration_days=days, start_date="2026-08-03", accommodation_name="Hotel",
                start_time="09:00", end_time="18:00", trip_pace="standard")
    base.update(overrides)
    return TripInput(**base)


class TestTripEndInput:
    def test_unknown_kind_is_rejected(self):
        with pytest.raises(ValidationError):
            TripEnd(kind="harbour")

    def test_pin_needs_coordinates(self):
        with pytest.raises(ValidationError):
            TripEnd(kind="pin", name="บ้านเพื่อน")

    def test_district_needs_a_name(self):
        with pytest.raises(ValidationError):
            TripEnd(kind="district")

    def test_time_must_be_hh_mm(self):
        with pytest.raises(ValidationError):
            TripEnd(kind="airport", time="6pm")

    def test_trip_end_is_optional(self):
        assert trip().trip_end is None


class TestLastDayEndTime:
    def test_no_trip_end_keeps_the_normal_end(self):
        assert trip_ends.last_day_end_time(trip()) == time(18, 0)

    def test_flight_leaves_room_for_check_in(self):
        user_input = trip(trip_end=TripEnd(kind="airport", time="18:00"))
        assert trip_ends.last_day_end_time(user_input) == time(16, 30)

    def test_bus_needs_less_buffer(self):
        user_input = trip(trip_end=TripEnd(kind="bus", time="17:00"))
        assert trip_ends.last_day_end_time(user_input) == time(16, 30)

    def test_departure_after_the_day_ends_changes_nothing(self):
        user_input = trip(trip_end=TripEnd(kind="airport", time="22:00"))
        assert trip_ends.last_day_end_time(user_input) == time(18, 0)

    def test_district_without_time_keeps_the_normal_end(self):
        user_input = trip(trip_end=TripEnd(kind="district", name="ชุมแพ"))
        assert trip_ends.last_day_end_time(user_input) == time(18, 0)

    def test_early_flight_leaves_a_travel_only_day(self):
        user_input = trip(days=2, trip_end=TripEnd(kind="airport", time="09:30"))
        start, end = trip_ends.day_window(user_input, 2)
        assert end == start
        assert trip_ends.is_travel_only_day(start, end)

    def test_only_the_last_day_changes(self):
        user_input = trip(days=3, trip_end=TripEnd(kind="airport", time="15:00"))
        assert trip_ends.day_window(user_input, 1) == (time(9, 0), time(18, 0))
        assert trip_ends.day_window(user_input, 3) == (time(9, 0), time(13, 30))


class TestResolveTripEnd:
    def test_none_means_the_accommodation(self):
        assert trip_ends.resolve_trip_end(None, lambda _: None) is None

    def test_hub_has_fixed_coordinates(self):
        assert AIRPORT.name == "ท่าอากาศยานขอนแก่น"
        assert AIRPORT.category == trip_ends.TRIP_END_CATEGORY
        assert AIRPORT.lat == pytest.approx(16.4666, abs=1e-3)

    def test_district_uses_its_centre(self):
        end = trip_ends.resolve_trip_end(
            TripEnd(kind="district", name="ชุมแพ"), lambda name: {"lat": 16.54, "lng": 102.10, "count": 12},
        )
        assert (end.name, end.lat, end.lng) == ("อำเภอชุมแพ", 16.54, 102.10)

    def test_unknown_district_falls_back_to_the_accommodation(self):
        assert trip_ends.resolve_trip_end(TripEnd(kind="district", name="ไม่มีจริง"), lambda _: None) is None

    def test_pin_keeps_its_label(self):
        end = trip_ends.resolve_trip_end(TripEnd(kind="pin", name="บ้านยาย", lat=16.3, lng=102.7), lambda _: None)
        assert (end.name, end.lat, end.lng) == ("บ้านยาย", 16.3, 102.7)


class TestSchedulerEndsAtTheEndPoint:
    # Hotel in the middle; one stop east of it, one west near the airport.
    EAST = make_place("east", 16.44, 102.90)
    NEAR_AIRPORT = make_place("near_airport", 16.462, 102.79)

    def _order(self, end_loc):
        return [p.id for p in rs.order_day_stops(
            [self.NEAR_AIRPORT, self.EAST], HOTEL, MONDAY, time(9, 0), time(16, 30), "standard", end_loc=end_loc,
        )]

    def test_day_heads_toward_the_end_point(self):
        assert self._order(AIRPORT) == ["east", "near_airport"]

    def test_end_point_the_other_way_flips_the_order(self):
        far_east = Place(id="trip_end", name="far east", category=trip_ends.TRIP_END_CATEGORY, lat=16.44, lng=102.97)
        assert self._order(far_east) == ["near_airport", "east"]

    def test_last_slot_is_the_end_point_in_time(self):
        route = [self.EAST, self.NEAR_AIRPORT]
        schedule, _, _ = rs.materialize_day_schedule(
            route, set(), {}, HOTEL, MONDAY, time(9, 0), time(16, 30), "standard", end_loc=AIRPORT,
        )
        last = schedule[-1]
        assert last.place.name == "ท่าอากาศยานขอนแก่น"
        assert last.status == trip_ends.TRIP_END_STATUS
        assert last.arrival_time <= "16:30"

    def test_without_end_loc_the_day_returns_to_the_hotel(self):
        schedule, _, _ = rs.materialize_day_schedule(
            [self.EAST], set(), {}, HOTEL, MONDAY, time(9, 0), time(18, 0), "standard",
        )
        assert schedule[-1].place.id == "hotel"
        assert schedule[-1].status == "End of Day (Return to Hotel)"


def passing_planner(candidates, end_point):
    planner = LLMTripPlanner(candidates=candidates, start_point=HOTEL, end_point=end_point)
    planner.judge.evaluate = lambda user_input, itinerary, **_: JudgeVerdict(passed=True, score=1.0, rationale="ok")
    return planner


class TestPlannerWithTripEnd:
    PLACES = [
        make_place("a", 16.44, 102.85), make_place("b", 16.45, 102.86),
        make_place("c", 16.45, 102.80), make_place("d", 16.46, 102.79),
    ]

    def test_last_day_ends_at_the_airport_before_check_in(self):
        planner = passing_planner(self.PLACES, AIRPORT)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "a"}, {"place_id": "b"}]},
            {"day": 2, "places": [{"place_id": "c"}, {"place_id": "d"}]},
        ]}
        user_input = trip(days=2, trip_end=TripEnd(kind="airport", time="18:00"))
        days, _ = planner.solve_route_with_llm(user_input, "", "")
        assert days[0].schedule[-1].place.id == "hotel"
        last = days[1].schedule[-1]
        assert last.status == trip_ends.TRIP_END_STATUS
        assert last.arrival_time <= "16:30"
        assert {"c", "d"} <= {s.place.id for s in days[1].schedule}

    def test_departure_only_day_has_just_the_trip_to_the_end_point(self):
        planner = passing_planner(self.PLACES, AIRPORT)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "a"}, {"place_id": "b"}]},
            {"day": 2, "places": [{"place_id": "c"}]},
        ]}
        user_input = trip(days=2, trip_end=TripEnd(kind="airport", time="09:30"))
        days, _ = planner.solve_route_with_llm(user_input, "", "")
        assert [s.place.id for s in days[1].schedule] == ["trip_end"]
        # 09:30 flight - 90 min: at the airport by 08:00, not after the usual 09:00 start.
        assert days[1].schedule[0].arrival_time == "08:00"
        # An empty departure day is intended, not something to regenerate for.
        assert not planner.last_drops_need_regen

    def test_prompt_tells_the_llm_about_the_last_day(self):
        planner = passing_planner(self.PLACES, AIRPORT)
        prompt = planner.generate_prompt(trip(days=2, trip_end=TripEnd(kind="airport", time="18:00")), "", "")
        assert "Last day" in prompt and "ท่าอากาศยานขอนแก่น" in prompt and "16:30" in prompt

    def test_prompt_unchanged_without_a_trip_end(self):
        planner = passing_planner(self.PLACES, None)
        assert "Last day" not in planner.generate_prompt(trip(days=2), "", "")


def test_one_day_trip_with_no_time_left_is_rejected():
    from src.api import routes_tripplanner

    with pytest.raises(HTTPException) as err:
        routes_tripplanner.generate_trip_llm(trip(days=1, trip_end=TripEnd(kind="airport", time="10:00")))
    assert err.value.status_code == 422


def test_places_near_the_end_point_rank_as_close():
    import random

    from src.services.trip_planner.orchestrator import _rerank

    # Same popularity, both ~6.5 km from the hotel (west and east of it);
    # only the west one is at the airport. Without an end point it's a coin
    # toss; with one, the airport side wins every time.
    rows = [
        {"id": "east", "lat": 16.414, "lng": 102.896, "rating": 4.5, "review_count": 500},
        {"id": "near_airport", "lat": 16.466, "lng": 102.784, "rating": 4.5, "review_count": 500},
    ]
    for seed in range(20):
        ranked = _rerank(rows, HOTEL, random.Random(seed), end_point=AIRPORT)
        assert ranked[0]["id"] == "near_airport"
