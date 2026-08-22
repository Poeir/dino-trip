"""Unit tests for route_scheduler.py -- the deterministic (non-LLM) distance,
opening-hours, anchor-detection, and ordering/scheduling logic. No network,
no LLM: everything here is pure arithmetic over fixed lat/lng and hours_periods
fixtures.
"""
from datetime import date, datetime, time, timedelta

import pytest

from src.services.trip_planner import route_scheduler as rs
from src.services.trip_planner.models import Place


def make_place(**overrides):
    defaults = dict(
        id="p1", name="Test Place", category="คาเฟ่", rating=4.5,
        lat=16.4419, lng=102.8360,
    )
    defaults.update(overrides)
    return Place(**defaults)


HOTEL = make_place(id="hotel", name="Hotel", category="ที่พัก", lat=16.44, lng=102.84)


class TestCalculateDistance:
    def test_same_point_is_zero(self):
        p = make_place()
        assert rs.calculate_distance(p, p) == pytest.approx(0.0, abs=1e-9)

    def test_khon_kaen_to_bangkok_matches_known_distance(self):
        # Great-circle (haversine) distance between Khon Kaen and Bangkok
        # centers, independently verified at ~389.8km (not the ~450km driving
        # distance, which isn't what this straight-line formula computes).
        khon_kaen = make_place(lat=16.4419, lng=102.8360)
        bangkok = make_place(lat=13.7563, lng=100.5018)
        dist = rs.calculate_distance(khon_kaen, bangkok)
        assert dist == pytest.approx(389.8, abs=5)

    def test_symmetric(self):
        a = make_place(lat=16.44, lng=102.83)
        b = make_place(lat=16.46, lng=102.85)
        assert rs.calculate_distance(a, b) == pytest.approx(rs.calculate_distance(b, a))


class TestGetVisitDuration:
    @pytest.mark.parametrize("category,expected", [
        ("พิพิธภัณฑ์", 90), ("วัด", 45), ("สวนสาธารณะ", 60),
        ("ตลาด", 120), ("ร้านอาหาร", 60), ("คาเฟ่", 45), ("สถานที่ท่องเที่ยว", 60),
    ])
    def test_base_duration_by_category_standard_pace(self, category, expected):
        p = make_place(category=category, name="Some Place")
        assert rs.get_visit_duration(p, "standard") == expected

    def test_unknown_category_defaults_to_60(self):
        p = make_place(category="ไม่รู้จัก", name="Mystery Place")
        assert rs.get_visit_duration(p, "standard") == 60

    def test_relaxed_pace_adds_30(self):
        p = make_place(category="คาเฟ่", name="Cafe")
        assert rs.get_visit_duration(p, "relaxed") == 45 + 30

    def test_packed_pace_subtracts_15_but_floors_at_30(self):
        p = make_place(category="วัด", name="Temple")  # base 45 -> 30
        assert rs.get_visit_duration(p, "packed") == 30
        p2 = make_place(category="คาเฟ่", name="Cafe")  # base 45 -> 30
        assert rs.get_visit_duration(p2, "packed") == 30

    def test_buffet_keyword_overrides_category(self):
        # A "ร้านอาหาร" (normally 60 min) that's actually a buffet place should
        # get the longer 120-min slot regardless of pace.
        p = make_place(category="ร้านอาหาร", name="หมูกระทะเด็ด")
        assert rs.get_visit_duration(p, "standard") == 120
        assert rs.get_visit_duration(p, "packed") == 120


class TestIsEveningPlace:
    def test_buffet_name_is_evening(self):
        assert rs.is_evening_place(make_place(name="ตี๋น้อย หมูกระทะ")) is True

    def test_regular_cafe_is_not_evening(self):
        assert rs.is_evening_place(make_place(name="Aimmes Cafe")) is False


