"""Unit tests for the deterministic (non-LLM) arithmetic in llm_extractor.py --
distance, visit duration, and opening-hours checks. These don't touch the
network (no KKU/Supabase calls); LLMTripPlanner is only instantiated to reach
its methods, `candidates=[]` is enough since none of the tested methods read
`self.candidates`.
"""
from datetime import datetime

import pytest

from src.services.trip_planner.llm_extractor import LLMTripPlanner
from src.services.trip_planner.models import Place, TripInput


@pytest.fixture
def planner():
    return LLMTripPlanner(candidates=[])


def make_place(**overrides):
    defaults = dict(
        id="p1", name="Test Place", category="คาเฟ่", rating=4.5,
        lat=16.4419, lng=102.8360,
    )
    defaults.update(overrides)
    return Place(**defaults)


class TestCalculateDistance:
    def test_same_point_is_zero(self, planner):
        p = make_place()
        assert planner.calculate_distance(p, p) == pytest.approx(0.0, abs=1e-9)

    def test_khon_kaen_to_bangkok_matches_known_distance(self, planner):
        # Great-circle (haversine) distance between Khon Kaen and Bangkok
        # centers, independently verified at ~389.8km (not the ~450km driving
        # distance, which isn't what this straight-line formula computes).
        khon_kaen = make_place(lat=16.4419, lng=102.8360)
        bangkok = make_place(lat=13.7563, lng=100.5018)
        dist = planner.calculate_distance(khon_kaen, bangkok)
        assert dist == pytest.approx(389.8, abs=5)

    def test_symmetric(self, planner):
        a = make_place(lat=16.44, lng=102.83)
        b = make_place(lat=16.46, lng=102.85)
        assert planner.calculate_distance(a, b) == pytest.approx(planner.calculate_distance(b, a))


class TestGetVisitDuration:
    @pytest.mark.parametrize("category,expected", [
        ("พิพิธภัณฑ์", 90), ("วัด", 45), ("สวนสาธารณะ", 60),
        ("ตลาด", 120), ("ร้านอาหาร", 60), ("คาเฟ่", 45), ("สถานที่ท่องเที่ยว", 60),
    ])
    def test_base_duration_by_category_standard_pace(self, planner, category, expected):
        p = make_place(category=category, name="Some Place")
        assert planner.get_visit_duration(p, "standard") == expected

    def test_unknown_category_defaults_to_60(self, planner):
        p = make_place(category="ไม่รู้จัก", name="Mystery Place")
        assert planner.get_visit_duration(p, "standard") == 60

    def test_relaxed_pace_adds_30(self, planner):
        p = make_place(category="คาเฟ่", name="Cafe")
        assert planner.get_visit_duration(p, "relaxed") == 45 + 30

    def test_packed_pace_subtracts_15_but_floors_at_30(self, planner):
        p = make_place(category="วัด", name="Temple")  # base 45 -> 30
        assert planner.get_visit_duration(p, "packed") == 30
        p2 = make_place(category="คาเฟ่", name="Cafe")  # base 45 -> 30
        assert planner.get_visit_duration(p2, "packed") == 30

    def test_buffet_keyword_overrides_category(self, planner):
        # A "ร้านอาหาร" (normally 60 min) that's actually a buffet place should
        # get the longer 120-min slot regardless of pace.
        p = make_place(category="ร้านอาหาร", name="หมูกระทะเด็ด")
        assert planner.get_visit_duration(p, "standard") == 120
        assert planner.get_visit_duration(p, "packed") == 120


class TestIsEveningPlace:
    def test_buffet_name_is_evening(self, planner):
        assert planner.is_evening_place(make_place(name="ตี๋น้อย หมูกระทะ")) is True

    def test_regular_cafe_is_not_evening(self, planner):
        assert planner.is_evening_place(make_place(name="Aimmes Cafe")) is False