class TestCheckIsOpen:
    def _periods_every_day(self, open_h=9, open_m=0, close_h=18, close_m=0):
        return [
            {"open": {"day": d, "hour": open_h, "minute": open_m}, "close": {"day": d, "hour": close_h, "minute": close_m}}
            for d in range(7)
        ]

    def test_no_hours_data_assumes_open(self):
        p = make_place(hours_periods=None)
        result = rs.check_is_open(p, datetime(2026, 7, 27, 12, 0))
        assert result == {"is_open": True, "wait_min": 0, "status": "Open (No Data)"}

    def test_arrival_within_hours_is_open(self):
        p = make_place(hours_periods=self._periods_every_day())
        # 2026-07-27 is a Monday; arriving at noon, well within 09:00-18:00.
        result = rs.check_is_open(p, datetime(2026, 7, 27, 12, 0))
        assert result["is_open"] is True
        assert result["status"] == "Open"
        assert result["wait_min"] == 0

    def test_arrival_before_opening_is_waiting(self):
        p = make_place(hours_periods=self._periods_every_day(open_h=9))
        result = rs.check_is_open(p, datetime(2026, 7, 27, 8, 30))
        assert result["status"] == "Waiting"
        assert result["wait_min"] == 30

    def test_arrival_after_closing_is_closed(self):
        p = make_place(hours_periods=self._periods_every_day(close_h=18))
        result = rs.check_is_open(p, datetime(2026, 7, 27, 19, 0))
        assert result["is_open"] is False
        assert result["status"] == "Closed"

    def test_closed_on_that_day_entirely(self):
        # Only open Sunday (Google day=0); a Monday arrival has no matching period.
        p = make_place(hours_periods=[
            {"open": {"day": 0, "hour": 9, "minute": 0}, "close": {"day": 0, "hour": 18, "minute": 0}},
        ])
        result = rs.check_is_open(p, datetime(2026, 7, 27, 12, 0))  # Monday
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

    def test_overnight_hours_arrival_before_open_is_waiting(self):
        p = make_place(hours_periods=self._overnight_periods_every_day(open_h=11))
        result = rs.check_is_open(p, datetime(2026, 7, 27, 10, 55))  # Monday
        assert result == {"is_open": False, "wait_min": 5, "status": "Waiting"}

    def test_overnight_hours_arrival_after_open_is_open(self):
        p = make_place(hours_periods=self._overnight_periods_every_day(open_h=11))
        result = rs.check_is_open(p, datetime(2026, 7, 27, 15, 0))  # Monday
        assert result == {"is_open": True, "wait_min": 0, "status": "Open"}

    def test_mixed_same_day_and_overnight_periods_matches_the_right_one(self):
        # Regression: a place with BOTH a same-day morning slot and an
        # overnight slot listed for the same weekday used to have whichever
        # period was iterated first win unconditionally -- an arrival that
        # actually falls in the morning slot could incorrectly get
        # evaluated against the overnight slot instead (returning a long,
        # wrong "Waiting" answer) if the overnight period happened to come
        # first in the list.
        p = make_place(hours_periods=[
            {"open": {"day": 1, "hour": 20, "minute": 0}, "close": {"day": 2, "hour": 2, "minute": 0}},  # overnight, listed first
            {"open": {"day": 1, "hour": 9, "minute": 0}, "close": {"day": 1, "hour": 12, "minute": 0}},  # same-day morning slot
        ])
        result = rs.check_is_open(p, datetime(2026, 7, 27, 10, 0))  # Monday 10:00 -- inside the morning slot
        assert result == {"is_open": True, "wait_min": 0, "status": "Open"}

    def test_multiple_same_day_periods_picks_the_soonest_opening(self):
        # Regression: out-of-order split-hours periods used to return
        # "Waiting" for whichever period was checked first, even if a
        # different period for the same day opens sooner.
        p = make_place(hours_periods=[
            {"open": {"day": 1, "hour": 14, "minute": 0}, "close": {"day": 1, "hour": 18, "minute": 0}},
            {"open": {"day": 1, "hour": 9, "minute": 0}, "close": {"day": 1, "hour": 12, "minute": 0}},
        ])
        result = rs.check_is_open(p, datetime(2026, 7, 27, 8, 0))  # Monday 08:00
        assert result == {"is_open": False, "wait_min": 60, "status": "Waiting"}  # waits for 09:00, not 14:00


class TestFindAnchorWindow:
    MONDAY = date(2026, 7, 27)

    def test_no_hours_data_is_never_an_anchor(self):
        p = make_place(hours_periods=None)
        assert rs.find_anchor_window(p, self.MONDAY) is None

    def test_narrow_window_is_an_anchor(self):
        p = make_place(hours_periods=[
            {"open": {"day": 1, "hour": 6, "minute": 0}, "close": {"day": 1, "hour": 9, "minute": 0}},
        ])
        assert rs.find_anchor_window(p, self.MONDAY) == (6 * 60, 9 * 60)

    def test_wide_window_is_not_an_anchor(self):
        p = make_place(hours_periods=[
            {"open": {"day": 1, "hour": 9, "minute": 0}, "close": {"day": 1, "hour": 21, "minute": 0}},
        ])
        assert rs.find_anchor_window(p, self.MONDAY) is None

    def test_multiple_periods_same_day_is_not_an_anchor(self):
        p = make_place(hours_periods=[
            {"open": {"day": 1, "hour": 9, "minute": 0}, "close": {"day": 1, "hour": 11, "minute": 0}},
            {"open": {"day": 1, "hour": 17, "minute": 0}, "close": {"day": 1, "hour": 19, "minute": 0}},
        ])
        assert rs.find_anchor_window(p, self.MONDAY) is None

    def test_overnight_window_is_not_an_anchor(self):
        p = make_place(hours_periods=[
            {"open": {"day": 1, "hour": 20, "minute": 0}, "close": {"day": 2, "hour": 1, "minute": 0}},
        ])
        assert rs.find_anchor_window(p, self.MONDAY) is None


class TestPreferredTimeWindow:
    def test_restaurant_with_lunch_role(self):
        p = make_place(category="ร้านอาหาร")
        assert rs.preferred_time_window(p, "lunch") == rs.MEAL_LUNCH_WINDOW

    def test_restaurant_with_dinner_role(self):
        p = make_place(category="ร้านอาหาร")
        assert rs.preferred_time_window(p, "dinner") == rs.MEAL_DINNER_WINDOW

    def test_restaurant_no_role_evening_keyword_gets_dinner_window(self):
        p = make_place(category="ร้านอาหาร", name="หมูกระทะเด็ด")
        assert rs.preferred_time_window(p, None) == rs.MEAL_DINNER_WINDOW

    def test_restaurant_no_role_no_keyword_gets_union_window(self):
        p = make_place(category="ร้านอาหาร", name="Regular Restaurant")
        assert rs.preferred_time_window(p, None) == (rs.MEAL_LUNCH_WINDOW[0], rs.MEAL_DINNER_WINDOW[1])

    def test_cafe_window(self):
        assert rs.preferred_time_window(make_place(category="คาเฟ่")) == rs.CAFE_WINDOW

    @pytest.mark.parametrize("category", ["วัด", "สถานที่ท่องเที่ยว", "พิพิธภัณฑ์", "สวนสาธารณะ"])
    def test_attraction_categories_get_morning_window(self, category):
        assert rs.preferred_time_window(make_place(category=category)) == rs.ATTRACTION_WINDOW

    def test_regular_market_is_flexible(self):
        assert rs.preferred_time_window(make_place(category="ตลาด", name="ตลาดเช้า")) is None

    def test_night_market_gets_evening_window(self):
        assert rs.preferred_time_window(make_place(category="ตลาด", name="ตลาดกลางคืน")) == rs.MARKET_EVENING_WINDOW