class TestCheckIsOpen:
    def _periods_every_day(self, open_h=9, open_m=0, close_h=18, close_m=0):
        return [
            {"open": {"day": d, "hour": open_h, "minute": open_m}, "close": {"day": d, "hour": close_h, "minute": close_m}}
            for d in range(7)
        ]

    def test_no_hours_data_assumes_open(self, planner):
        p = make_place(hours_periods=None)
        result = planner.check_is_open(p, datetime(2026, 7, 27, 12, 0))
        assert result == {"is_open": True, "wait_min": 0, "status": "Open (No Data)"}

    def test_arrival_within_hours_is_open(self, planner):
        p = make_place(hours_periods=self._periods_every_day())
        # 2026-07-27 is a Monday; arriving at noon, well within 09:00-18:00.
        result = planner.check_is_open(p, datetime(2026, 7, 27, 12, 0))
        assert result["is_open"] is True
        assert result["status"] == "Open"
        assert result["wait_min"] == 0

    def test_arrival_before_opening_is_waiting(self, planner):
        p = make_place(hours_periods=self._periods_every_day(open_h=9))
        result = planner.check_is_open(p, datetime(2026, 7, 27, 8, 30))
        assert result["status"] == "Waiting"
        assert result["wait_min"] == 30

    def test_arrival_after_closing_is_closed(self, planner):
        p = make_place(hours_periods=self._periods_every_day(close_h=18))
        result = planner.check_is_open(p, datetime(2026, 7, 27, 19, 0))
        assert result["is_open"] is False
        assert result["status"] == "Closed"

    def test_closed_on_that_day_entirely(self, planner):
        # Only open Sunday (Google day=0); a Monday arrival has no matching period.
        p = make_place(hours_periods=[
            {"open": {"day": 0, "hour": 9, "minute": 0}, "close": {"day": 0, "hour": 18, "minute": 0}},
        ])
        result = planner.check_is_open(p, datetime(2026, 7, 27, 12, 0))  # Monday
        assert result == {"is_open": False, "wait_min": 0, "status": "Closed Today"}

    def _overnight_periods_every_day(self, open_h=11, open_m=0, close_h=0, close_m=0):
        # Google represents overnight hours (e.g. 11:00-00:00) as close.day
        # being the day AFTER open.day -- distinct from the same-day-close
        # shape _periods_every_day() builds.
        return [
            {
                "open": {"day": d, "hour": open_h, "minute": open_m},
                "close": {"day": (d + 1) % 7, "hour": close_h, "minute": close_m},
            }
            for d in range(7)
        ]

    def test_overnight_hours_arrival_before_open_is_waiting(self, planner):
        # Regression: arriving 5 min before an overnight-hours place opens
        # used to fall through to the generic "Closed" at the end of the
        # function instead of "Waiting" -- the arrival-before-opening branch
        # only existed inside the same-day-close case.
        p = make_place(hours_periods=self._overnight_periods_every_day(open_h=11))
        result = planner.check_is_open(p, datetime(2026, 7, 27, 10, 55))  # Monday
        assert result == {"is_open": False, "wait_min": 5, "status": "Waiting"}

    def test_overnight_hours_arrival_after_open_is_open(self, planner):
        p = make_place(hours_periods=self._overnight_periods_every_day(open_h=11))
        result = planner.check_is_open(p, datetime(2026, 7, 27, 15, 0))  # Monday
        assert result == {"is_open": True, "wait_min": 0, "status": "Open"}