class TestOrderDayStops:
    DAY = date(2026, 7, 27)  # Monday

    def test_reorders_a_geographically_bad_input_order(self):
        # Hotel at (16.44, 102.84). Two places, both near the hotel except
        # "Far" is much further east. Input order deliberately visits Far
        # first then Near -- a sensible route should still end up visiting
        # whichever minimizes backtracking, in this case Near before Far
        # keeps both legs short instead of hotel->Far->Near->(implicit)hotel.
        near = make_place(id="near", name="Near", category="คาเฟ่", lat=16.441, lng=102.841, hours_periods=None)
        far = make_place(id="far", name="Far", category="คาเฟ่", lat=16.60, lng=103.20, hours_periods=None)
        route = rs.order_day_stops([far, near], HOTEL, self.DAY, time(9, 0), time(20, 0), "standard")
        names = [p.name for p in route]
        assert names == ["Near", "Far"]

    def test_anchor_holds_its_position_despite_geographic_inconvenience(self):
        # Anchor is geographically far from the hotel and from the flexible
        # stop, and only open 06:00-09:00 -- it must still end up first in
        # the route since nothing else fits that window.
        anchor = make_place(
            id="anchor", name="MorningMarket", category="ตลาด", lat=16.70, lng=103.30,
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 0}, "close": {"day": 1, "hour": 9, "minute": 0}}],
        )
        flexible = make_place(id="flex", name="FlexCafe", category="คาเฟ่", lat=16.441, lng=102.841, hours_periods=None)
        route = rs.order_day_stops([flexible, anchor], HOTEL, self.DAY, time(6, 0), time(20, 0), "standard")
        assert route[0].id == "anchor"

    def test_two_anchors_with_infeasible_gap_does_not_crash(self):
        # Anchor A: 06:00-07:00 near the hotel. Anchor B: 06:00-06:30, very
        # far away -- impossible to reach from A in time, and B's own real
        # window is too narrow to reach directly from the hotel either.
        # The scheduler must not crash; B is genuinely unreachable this day
        # so it's correctly dropped rather than force-fit somewhere wrong.
        anchor_a = make_place(
            id="a", name="AnchorA", category="ตลาด", lat=16.441, lng=102.841,
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 0}, "close": {"day": 1, "hour": 7, "minute": 0}}],
        )
        anchor_b = make_place(
            id="b", name="AnchorB", category="ตลาด", lat=17.5, lng=104.5,
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 0}, "close": {"day": 1, "hour": 6, "minute": 30}}],
        )
        route = rs.order_day_stops([anchor_a, anchor_b], HOTEL, self.DAY, time(6, 0), time(20, 0), "standard")
        assert "a" in {p.id for p in route}

    def test_meal_role_places_land_near_their_target_window(self):
        # Start the day at noon (inside the lunch window) so the two
        # possible orderings genuinely differ in cost: whichever spot lands
        # in the ~12:00 slot should be the lunch one, not just whichever
        # was listed first.
        lunch_spot = make_place(id="lunch", name="LunchPlace", category="ร้านอาหาร", lat=16.441, lng=102.841, hours_periods=None)
        dinner_spot = make_place(id="dinner", name="DinnerPlace", category="ร้านอาหาร", lat=16.442, lng=102.842, hours_periods=None)
        route = rs.order_day_stops(
            [dinner_spot, lunch_spot], HOTEL, self.DAY, time(12, 0), time(21, 0), "standard",
            meal_roles={"lunch": "lunch", "dinner": "dinner"},
        )
        assert [p.id for p in route] == ["lunch", "dinner"]

    def test_overfull_day_does_not_crash(self):
        stops = [
            make_place(id=f"s{i}", name=f"Stop{i}", category="คาเฟ่", lat=16.44 + i * 0.05, lng=102.84 + i * 0.05, hours_periods=None)
            for i in range(10)
        ]
        route = rs.order_day_stops(stops, HOTEL, self.DAY, time(9, 0), time(11, 0), "standard")
        assert isinstance(route, list)