class TestSolveRouteWithLLMBackstops:
    """solve_route_with_llm() trusts the LLM for place selection/ordering but
    is supposed to deterministically enforce two things it isn't reliable
    about on its own: never start a place after the user's end_time, and
    never keep a place that's provably closed in the final schedule. These
    mock out _call_llm_for_itinerary() (network call) to feed a controlled
    proposed schedule into the real post-processing loop."""

    HOTEL = make_place(id="hotel", name="Hotel", category="ที่พัก", lat=16.44, lng=102.84)

    def test_end_time_cutoff_drops_stops_that_would_start_late(self):
        # Same location as the hotel (distance/travel_min = 0) so only visit
        # duration (120 min for "ตลาด") drives the clock forward.
        stops = [
            make_place(id=f"m{i}", name=f"Market{i}", category="ตลาด", lat=16.44, lng=102.84, hours_periods=None)
            for i in range(1, 4)
        ]
        planner = LLMTripPlanner(candidates=stops, start_point=self.HOTEL)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [{"day": 1, "schedule": [
            {"place_id": "m1", "arrival_time": "09:00", "departure_time": "11:00"},
            {"place_id": "m2", "arrival_time": "11:00", "departure_time": "13:00"},
            {"place_id": "m3", "arrival_time": "13:00", "departure_time": "15:00"},
        ]}]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="12:15",
        )
        result = planner.solve_route_with_llm(user_input, "", "")
        names = [s.place.name for s in result[0].schedule]

        # Market1 (09:00-11:00) starts before the 12:15 cutoff, and so does
        # Market2 (starts 11:00, before the cutoff, even though it runs past
        # it) -- only Market3 would *start* after the cutoff and gets dropped.
        assert names == ["Market1", "Market2"]

    def test_drops_a_place_thats_closed_that_day(self):
        open_place = make_place(id="open1", name="OpenPlace", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        closed_place = make_place(
            id="closed1", name="ClosedPlace", category="คาเฟ่", lat=16.44, lng=102.84,
            hours_periods=[{"open": {"day": 0, "hour": 9, "minute": 0}, "close": {"day": 0, "hour": 18, "minute": 0}}],  # Sunday only
        )
        planner = LLMTripPlanner(candidates=[closed_place, open_place], start_point=self.HOTEL)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [{"day": 1, "schedule": [
            {"place_id": "closed1", "arrival_time": "10:00", "departure_time": "10:30"},
            {"place_id": "open1", "arrival_time": "11:00", "departure_time": "11:30"},
        ]}]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",  # Monday
            start_time="09:00", end_time="18:00",
        )
        result = planner.solve_route_with_llm(user_input, "", "")
        names = [s.place.name for s in result[0].schedule]

        assert "ClosedPlace" not in names
        assert "OpenPlace" in names

    def test_multi_day_trip_uses_the_real_weekday_per_day(self):
        # Regression: every day of a multi-day trip used to be checked
        # against Monday's hours (datetime.strptime(start_time, "%H:%M")
        # defaults to 1900-01-01, a Monday) regardless of start_date.
        # Open only Tuesday (Google day=2); day 2 of a trip starting Monday
        # 2026-08-03 is Tuesday 2026-08-04, so it should be open there but
        # not on day 1.
        tuesday_only = make_place(
            id="p1", name="TuesdayOnly", category="คาเฟ่", lat=16.44, lng=102.84,
            hours_periods=[{"open": {"day": 2, "hour": 9, "minute": 0}, "close": {"day": 2, "hour": 18, "minute": 0}}],
        )
        planner = LLMTripPlanner(candidates=[tuesday_only], start_point=self.HOTEL)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "schedule": [{"place_id": "p1", "arrival_time": "10:00", "departure_time": "10:30"}]},
            {"day": 2, "schedule": [{"place_id": "p1", "arrival_time": "10:00", "departure_time": "10:30"}]},
        ]}

        user_input = TripInput(
            trip_duration_days=2, start_date="2026-08-03", accommodation_name="Hotel",  # Mon + Tue
            start_time="09:00", end_time="18:00",
        )
        result = planner.solve_route_with_llm(user_input, "", "")

        day1_names = [s.place.name for s in result[0].schedule]
        day2_names = [s.place.name for s in result[1].schedule]
        assert "TuesdayOnly" not in day1_names
        assert "TuesdayOnly" in day2_names
        assert result[0].date == "2026-08-03"
        assert result[1].date == "2026-08-04"