class TestMaterializeDaySchedule:
    DAY = date(2026, 7, 27)

    def test_last_day_still_returns_to_hotel(self):
        # Regression: the old single-pass implementation only added the
        # return-to-hotel leg when day_num < trip_duration_days, so a
        # trip's final day just stopped at the last activity.
        stop = make_place(id="p1", name="Place1", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        schedule, _, _ = rs.materialize_day_schedule(
            [stop], set(), {}, HOTEL, self.DAY, time(9, 0), time(18, 0), "standard",
        )
        assert schedule[-1].status == "End of Day (Return to Hotel)"
        assert schedule[-1].place.id == "hotel"

    def test_dinner_tagged_restaurant_waits_for_its_window_instead_of_eating_early(self):
        # Regression (found via a live end-to-end run): a restaurant tagged
        # "dinner" that the route reaches at 14:00 used to just get eaten
        # at 14:00 -- the soft time-window cost only shaped which slot a
        # meal landed in during ordering, nothing made it actually wait.
        stop = make_place(id="p1", name="DinnerPlace", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        schedule, _, _ = rs.materialize_day_schedule(
            [stop], set(), {"p1": "dinner"}, HOTEL, self.DAY, time(14, 0), time(21, 0), "standard",
        )
        slot = next(s for s in schedule if s.place.id == "p1")
        arrival_min = int(slot.arrival_time[:2]) * 60 + int(slot.arrival_time[3:])
        assert arrival_min >= rs.MEAL_DINNER_WINDOW[0]

    def test_lunch_tagged_restaurant_reached_within_window_does_not_wait(self):
        stop = make_place(id="p1", name="LunchPlace", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        schedule, _, _ = rs.materialize_day_schedule(
            [stop], set(), {"p1": "lunch"}, HOTEL, self.DAY, time(12, 0), time(21, 0), "standard",
        )
        slot = next(s for s in schedule if s.place.id == "p1")
        assert slot.arrival_time == "12:00"

    def test_tags_anchor_and_meal_role_on_the_slot(self):
        stop = make_place(id="p1", name="Place1", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        schedule, _, _ = rs.materialize_day_schedule(
            [stop], {"p1"}, {"p1": "lunch"}, HOTEL, self.DAY, time(9, 0), time(18, 0), "standard",
        )
        slot = next(s for s in schedule if s.place.id == "p1")
        assert slot.is_anchor is True
        assert slot.meal_role == "lunch"


class TestReassignInfeasibleDays:
    START = date(2026, 8, 3)  # Monday

    def test_moves_place_to_a_day_its_actually_open_on(self):
        tuesday_only = make_place(
            id="p1", name="TuesdayOnly", hours_periods=[
                {"open": {"day": 2, "hour": 9, "minute": 0}, "close": {"day": 2, "hour": 18, "minute": 0}},
            ],
        )
        result = rs.reassign_infeasible_days({1: [tuesday_only], 2: []}, self.START, 2)
        assert result[1] == []
        assert [p.id for p in result[2]] == ["p1"]

    def test_drops_place_closed_every_day_of_the_trip(self):
        never_open_this_trip = make_place(
            id="p1", name="SundayOnly", hours_periods=[
                {"open": {"day": 0, "hour": 9, "minute": 0}, "close": {"day": 0, "hour": 18, "minute": 0}},
            ],
        )
        result = rs.reassign_infeasible_days({1: [never_open_this_trip], 2: []}, self.START, 2)
        assert result[1] == []
        assert result[2] == []

    def test_leaves_no_hours_data_places_untouched(self):
        p = make_place(id="p1", name="NoHoursData", hours_periods=None)
        result = rs.reassign_infeasible_days({1: [p]}, self.START, 1)
        assert [pl.id for pl in result[1]] == ["p1"]

    def test_leaves_places_open_on_their_assigned_day_untouched(self):
        p = make_place(id="p1", name="MondayOnly", hours_periods=[
            {"open": {"day": 1, "hour": 9, "minute": 0}, "close": {"day": 1, "hour": 18, "minute": 0}},
        ])
        result = rs.reassign_infeasible_days({1: [p]}, self.START, 1)
        assert [pl.id for pl in result[1]] == ["p1"]


def make_filler(place_id, category="คาเฟ่"):
    # Near HOTEL (16.44, 102.84) so travel time is ~0 and doesn't complicate
    # the gap-size arithmetic these tests reason about; hours_periods=None
    # means "always open" so it's never dropped for closed-hours reasons.
    return make_place(id=place_id, name=f"Filler{place_id}", category=category, lat=16.441, lng=102.841, hours_periods=None)


class TestBackfillUnderfilledTrip:
    """backfill_underfilled_trip is the cross-day counterpart of
    backfill_underfilled_day: it exists specifically because calling the
    single-day version once per day in day-number order let day 1 alone
    exhaust a limited shared pool before day 2 ever got a turn (confirmed
    live on a 3-day request where day 1 consumed the whole pool, leaving
    days 2-3 with 5-8 hour dead stretches). These tests target that
    cross-day fairness behavior directly, without depending on a live,
    non-deterministic LLM call."""
    MONDAY = date(2026, 7, 27)
    TUESDAY = date(2026, 7, 28)

    def test_spreads_backfill_across_days_instead_of_exhausting_pool_on_day_one(self):
        # Both days start equally empty (same size gap) with a 2-item pool
        # -- the old sequential-per-day approach would keep pulling into
        # day 1 until either its gap closed or the pool ran out, and a
        # 45-minute cafe visit doesn't come close to closing a 9-hour gap
        # in 2 items, so day 1 would take both and day 2 would get none.
        pool = [make_filler("pool1"), make_filler("pool2")]
        routes = rs.backfill_underfilled_trip(
            {1: [], 2: []}, {1: self.MONDAY, 2: self.TUESDAY},
            {}, HOTEL, time(9, 0), time(18, 0), "standard", pool,
        )
        assert len(routes[1]) == 1
        assert len(routes[2]) == 1
        assert pool == []

    def test_does_not_double_book_the_same_place_into_two_days(self):
        pool = [make_filler("shared")]
        routes = rs.backfill_underfilled_trip(
            {1: [], 2: []}, {1: self.MONDAY, 2: self.TUESDAY},
            {}, HOTEL, time(9, 0), time(18, 0), "standard", pool,
        )
        all_ids = [p.id for route in routes.values() for p in route]
        assert all_ids.count("shared") == 1

    def test_only_fills_the_day_that_actually_has_a_gap(self):
        # Day 1 is already at the per-day stop cap -- must be left alone
        # even though it's iterated -- while day 2 (empty, a 9-hour gap)
        # should get the pool instead.
        day1_full = [make_filler(f"d1_{i}") for i in range(rs.MAX_STOPS_PER_DAY)]
        pool = [make_filler("pool1")]
        routes = rs.backfill_underfilled_trip(
            {1: day1_full, 2: []}, {1: self.MONDAY, 2: self.TUESDAY},
            {}, HOTEL, time(9, 0), time(18, 0), "standard", pool,
        )
        assert len(routes[1]) == rs.MAX_STOPS_PER_DAY
        assert len(routes[2]) == 1

    def test_does_not_touch_a_day_within_the_gap_threshold(self):
        # 09:00-10:15 window with one 45-min cafe visit leaves a ~30min
        # trailing gap -- comfortably under UNDERFILLED_GAP_MINUTES (180),
        # so this is a "merely short" day backfill must leave alone.
        route = [make_filler("only")]
        pool = [make_filler("pool1")]
        routes = rs.backfill_underfilled_trip(
            {1: route}, {1: self.MONDAY},
            {}, HOTEL, time(9, 0), time(10, 15), "standard", pool,
        )
        assert len(routes[1]) == 1
        assert len(pool) == 1  # nothing consumed

    def test_respects_max_stops_per_day_even_with_an_abundant_pool(self):
        pool = [make_filler(f"pool{i}") for i in range(rs.MAX_STOPS_PER_DAY + 5)]
        routes = rs.backfill_underfilled_trip(
            {1: []}, {1: self.MONDAY},
            {}, HOTEL, time(9, 0), time(20, 0), "standard", pool,
        )
        assert len(routes[1]) <= rs.MAX_STOPS_PER_DAY

    def test_empty_pool_is_a_no_op(self):
        routes_in = {1: [], 2: []}
        result = rs.backfill_underfilled_trip(
            routes_in, {1: self.MONDAY, 2: self.TUESDAY},
            {}, HOTEL, time(9, 0), time(18, 0), "standard", [],
        )
        assert result == routes_in

    def test_a_day_stuck_on_infeasible_candidates_does_not_block_other_days(self):
        # Regression/safety: the pool's only place is closed on day 1's
        # weekday (Monday) but open on day 2's (Tuesday). Without tracking
        # "stuck" days, day 1 -- tied with day 2 on gap size every round,
        # since neither ever changes -- would keep winning the
        # largest-gap check forever with nothing it can actually use,
        # hanging this function rather than moving on to day 2.
        tuesday_only = make_place(
            id="tue", name="TuesdayOnly", category="คาเฟ่", lat=16.441, lng=102.841,
            hours_periods=[{"open": {"day": 2, "hour": 9, "minute": 0}, "close": {"day": 2, "hour": 18, "minute": 0}}],
        )
        pool = [tuesday_only]
        routes = rs.backfill_underfilled_trip(
            {1: [], 2: []}, {1: self.MONDAY, 2: self.TUESDAY},
            {}, HOTEL, time(9, 0), time(18, 0), "standard", pool,
        )
        assert routes[1] == []
        assert [p.id for p in routes[2]] == ["tue"]
