"""Unit tests for route_scheduler.py -- the deterministic (non-LLM) distance,
opening-hours, anchor-detection, and ordering/scheduling logic. No network,
no LLM: everything here is pure arithmetic over fixed lat/lng and hours_periods
fixtures.
"""
import itertools
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
        ("ห้างสรรพสินค้า", 90), ("ร้านของฝาก", 30),
    ])
    def test_base_duration_by_category_standard_pace(self, category, expected):
        p = make_place(category=category, name="Some Place")
        assert rs.get_visit_duration(p, "standard") == expected

    def test_unknown_category_defaults_to_60(self):
        p = make_place(category="ไม่รู้จัก", name="Mystery Place")
        assert rs.get_visit_duration(p, "standard") == 60

    @pytest.mark.parametrize("pace", ["relaxed", "standard", "packed"])
    def test_pace_does_not_change_duration(self, pace):
        # Pace controls how many attractions a day gets (pace_stop_range),
        # not how long each one takes.
        assert rs.get_visit_duration(make_place(category="วัด", name="Temple"), pace) == 45
        assert rs.get_visit_duration(make_place(category="คาเฟ่", name="Cafe"), pace) == 45
        assert rs.get_visit_duration(make_place(category="ตลาด", name="Market"), pace) == 120

    def test_buffet_keyword_overrides_category(self):
        # A "ร้านอาหาร" (normally 60 min) that's actually a buffet place should
        # get the longer 120-min slot regardless of pace.
        p = make_place(category="ร้านอาหาร", name="หมูกระทะเด็ด")
        assert rs.get_visit_duration(p, "standard") == 120
        assert rs.get_visit_duration(p, "packed") == 120


class TestPaceStopRange:
    @pytest.mark.parametrize("pace,start,end,expected", [
        ("relaxed", time(9, 0), time(18, 0), (3, 4)),
        ("standard", time(9, 0), time(18, 0), (4, 5)),
        ("packed", time(9, 0), time(18, 0), (6, 7)),
        ("relaxed", time(9, 0), time(14, 0), (1, 2)),
        ("packed", time(9, 0), time(14, 0), (3, 4)),
        ("relaxed", time(9, 0), time(22, 0), (4, 5)),
    ])
    def test_range_scales_with_window(self, pace, start, end, expected):
        assert rs.pace_stop_range(pace, start, end) == expected

    def test_wider_window_never_gives_fewer_stops(self):
        for pace in ("relaxed", "standard", "packed"):
            narrow = rs.pace_stop_range(pace, time(9, 0), time(13, 0))
            wide = rs.pace_stop_range(pace, time(9, 0), time(21, 0))
            assert wide[1] >= narrow[1]

    def test_faster_pace_never_gives_fewer_stops(self):
        r = rs.pace_stop_range("relaxed", time(9, 0), time(18, 0))
        s = rs.pace_stop_range("standard", time(9, 0), time(18, 0))
        k = rs.pace_stop_range("packed", time(9, 0), time(18, 0))
        assert r[1] <= s[1] <= k[1]

    def test_tiny_window_still_allows_one_and_huge_window_is_capped(self):
        assert rs.pace_stop_range("relaxed", time(9, 0), time(9, 30))[0] == 1
        assert rs.pace_stop_range("packed", time(6, 0), time(23, 59))[1] == rs.MAX_STOPS_PER_DAY

    def test_restaurants_do_not_count_but_cafes_do(self):
        places = [
            make_place(id="a", category="วัด"), make_place(id="b", category="คาเฟ่"),
            make_place(id="c", category="ร้านอาหาร"),
        ]
        assert rs.attraction_count(places) == 2


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

    @pytest.mark.parametrize("status", ["CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"])
    def test_business_closed_overrides_normal_hours(self, status):
        # Scraped weekly hours say it's open right now -- business_status
        # says otherwise and must win.
        p = make_place(hours_periods=self._periods_every_day(), business_status=status)
        result = rs.check_is_open(p, datetime(2026, 7, 27, 12, 0))  # Monday noon, well within hours
        assert result == {"is_open": False, "wait_min": 0, "status": "Closed Today"}

    def test_business_closed_with_no_hours_data_is_still_closed(self):
        # Without the business_status check, this would fall into the "no
        # hours_periods -> assume open" branch.
        p = make_place(hours_periods=None, business_status="CLOSED_PERMANENTLY")
        result = rs.check_is_open(p, datetime(2026, 7, 27, 12, 0))
        assert result == {"is_open": False, "wait_min": 0, "status": "Closed Today"}

    def test_operational_business_status_does_not_affect_normal_hours(self):
        p = make_place(hours_periods=self._periods_every_day(), business_status="OPERATIONAL")
        result = rs.check_is_open(p, datetime(2026, 7, 27, 12, 0))
        assert result["status"] == "Open"

    def test_24_7_sentinel_is_open_every_weekday(self):
        # Regression: Google represents "open 24 hours, every day" as ONE
        # period {"open": {"day": 0, "hour": 0, "minute": 0}} with no
        # "close" key -- day 0 is a fixed sentinel here, not "Sundays
        # only". Filtering by the arrival's actual weekday (as a normal,
        # real per-day schedule needs) used to make this match only on an
        # actual Sunday, reporting "Closed Today" every other day -- a real
        # 24/7 park got dropped from a trip with no Sunday in it this way.
        p = make_place(hours_periods=[{"open": {"day": 0, "hour": 0, "minute": 0}}])
        for day_offset in range(7):  # Monday..Sunday
            arrival = datetime(2026, 7, 27, 3, 0) + timedelta(days=day_offset)
            result = rs.check_is_open(p, arrival)
            assert result == {"is_open": True, "wait_min": 0, "status": "Open"}, day_offset

    def test_normal_sunday_only_hours_are_not_mistaken_for_24_7(self):
        # A place genuinely open Sunday 09:00-18:00 only (has a "close"
        # key) must still be correctly "Closed Today" on other weekdays --
        # the 24/7-sentinel fix must not swallow this real case.
        p = make_place(hours_periods=[
            {"open": {"day": 0, "hour": 9, "minute": 0}, "close": {"day": 0, "hour": 18, "minute": 0}},
        ])
        result = rs.check_is_open(p, datetime(2026, 7, 27, 12, 0))  # Monday
        assert result == {"is_open": False, "wait_min": 0, "status": "Closed Today"}


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

    def test_24_7_sentinel_is_not_an_anchor(self):
        p = make_place(hours_periods=[{"open": {"day": 0, "hour": 0, "minute": 0}}])
        assert rs.find_anchor_window(p, self.MONDAY) is None

    def test_overnight_window_is_not_an_anchor(self):
        p = make_place(hours_periods=[
            {"open": {"day": 1, "hour": 20, "minute": 0}, "close": {"day": 2, "hour": 1, "minute": 0}},
        ])
        assert rs.find_anchor_window(p, self.MONDAY) is None

    def test_business_closed_is_never_an_anchor_even_with_a_narrow_window(self):
        p = make_place(
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 0}, "close": {"day": 1, "hour": 9, "minute": 0}}],
            business_status="CLOSED_PERMANENTLY",
        )
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
        assert rs.preferred_time_window(make_place(category="ตลาด", name="ตลาดจอมพล")) is None

    def test_morning_market_gets_morning_window(self):
        assert rs.preferred_time_window(make_place(category="ตลาด", name="ตลาดเช้า")) == rs.MARKET_MORNING_WINDOW

    def test_night_market_gets_evening_window(self):
        assert rs.preferred_time_window(make_place(category="ตลาด", name="ตลาดกลางคืน")) == rs.MARKET_EVENING_WINDOW


class TestOrderDayStops:
    DAY = date(2026, 7, 27)  # Monday

    def test_reorders_a_geographically_bad_input_order(self):
        # Hotel at (16.44, 102.84). Input order visits the far place first and
        # the near one in the middle -- a sensible route must come out as a
        # shortest round trip. Which DIRECTION round the loop is not
        # asserted: a closed tour and its reverse are the same length, so
        # with the return leg counted they tie and input order breaks it.
        near = make_place(id="near", name="Near", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
        mid = make_place(id="mid", name="Mid", category="สถานที่ท่องเที่ยว", lat=16.44, lng=102.90, hours_periods=None)
        far = make_place(id="far", name="Far", category="สถานที่ท่องเที่ยว", lat=16.60, lng=103.20, hours_periods=None)

        def tour(order):
            pts = [HOTEL] + list(order) + [HOTEL]
            return sum(rs.calculate_distance(a, b) for a, b in zip(pts, pts[1:]))

        route = rs.order_day_stops([far, near, mid], HOTEL, self.DAY, time(9, 0), time(20, 0), "standard")
        assert len(route) == 3
        best = min(tour(order) for order in itertools.permutations([near, mid, far]))
        assert tour(route) == pytest.approx(best)

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

    def test_must_go_place_gets_priority_over_cheaper_optional_place(self):
        # A 1-hour window only has room for one 45-min-visit flexible stop
        # once travel is included. "Optional" sits right next to the hotel
        # (near-zero travel cost) and would win a plain cheapest-insertion
        # race every time -- "MustGo" is a few km out but still
        # individually feasible in the window, and is the one the user
        # actually asked for via must_go_ids.
        optional = make_place(id="optional", name="Optional", category="คาเฟ่", lat=16.4401, lng=102.8401, hours_periods=None)
        must_go = make_place(id="mustgo", name="MustGo", category="คาเฟ่", lat=16.455, lng=102.855, hours_periods=None)
        route = rs.order_day_stops(
            [optional, must_go], HOTEL, self.DAY, time(9, 0), time(10, 0), "standard",
            must_go_ids={"mustgo"},
        )
        assert [p.id for p in route] == ["mustgo"]

    def test_without_must_go_ids_the_cheaper_place_wins_instead(self):
        # Same fixture as above but no must_go_ids -- confirms the outcome
        # flip is really the priority tier, not something else about the
        # window/fixture.
        optional = make_place(id="optional", name="Optional", category="คาเฟ่", lat=16.4401, lng=102.8401, hours_periods=None)
        must_go = make_place(id="mustgo", name="MustGo", category="คาเฟ่", lat=16.455, lng=102.855, hours_periods=None)
        route = rs.order_day_stops(
            [optional, must_go], HOTEL, self.DAY, time(9, 0), time(10, 0), "standard",
        )
        assert [p.id for p in route] == ["optional"]

    def test_must_go_anchor_survives_a_conflicting_optional_anchor(self):
        # Both are real anchors (narrow same-day windows): "optional" opens
        # 06:00-07:00 right next to the hotel, "mustgo" opens 06:15-06:45
        # ~9km away. Visiting optional first (120-min "ตลาด" visit) then
        # traveling to mustgo arrives at 8:18 -- long after mustgo's 06:45
        # close, so the two anchors genuinely conflict; only one can be
        # scheduled. must_go_ids must decide that conflict in mustgo's
        # favor, not "whichever opens earlier in the day" (the old
        # single-pass anchor sort's tie-break, which knew nothing about
        # must_go_ids at all).
        optional = make_place(
            id="optional", name="OptionalMarket", category="ตลาด", lat=16.441, lng=102.841,
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 0}, "close": {"day": 1, "hour": 7, "minute": 0}}],
        )
        must_go = make_place(
            id="mustgo", name="MustGoMarket", category="ตลาด", lat=16.50, lng=102.90,
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 15}, "close": {"day": 1, "hour": 6, "minute": 45}}],
        )
        route = rs.order_day_stops(
            [optional, must_go], HOTEL, self.DAY, time(6, 0), time(20, 0), "standard",
            must_go_ids={"mustgo"},
        )
        assert [p.id for p in route] == ["mustgo"]

    def test_without_must_go_ids_the_earlier_anchor_wins_the_conflict_instead(self):
        # Same fixture as above but no must_go_ids -- confirms the flip is
        # really the priority tier and not something else about the
        # coordinates/windows: without it, the anchor that simply opens
        # earlier (optional, 06:00) wins and bumps the other one out.
        optional = make_place(
            id="optional", name="OptionalMarket", category="ตลาด", lat=16.441, lng=102.841,
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 0}, "close": {"day": 1, "hour": 7, "minute": 0}}],
        )
        must_go = make_place(
            id="mustgo", name="MustGoMarket", category="ตลาด", lat=16.50, lng=102.90,
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 15}, "close": {"day": 1, "hour": 6, "minute": 45}}],
        )
        route = rs.order_day_stops(
            [optional, must_go], HOTEL, self.DAY, time(6, 0), time(20, 0), "standard",
        )
        assert [p.id for p in route] == ["optional"]

    # --- restaurants are the second priority tier (after must-go) ---------

    def test_restaurant_gets_priority_over_cheaper_optional_place(self):
        # 90-minute window: room for ONE of the two (60-min attraction right
        # next to the hotel, or the 60-min restaurant a few km out), not both.
        # The attraction is a "สถานที่ท่องเที่ยว" on purpose: its preferred
        # window (08:00-15:00) covers the 09:00 arrival, so it carries no
        # time-of-day penalty and wins plain cheapest-insertion on distance
        # alone -- a cafe here would be penalized (13:00-17:00 window) and
        # lose for an unrelated reason, making the test prove nothing.
        # Without a priority tier the day's only meal is dropped -- confirmed
        # on real c04 (packed pace) runs, where an evening-only restaurant
        # lost to attractions in 35% of days.
        near = make_place(id="near", name="NearSight", category="สถานที่ท่องเที่ยว", lat=16.4401, lng=102.8401, hours_periods=None)
        restaurant = make_place(id="meal", name="Restaurant", category="ร้านอาหาร", lat=16.46, lng=102.86, hours_periods=None)
        route = rs.order_day_stops([near, restaurant], HOTEL, self.DAY, time(9, 0), time(10, 30), "standard")
        assert [p.id for p in route] == ["meal"]

    def test_same_fixture_with_a_non_restaurant_far_place_still_loses_to_the_cheaper_one(self):
        # Control for the test above: swap the far place's category to an
        # attraction and the cheaper stop wins again -- so the flip is the
        # meal tier, not the coordinates or the window.
        near = make_place(id="near", name="NearSight", category="สถานที่ท่องเที่ยว", lat=16.4401, lng=102.8401, hours_periods=None)
        far = make_place(id="far", name="FarSight", category="สถานที่ท่องเที่ยว", lat=16.46, lng=102.86, hours_periods=None)
        route = rs.order_day_stops([near, far], HOTEL, self.DAY, time(9, 0), time(10, 30), "standard")
        assert [p.id for p in route] == ["near"]

    def test_must_go_still_beats_a_restaurant_when_only_one_fits(self):
        must_go = make_place(id="mustgo", name="MustGo", category="คาเฟ่", lat=16.46, lng=102.86, hours_periods=None)
        restaurant = make_place(id="meal", name="Restaurant", category="ร้านอาหาร", lat=16.47, lng=102.87, hours_periods=None)
        route = rs.order_day_stops(
            [restaurant, must_go], HOTEL, self.DAY, time(9, 0), time(10, 30), "standard",
            must_go_ids={"mustgo"},
        )
        assert [p.id for p in route] == ["mustgo"]

    def test_restaurant_anchor_survives_a_conflicting_optional_anchor(self):
        # Same geometry as the must-go anchor conflict above: the near market
        # (06:00-07:00, 120-min visit) and the far place (06:15-06:45) can't
        # both be scheduled. A restaurant in the far slot must win the
        # conflict even though it opens later.
        market = make_place(
            id="market", name="NearMarket", category="ตลาด", lat=16.441, lng=102.841,
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 0}, "close": {"day": 1, "hour": 7, "minute": 0}}],
        )
        restaurant = make_place(
            id="meal", name="EarlyRestaurant", category="ร้านอาหาร", lat=16.50, lng=102.90,
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 15}, "close": {"day": 1, "hour": 6, "minute": 45}}],
        )
        route = rs.order_day_stops([market, restaurant], HOTEL, self.DAY, time(6, 0), time(20, 0), "standard")
        assert [p.id for p in route] == ["meal"]


class TestEndOfDayVisitTruncation:
    """The day's last stop may be visited for less than its normal duration
    when the full visit + the trip back to the hotel overruns the day's end by
    a little -- instead of being dropped. Real case: an evening market (open
    16:00-21:00, 120-min visit) in a 09:00-18:00 day needs 18:05 to be back
    at the hotel, so it was dropped on every run, must-go or not."""
    DAY = date(2026, 7, 27)  # Monday (Google day 1)

    @staticmethod
    def evening_market(open_hour=16, open_minute=0, **overrides):
        return make_place(
            id="market", name="EveningMarket", category="ตลาด", lat=16.441, lng=102.841,
            hours_periods=[{"open": {"day": 1, "hour": open_hour, "minute": open_minute},
                            "close": {"day": 1, "hour": 21, "minute": 0}}],
            **overrides,
        )

    def test_fit_helper_keeps_normal_duration_when_it_fits(self):
        start = datetime(2026, 7, 27, 14, 0)
        assert rs._fit_last_stop_visit(self.evening_market(), "standard", start, 5, datetime(2026, 7, 27, 18, 0)) == 120

    def test_fit_helper_shortens_a_small_overrun(self):
        start = datetime(2026, 7, 27, 16, 0)  # 120 min -> 18:00, + 5 min back = 18:05
        assert rs._fit_last_stop_visit(self.evening_market(), "standard", start, 5, datetime(2026, 7, 27, 18, 0)) == 115

    def test_fit_helper_refuses_a_cut_below_the_floor(self):
        # 85 min available < 75% of 120 (= 90): not worth a token visit.
        start = datetime(2026, 7, 27, 16, 30)
        assert rs._fit_last_stop_visit(self.evening_market(), "standard", start, 5, datetime(2026, 7, 27, 18, 0)) is None

    def test_fit_helper_never_goes_below_30_minutes(self):
        # nominal 45 -> 75% = 34 min, floor stays at max(30, 34); 20 min available -> None
        cafe = make_place(id="c", name="Cafe", category="คาเฟ่", hours_periods=None)
        start = datetime(2026, 7, 27, 17, 30)
        assert rs._fit_last_stop_visit(cafe, "standard", start, 10, datetime(2026, 7, 27, 18, 0)) is None

    def test_barely_overrunning_last_stop_is_kept_by_the_ordering(self):
        route = rs.order_day_stops([self.evening_market()], HOTEL, self.DAY, time(9, 0), time(18, 0), "standard")
        assert [p.id for p in route] == ["market"]

    def test_stop_needing_too_big_a_cut_is_still_dropped(self):
        route = rs.order_day_stops([self.evening_market(16, 30)], HOTEL, self.DAY, time(9, 0), time(18, 0), "standard")
        assert route == []

    def test_materialized_schedule_ends_by_the_day_end_and_shows_the_shorter_visit(self):
        market = self.evening_market()
        route = rs.order_day_stops([market], HOTEL, self.DAY, time(9, 0), time(18, 0), "standard")
        schedule, _, _ = rs.materialize_day_schedule(
            route, set(), {}, HOTEL, self.DAY, time(9, 0), time(18, 0), "standard",
        )
        stop = next(s for s in schedule if s.place.id == "market")
        assert stop.arrival_time == "16:00"
        assert stop.departure_time == "17:55"      # 115 min, not 120
        assert schedule[-1].arrival_time <= "18:00"  # back at the hotel by the day's end

    def test_a_stop_that_is_not_last_keeps_its_normal_duration(self):
        first = make_place(id="a", name="A", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
        second = make_place(id="b", name="B", category="สถานที่ท่องเที่ยว", lat=16.442, lng=102.842, hours_periods=None)
        # "packed": no longer stays (see TestStretchStays), so durations are the nominal ones.
        schedule, _, _ = rs.materialize_day_schedule(
            [first, second], set(), {}, HOTEL, self.DAY, time(9, 0), time(18, 0), "packed",
        )
        durations = {
            s.place.id: (datetime.strptime(s.departure_time, "%H:%M") - datetime.strptime(s.arrival_time, "%H:%M")).seconds // 60
            for s in schedule if s.place.id in ("a", "b")
        }
        assert durations == {"a": 60, "b": 60}


class TestMealAvailability:
    """meal_probe_minutes/open_for_meal: can a restaurant actually be eaten at
    inside the trip's daily window? Real case: a 09:00-18:00 trip whose
    reserved restaurants all opened at 17:00 or later."""
    DAY = date(2026, 7, 27)  # Monday
    START, END = 9 * 60, 18 * 60

    @staticmethod
    def restaurant(open_h, close_h=23, **overrides):
        periods = [
            {"open": {"day": d, "hour": open_h, "minute": 0}, "close": {"day": d, "hour": close_h, "minute": 59}}
            for d in range(7)
        ]
        return make_place(id="r", name="R", category="ร้านอาหาร", hours_periods=periods, **overrides)

    def test_probe_minutes_stop_early_enough_for_a_meal_and_the_drive_back(self):
        probes = rs.meal_probe_minutes(self.START, self.END)
        assert probes[0] == self.START
        # last arrival leaves MEAL_MIN_OPEN_MINUTES + MEAL_RETURN_BUFFER_MINUTES before the end
        assert probes[-1] <= self.END - rs.MEAL_MIN_OPEN_MINUTES - rs.MEAL_RETURN_BUFFER_MINUTES

    def test_probe_minutes_narrowed_to_the_lunch_window(self):
        probes = rs.meal_probe_minutes(self.START, self.END, rs.MEAL_LUNCH_WINDOW)
        assert min(probes) >= rs.MEAL_LUNCH_WINDOW[0] and max(probes) <= rs.MEAL_LUNCH_WINDOW[1]

    def test_probe_minutes_empty_when_the_trip_window_misses_the_window(self):
        assert rs.meal_probe_minutes(15 * 60, 20 * 60, rs.MEAL_LUNCH_WINDOW) == []

    def test_restaurant_open_at_lunch_is_usable(self):
        assert rs.open_for_meal(self.restaurant(11), [self.DAY], self.START, self.END)

    def test_restaurant_opening_after_the_day_ends_is_not_usable(self):
        assert not rs.open_for_meal(self.restaurant(18), [self.DAY], self.START, self.END)

    def test_evening_restaurant_is_not_lunch_capable_but_is_usable_if_it_opens_in_time(self):
        evening = self.restaurant(17)  # 09:00-18:00 day: a 17:00 arrival still fits
        assert rs.open_for_meal(evening, [self.DAY], self.START, self.END)
        assert not rs.open_for_meal(evening, [self.DAY], self.START, self.END, rs.MEAL_LUNCH_WINDOW)

    def test_lunch_capable_restaurant(self):
        assert rs.open_for_meal(self.restaurant(11), [self.DAY], self.START, self.END, rs.MEAL_LUNCH_WINDOW)

    def test_no_hours_data_counts_as_open(self):
        assert rs.open_for_meal(make_place(id="r", category="ร้านอาหาร", hours_periods=None), [self.DAY], self.START, self.END)

    def test_closed_all_of_the_trips_days_is_not_usable(self):
        # open only on Tuesday (Google day 2); the trip is a single Monday
        tuesday_only = make_place(
            id="r", category="ร้านอาหาร",
            hours_periods=[{"open": {"day": 2, "hour": 9, "minute": 0}, "close": {"day": 2, "hour": 22, "minute": 0}}],
        )
        assert not rs.open_for_meal(tuesday_only, [self.DAY], self.START, self.END)
        assert rs.open_for_meal(tuesday_only, [self.DAY, self.DAY + timedelta(days=1)], self.START, self.END)

    def test_permanently_closed_business_is_not_usable(self):
        assert not rs.open_for_meal(self.restaurant(11, business_status="CLOSED_PERMANENTLY"), [self.DAY], self.START, self.END)


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

    def test_no_gap_filler_pool_falls_back_to_free_time_block(self):
        # Baseline (no pool given): a long wait before a "dinner"-tagged
        # spot still gets the old placeholder block, unchanged behavior.
        dinner = make_place(id="dinner", name="DinnerPlace", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        schedule, _, _ = rs.materialize_day_schedule(
            [dinner], set(), {"dinner": "dinner"}, HOTEL, self.DAY, time(14, 0), time(21, 0), "standard",
        )
        assert any(s.status == "Free Time" for s in schedule)

    def test_gap_filler_pool_inserts_real_place_instead_of_free_time(self):
        # A ~3.5h wait before dinner (14:00 -> 17:30 MEAL_DINNER_WINDOW)
        # with a nearby open cafe in the pool should visit the cafe rather
        # than leave/shrink a "free time" placeholder for no reason.
        dinner = make_place(id="dinner", name="DinnerPlace", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        cafe = make_place(id="cafe1", name="CozyCafe", category="คาเฟ่", lat=16.441, lng=102.841, hours_periods=None)
        pool = [cafe]
        schedule, _, _ = rs.materialize_day_schedule(
            [dinner], set(), {"dinner": "dinner"}, HOTEL, self.DAY, time(14, 0), time(21, 0), "standard",
            gap_filler_pool=pool,
        )
        assert any(s.place.id == "cafe1" for s in schedule)
        assert pool == []  # consumed, so it can't be double-booked elsewhere

    def test_gap_filler_chains_multiple_stops_to_close_a_long_gap(self):
        # With enough nearby candidates, a long gap should be closed by
        # chaining several real stops rather than stopping after one and
        # leaving the rest as "free time".
        dinner = make_place(id="dinner", name="DinnerPlace", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        cafe = make_place(id="cafe1", name="CozyCafe", category="คาเฟ่", lat=16.441, lng=102.841, hours_periods=None)
        park = make_place(id="park1", name="RiverPark", category="สวนสาธารณะ", lat=16.442, lng=102.842, hours_periods=None)
        museum = make_place(id="mus1", name="LocalMuseum", category="พิพิธภัณฑ์", lat=16.443, lng=102.843, hours_periods=None)
        pool = [cafe, park, museum]
        schedule, _, _ = rs.materialize_day_schedule(
            [dinner], set(), {"dinner": "dinner"}, HOTEL, self.DAY, time(14, 0), time(21, 0), "standard",
            gap_filler_pool=pool,
        )
        visited_ids = {s.place.id for s in schedule}
        assert {"cafe1", "park1", "mus1"}.issubset(visited_ids)
        assert not any(s.status == "Free Time" for s in schedule)
        assert pool == []

    def test_gap_filler_never_evicts_or_duplicates_pool_items_across_days(self):
        # Same shared-pool convention as backfill_underfilled_*: an item
        # consumed for one day's gap must not still be sitting in the pool
        # for a second call (e.g. day 2) to pick up too.
        dinner = make_place(id="dinner", name="DinnerPlace", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        cafe = make_place(id="cafe1", name="CozyCafe", category="คาเฟ่", lat=16.441, lng=102.841, hours_periods=None)
        pool = [cafe]
        rs.materialize_day_schedule(
            [dinner], set(), {"dinner": "dinner"}, HOTEL, self.DAY, time(14, 0), time(21, 0), "standard",
            gap_filler_pool=pool,
        )
        schedule_day2, _, _ = rs.materialize_day_schedule(
            [dinner], set(), {"dinner": "dinner"}, HOTEL, self.DAY, time(14, 0), time(21, 0), "standard",
            gap_filler_pool=pool,
        )
        assert not any(s.place.id == "cafe1" for s in schedule_day2)


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

    def test_drops_business_closed_place_even_with_no_hours_data(self):
        # Regression: the old "if not place.hours_periods: continue" guard
        # used to skip this place entirely (hours_periods=None), so a
        # permanently-closed place with no scraped hours would never get
        # dropped here.
        p = make_place(id="p1", name="DefunctPlace", hours_periods=None, business_status="CLOSED_PERMANENTLY")
        result = rs.reassign_infeasible_days({1: [p], 2: []}, self.START, 2)
        assert result[1] == []
        assert result[2] == []

    def test_24_7_place_is_never_dropped_even_with_no_sunday_in_the_trip(self):
        # Regression: START is a Monday and this 2-day trip never touches a
        # Sunday -- before the 24/7-sentinel fix, check_is_open would report
        # "Closed Today" on both days (day-filter only matches the
        # sentinel's day=0 on an actual Sunday) and this must-go place would
        # get dropped as "closed every day of the trip".
        always_open = make_place(id="p1", name="AlwaysOpenPark", hours_periods=[
            {"open": {"day": 0, "hour": 0, "minute": 0}},
        ])
        result = rs.reassign_infeasible_days({1: [always_open], 2: []}, self.START, 2)
        assert [pl.id for pl in result[1]] == ["p1"]
        assert result[2] == []


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


class TestFillerTrustTiers:
    """Auto-added stops prefer places that meet the review/rating bar, and
    only fall back to thinly-reviewed ones when no trusted place fits."""

    def test_bar_values(self):
        assert rs.MIN_FILLER_RATING == 3.5 and rs.MIN_FILLER_REVIEWS == 20

    @pytest.mark.parametrize("rating,reviews,expected", [
        (4.5, 20, True), (4.5, 19, False), (3.5, 50, True), (3.4, 50, False),
        (4.6, None, True), (None, 50, True), (0.0, 0, True),
    ])
    def test_is_trustworthy_filler(self, rating, reviews, expected):
        p = make_place(category="สถานที่ท่องเที่ยว", rating=rating, review_count=reviews)
        assert rs.is_trustworthy_filler(p) is expected

    def test_tiers_drop_empty_and_order_trusted_first(self):
        good = make_place(id="g", category="สถานที่ท่องเที่ยว", review_count=50)
        thin = make_place(id="t", category="สถานที่ท่องเที่ยว", review_count=3)
        assert rs._filler_tiers([thin, good]) == [[good], [thin]]
        assert rs._filler_tiers([thin]) == [[thin]]
        assert rs._filler_tiers([]) == []

    def _gap_args(self):
        here = make_place(id="here", lat=16.44, lng=102.84)
        nxt = make_place(id="next", category="ร้านอาหาร", lat=16.45, lng=102.85)
        return here, nxt, datetime(2026, 10, 10, 13, 0)

    def test_gap_filler_prefers_trusted_even_when_farther(self):
        here, nxt, now = self._gap_args()
        thin_near = make_place(id="thin", category="สถานที่ท่องเที่ยว", lat=16.4405, lng=102.8405, review_count=5)
        good_far = make_place(id="good", category="สถานที่ท่องเที่ยว", lat=16.447, lng=102.847, review_count=80)
        found = rs._find_gap_filler([thin_near, good_far], here, nxt, now, 240, "standard", [])
        assert found["place"].id == "good"

    def test_gap_filler_falls_back_to_thin_when_nothing_else_fits(self):
        here, nxt, now = self._gap_args()
        thin = make_place(id="thin", category="สถานที่ท่องเที่ยว", lat=16.4405, lng=102.8405, review_count=5)
        found = rs._find_gap_filler([thin], here, nxt, now, 240, "standard", [])
        assert found["place"].id == "thin"

    def test_backfill_prefers_trusted_then_falls_back(self):
        anchor = make_place(id="a", category="สถานที่ท่องเที่ยว", lat=16.443, lng=102.842, review_count=100)
        thin = make_place(id="thin", category="สถานที่ท่องเที่ยว", lat=16.4431, lng=102.8421, review_count=2)
        good = make_place(id="good", category="สถานที่ท่องเที่ยว", lat=16.452, lng=102.851, review_count=90)
        args = (HOTEL, date(2026, 10, 10), datetime(2026, 10, 10, 9, 0), datetime(2026, 10, 10, 18, 0), "standard", {})
        place, _ = rs._find_best_backfill_insertion([anchor], *args, [thin, good])
        assert place.id == "good"
        place, _ = rs._find_best_backfill_insertion([anchor], *args, [thin])
        assert place.id == "thin"


REAL_HOTEL = make_place(id="mantra", name="Mantra Varee Hotel", category="ที่พัก", lat=16.4237592, lng=102.8396864)


class TestRouteCostCountsReturnLeg:
    """The last stop is driven home from, so its distance to the hotel is
    part of the route's cost (real trip: a restaurant 0.1 km from the hotel
    was used at lunch while an evening-only one 6.7 km away closed the day)."""
    DAY = date(2026, 7, 27)  # Monday
    START = datetime(2026, 7, 27, 9, 0)
    END = datetime(2026, 7, 27, 21, 0)

    def _cost(self, route):
        return rs._route_cost(route, REAL_HOTEL, self.DAY, self.START, self.END, "standard", {})

    def test_return_leg_is_part_of_cost(self):
        stop = make_place(id="s", name="S", category="สถานที่ท่องเที่ยว", lat=16.4799, lng=102.8164, hours_periods=None)
        expected = 2 * rs.calculate_distance(REAL_HOTEL, stop) * rs.DISTANCE_WEIGHT
        assert self._cost([stop]) == pytest.approx(expected, rel=1e-6)

    def test_nearer_final_stop_is_cheaper(self):
        halong = make_place(id="h", name="Halong", category="ร้านอาหาร", lat=16.4232748, lng=102.8404648, hours_periods=None)
        labkoi = make_place(id="l", name="Labkoi", category="ร้านอาหาร", lat=16.4798926, lng=102.8163842, hours_periods=None)
        assert self._cost([halong]) < self._cost([labkoi])

    def test_order_ends_next_to_the_hotel(self):
        # The morning anchor fixes the first stop, so the other two are an
        # open path, not a closed tour: B (beside the hotel) then C (far
        # north) costs less on the way out but ends 15 km from the hotel.
        # Counting the way home, C then B wins.
        anchor = make_place(
            id="a", name="A", category="สถานที่ท่องเที่ยว", lat=16.48, lng=102.84,
            hours_periods=[{"open": {"day": 1, "hour": 8, "minute": 30}, "close": {"day": 1, "hour": 10, "minute": 30}}],
        )
        near_hotel = make_place(id="b", name="B", category="สถานที่ท่องเที่ยว", lat=16.442, lng=102.841, hours_periods=None)
        far_north = make_place(id="c", name="C", category="สถานที่ท่องเที่ยว", lat=16.58, lng=102.84, hours_periods=None)
        route = rs.order_day_stops([anchor, near_hotel, far_north], HOTEL, self.DAY, time(9, 0), time(20, 0), "standard")
        assert [p.id for p in route] == ["a", "c", "b"]


class TestMaterializeTailTrim:
    """materialize_day_schedule re-checks the day's end after waits and
    placeholder blocks were added (order_day_stops' walk can't see them):
    shorten the last stop, else drop it, never past a must-go or the only
    meal."""
    DAY = date(2026, 7, 27)  # Monday

    def _run(self, route, end, roles=None, must_go=None, pool=None):
        return rs.materialize_day_schedule(
            route, set(), roles or {}, REAL_HOTEL, self.DAY, time(9, 0), end, "standard",
            gap_filler_pool=pool, must_go_ids=must_go,
        )

    @staticmethod
    def _minutes(hhmm):
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)

    def _far_pair(self, far_category="สถานที่ท่องเที่ยว"):
        near = make_place(id="near", name="Near", category="สถานที่ท่องเที่ยว", lat=16.45, lng=102.84, hours_periods=None)
        far = make_place(id="far", name="Far", category=far_category, lat=17.30, lng=102.84, hours_periods=None)
        return near, far

    def test_last_stop_dropped_when_even_shortening_cannot_fit(self):
        near, far = self._far_pair()
        schedule, cost, travel = self._run([near, far], time(12, 0))
        names = [s.place.name for s in schedule]
        assert names == ["Near", "Mantra Varee Hotel"]
        assert self._minutes(schedule[-1].arrival_time) <= 12 * 60
        assert travel == sum(s.travel_time_min for s in schedule)

    def test_must_go_last_stop_is_kept_and_day_runs_over(self):
        near, far = self._far_pair()
        schedule, _, _ = self._run([near, far], time(12, 0), must_go={"far"})
        assert [s.place.name for s in schedule][:2] == ["Near", "Far"]
        assert self._minutes(schedule[-1].arrival_time) > 12 * 60

    def test_only_restaurant_of_the_day_is_kept(self):
        near, far = self._far_pair(far_category="ร้านอาหาร")
        schedule, _, _ = self._run([near, far], time(12, 0))
        assert "Far" in [s.place.name for s in schedule]

    def test_restaurant_dropped_when_the_day_has_another_meal(self):
        near, far = self._far_pair(far_category="ร้านอาหาร")
        near_meal = make_place(id="nm", name="NearMeal", category="ร้านอาหาร", lat=16.43, lng=102.84, hours_periods=None)
        schedule, _, _ = self._run([near_meal, near, far], time(13, 0))
        names = [s.place.name for s in schedule]
        assert "NearMeal" in names and "Far" not in names

    def test_trailing_free_time_block_goes_with_the_dropped_stop(self):
        lunch = make_place(id="r0", name="Lunch", category="ร้านอาหาร", lat=16.43, lng=102.84, hours_periods=None)
        sight = make_place(id="a", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.45, lng=102.84, hours_periods=None)
        dinner = make_place(id="r1", name="Dinner", category="ร้านอาหาร", lat=16.43, lng=102.84, hours_periods=None)
        roles = {"r0": "lunch", "r1": "dinner"}
        # dinner would be seated at 17:30 and the day ends 18:00: it is cut,
        # and so is the placeholder that only existed to wait for it.
        schedule, _, _ = self._run([lunch, sight, dinner], time(18, 0), roles=roles)
        names = [s.place.name for s in schedule]
        assert "Dinner" not in names
        assert names[-2] == "Sight" and schedule[-1].status.startswith("End of Day")
        assert self._minutes(schedule[-1].arrival_time) <= 18 * 60

    def _meal_day(self):
        lunch = make_place(id="r0", name="Lunch", category="ร้านอาหาร", lat=16.43, lng=102.84, hours_periods=None)
        sight = make_place(id="a", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.45, lng=102.84, hours_periods=None)
        dinner = make_place(id="r1", name="Dinner", category="ร้านอาหาร", lat=16.43, lng=102.84, hours_periods=None)
        cafe = make_place(id="c", name="Cafe", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        return [lunch, sight, dinner, cafe], {"r0": "lunch", "r1": "dinner"}

    def test_stop_ordered_after_an_overrunning_dinner_still_gets_its_turn(self):
        # Real trip: the cafe was skipped because the dinner before it ended
        # at 18:30, then the dinner itself was cut -- both gone, home at 13:05.
        route, roles = self._meal_day()
        schedule, _, travel = self._run(route, time(18, 0), roles=roles)
        names = [s.place.name for s in schedule if s.status != "Free Time"]
        assert names == ["Lunch", "Sight", "Cafe", "Mantra Varee Hotel"]
        assert self._minutes(schedule[-1].arrival_time) <= 18 * 60
        assert travel == sum(s.travel_time_min for s in schedule)

    def test_dropped_out_param_reports_the_cut_stop_with_a_reason(self):
        route, roles = self._meal_day()
        dropped = []
        rs.materialize_day_schedule(
            route, set(), roles, REAL_HOTEL, self.DAY, time(9, 0), time(18, 0), "standard", dropped=dropped,
        )
        assert [(p.id, reason) for p, reason in dropped] == [("r1", "the day would end after 18:00")]

    def test_stops_left_unvisited_behind_a_kept_overrun_are_reported(self):
        near, far = self._far_pair()
        cafe = make_place(id="c", name="Cafe", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        dropped = []
        schedule, _, _ = rs.materialize_day_schedule(
            [near, far, cafe], set(), {}, REAL_HOTEL, self.DAY, time(9, 0), time(12, 0), "standard",
            must_go_ids={"far"}, dropped=dropped,
        )
        assert "Cafe" not in [s.place.name for s in schedule]
        assert [(p.id, reason) for p, reason in dropped] == [("c", "no time left before 12:00")]

    def test_stop_closed_when_reached_is_reported(self):
        early_bird = make_place(
            id="m", name="Morning Market", category="ตลาด", lat=16.43, lng=102.84,
            hours_periods=[{"open": {"day": 1, "hour": 6, "minute": 0}, "close": {"day": 1, "hour": 8, "minute": 0}}],
        )
        dropped = []
        rs.materialize_day_schedule(
            [early_bird], set(), {}, REAL_HOTEL, self.DAY, time(9, 0), time(18, 0), "standard", dropped=dropped,
        )
        assert [p.id for p, _ in dropped] == ["m"]
        assert dropped[0][1].startswith("closed when reached")


class TestPlanningWalkHonoursMealRoles:
    """_simulate_day_walk (ordering, backfill) must wait for a lunch/dinner
    meal_role exactly as materialize_day_schedule does. Real 09:00-18:00
    trip: a "dinner" pick was planned at 15:00 when it opened, so the
    afternoon looked full; the real schedule then held it to 17:30, cut it,
    and the day went home at 13:05."""
    DAY = date(2026, 7, 27)  # Monday

    @staticmethod
    def _restaurant(place_id, name):
        return make_place(id=place_id, name=name, category="ร้านอาหาร", lat=16.43, lng=102.84, hours_periods=None)

    def _walk(self, route, end, roles=None):
        return rs._simulate_day_walk(
            route, REAL_HOTEL, self.DAY, datetime.combine(self.DAY, time(9, 0)),
            datetime.combine(self.DAY, end), "standard", roles,
        )

    @pytest.mark.parametrize("role,start,end,expected", [
        ("dinner", time(9, 0), time(18, 0), False),   # the real trip: 17:30 + a meal overruns 18:00
        ("dinner", time(9, 0), time(19, 0), True),
        ("lunch", time(9, 0), time(18, 0), True),
        ("lunch", time(14, 0), time(20, 0), False),
        ("brunch", time(9, 0), time(18, 0), True),    # unknown role: nothing holds it to a window
    ])
    def test_meal_role_fits_window(self, role, start, end, expected):
        assert rs.meal_role_fits_window(role, start, end) is expected

    def test_dinner_role_is_held_to_its_window(self):
        dinner = self._restaurant("r1", "Dinner")
        held = self._walk([dinner], time(20, 0), {"r1": "dinner"})
        assert held[0]["start_activity_dt"].strftime("%H:%M") == "17:30"
        # No role: seated on arrival, as before.
        assert self._walk([dinner], time(20, 0))[0]["start_activity_dt"].hour == 9

    def test_dinner_that_cannot_fit_does_not_survive_the_planning_walk(self):
        lunch, dinner = self._restaurant("r0", "Lunch"), self._restaurant("r1", "Dinner")
        stops = self._walk([lunch, dinner], time(18, 0), {"r0": "lunch", "r1": "dinner"})
        assert [s["place"].id for s in stops] == ["r0"]

    def test_ordering_drops_the_unfittable_dinner_instead_of_planning_around_it(self):
        lunch, dinner = self._restaurant("r0", "Lunch"), self._restaurant("r1", "Dinner")
        sight = make_place(id="a", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.45, lng=102.84, hours_periods=None)
        route = rs.order_day_stops(
            [lunch, sight, dinner], REAL_HOTEL, self.DAY, time(9, 0), time(18, 0), "standard",
            {"r0": "lunch", "r1": "dinner"},
        )
        assert sorted(p.id for p in route) == ["a", "r0"]

    def test_planning_walk_and_real_schedule_agree_on_seating_times(self):
        lunch, dinner = self._restaurant("r0", "Lunch"), self._restaurant("r1", "Dinner")
        sight = make_place(id="a", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.45, lng=102.84, hours_periods=None)
        route, roles = [lunch, sight, dinner], {"r0": "lunch", "r1": "dinner"}
        planned = {s["place"].id: s["start_activity_dt"].strftime("%H:%M") for s in self._walk(route, time(20, 0), roles)}
        schedule, _, _ = rs.materialize_day_schedule(
            route, set(), roles, REAL_HOTEL, self.DAY, time(9, 0), time(20, 0), "standard",
        )
        seated = {
            s.place.id: (datetime.strptime(s.arrival_time, "%H:%M") + timedelta(minutes=s.wait_time_min)).strftime("%H:%M")
            for s in schedule if s.place.id in planned
        }
        # The sight between the two is left out: a longer lunch moves it (TestStretchStays).
        meals = lambda times: {k: v for k, v in times.items() if k != "a"}
        assert meals(planned) == meals(seated) == {"r0": "11:00", "r1": "17:30"}


class TestMarketTiming:
    """Markets have a time of day: a fresh market in the early morning, a
    night market from about 17:00. The scheduler used to know neither (its
    "ตลาดกลางคืน" name check matched no real market), so replays had a night
    market at 12:15 and a fresh market at 12:16."""
    DAY = date(2026, 7, 27)  # Monday
    START, END = datetime(2026, 7, 27, 9, 0), datetime(2026, 7, 27, 20, 0)

    @staticmethod
    def market(name, open_h=None, close_h=None, **overrides):
        periods = None
        if open_h is not None:
            periods = [
                {"open": {"day": d, "hour": open_h, "minute": 0}, "close": {"day": d, "hour": close_h, "minute": 0}}
                for d in range(7)
            ]
        defaults = dict(id="mk", name=name, category="ตลาด", lat=16.45, lng=102.84, hours_periods=periods)
        defaults.update(overrides)
        return make_place(**defaults)

    @staticmethod
    def dinner():
        return make_place(id="r1", name="Dinner", category="ร้านอาหาร", lat=16.425, lng=102.84, hours_periods=None)

    @staticmethod
    def sight(**overrides):
        defaults = dict(id="a", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.47, lng=102.84, hours_periods=None)
        defaults.update(overrides)
        return make_place(**defaults)

    @staticmethod
    def _stay(slot):
        return (datetime.strptime(slot.departure_time, "%H:%M") - datetime.strptime(slot.arrival_time, "%H:%M")).seconds // 60 - slot.wait_time_min

    @pytest.mark.parametrize("name,open_h,close_h,expected", [
        ("ตลาดต้นตาล", 16, 23, "evening"),           # hours: never open before mid-afternoon
        ("ตลาดหนองไผ่ศิลา", 14, 21, "evening"),
        ("ตลาดหน้าโรงพยาบาล", 5, 10, "morning"),     # hours: always shut by early afternoon
        ("ตลาดโต้รุ่งร่วมจิตร", 6, 21, "evening"),   # all-day hours listed: the name decides
        ("ตลาดสดเทศบาล1", 5, 17, "morning"),
        ("ตลาดสดยามเย็น", 17, 22, "evening"),        # hours beat the name
        ("ตลาดจอมพล", 6, 22, None),                  # open all day, nothing in the name
        ("ตลาดโรงอวน", None, None, None),            # no hours data, nothing in the name
        ("กังสดาลไนท์", None, None, "evening"),
    ])
    def test_market_kind(self, name, open_h, close_h, expected):
        assert rs.market_kind(self.market(name, open_h, close_h)) == expected

    def test_market_open_past_midnight_is_an_evening_market(self):
        overnight = [{"open": {"day": d, "hour": 17, "minute": 0}, "close": {"day": (d + 1) % 7, "hour": 2, "minute": 0}} for d in range(7)]
        assert rs.market_kind(self.market("ตลาดรื่นรมย์", hours_periods=overnight)) == "evening"

    def test_open_24h_sentinel_leaves_the_decision_to_the_name(self):
        always = [{"open": {"day": 0, "hour": 0, "minute": 0}}]
        assert rs.market_kind(self.market("ตลาดบางลำภู", hours_periods=always)) is None
        assert rs.market_kind(self.market("ตลาดโต้รุ่ง", hours_periods=always)) == "evening"

    def test_only_markets_have_a_kind(self):
        assert rs.market_kind(make_place(category="คาเฟ่", name="ไนท์คาเฟ่")) is None

    def test_durations(self):
        evening, morning, unknown = self.market("ตลาดต้นตาล", 16, 23), self.market("ตลาดสดเทศบาล1", 5, 17), self.market("ตลาดจอมพล", 6, 22)
        assert rs.get_visit_duration(morning, "standard") == rs.MORNING_MARKET_MINUTES
        assert rs.get_visit_duration(evening, "standard") == 120                      # the market is the evening
        assert rs.get_visit_duration(evening, "standard", day_has_dinner=True) == rs.MARKET_AFTER_DINNER_MINUTES
        assert rs.get_visit_duration(unknown, "standard", day_has_dinner=True) == 120

    def test_dinner_first_then_a_short_walk_through_the_market(self):
        # Geography alone says market first: sight (north) -> market -> dinner
        # (by the hotel) is a straight run home, dinner-then-market doubles back.
        market, dinner, sight = self.market("ตลาดโต้รุ่ง"), self.dinner(), self.sight()
        roles = {"r1": "dinner"}
        route = rs.order_day_stops([market, sight, dinner], REAL_HOTEL, self.DAY, time(9, 0), time(20, 0), "standard", roles)
        assert [p.id for p in route] == ["a", "r1", "mk"]
        schedule, _, _ = rs.materialize_day_schedule(
            route, set(), roles, REAL_HOTEL, self.DAY, time(9, 0), time(20, 0), "standard",
        )
        market_slot = next(s for s in schedule if s.place.id == "mk")
        assert market_slot.arrival_time > "18:30"
        assert self._stay(market_slot) == rs.MARKET_AFTER_DINNER_MINUTES
        assert schedule[-1].arrival_time <= "20:00"

    def test_market_goes_before_dinner_rather_than_being_dropped(self):
        # Day ends 19:00: dinner 17:30-18:30 leaves no room for the market after it.
        market, dinner = self.market("ตลาดโต้รุ่ง"), self.dinner()
        route = rs.order_day_stops([market, dinner], REAL_HOTEL, self.DAY, time(9, 0), time(19, 0), "standard", {"r1": "dinner"})
        assert [p.id for p in route] == ["mk", "r1"]

    def test_evening_market_without_a_dinner_keeps_its_full_visit(self):
        market, sight = self.market("ตลาดต้นตาล", 16, 23), self.sight()
        schedule, _, _ = rs.materialize_day_schedule(
            [sight, market], set(), {}, REAL_HOTEL, self.DAY, time(9, 0), time(20, 0), "standard",
        )
        assert self._stay(next(s for s in schedule if s.place.id == "mk")) >= 120

    def test_fresh_market_is_visited_first_and_night_market_last(self):
        # The night market is the stop nearest the hotel and the fresh market
        # the farthest: distance alone orders them the other way round.
        night = self.market("ตลาดโต้รุ่งร่วมจิตร", 6, 21, id="night", lat=16.426, lng=102.84)
        fresh = self.market("ตลาดสดเทศบาล1", 5, 17, id="fresh", lat=16.46, lng=102.84)
        sight = self.sight(lat=16.44)
        route = rs.order_day_stops([night, sight, fresh], REAL_HOTEL, self.DAY, time(9, 0), time(20, 0), "standard")
        assert [p.id for p in route] == ["fresh", "a", "night"]

    def test_auto_add_time_ok(self):
        evening, morning, unknown = self.market("ตลาดต้นตาล", 16, 23), self.market("ตลาดสดเทศบาล1", 5, 17), self.market("ตลาดจอมพล", 6, 22)
        at = lambda h, m=0: datetime(2026, 7, 27, h, m)
        assert rs.auto_add_time_ok(evening, at(17, 30)) and not rs.auto_add_time_ok(evening, at(16, 0))
        assert rs.auto_add_time_ok(morning, at(9, 10)) and not rs.auto_add_time_ok(morning, at(12, 16))
        assert not rs.auto_add_time_ok(unknown, at(17, 30))          # can't tell when people go: never auto-added
        assert rs.auto_add_time_ok(self.sight(), at(13, 0))          # only markets are restricted

    def test_gap_filler_only_uses_a_market_at_its_hour(self):
        night = self.market("ตลาดโต้รุ่งร่วมจิตร", 6, 21)   # listed as open all day
        here, nxt = self.sight(), self.dinner()
        find = lambda pool, hour: rs._find_gap_filler(pool, here, nxt, datetime(2026, 7, 27, hour, 0), 200, "standard", [])
        assert find([night], 13) is None
        assert find([night], 17)["place"].id == "mk"
        assert find([self.market("ตลาดจอมพล", 6, 22)], 17) is None

    def test_backfill_never_adds_a_market_at_the_wrong_hour(self):
        sight = self.sight()
        insert = lambda pool: rs._find_best_backfill_insertion([sight], REAL_HOTEL, self.DAY, self.START, self.END, "standard", {}, pool)
        assert insert([self.market("ตลาดจอมพล", 6, 22)]) == (None, None)             # kind unknown
        place, pos = insert([self.market("ตลาดสดเทศบาล1", 5, 17)])                   # only as the day's first stop
        assert (place.id, pos) == ("mk", 0)
        place, pos = insert([self.market("ตลาดโต้รุ่งร่วมจิตร", 6, 21)])              # held to 17:00, so it may go in
        assert (place.id, pos) == ("mk", 1)

    def test_market_is_never_auto_added_ahead_of_the_days_dinner(self):
        night, here, dinner = self.market("ตลาดต้นตาล", 16, 23), self.sight(), self.dinner()
        at_17 = datetime(2026, 7, 27, 17, 0)
        assert rs._find_gap_filler([night], here, dinner, at_17, 200, "standard", [], dinner_ahead=True) is None
        # Backfill: the only slot it may take is the one after dinner.
        place, pos = rs._find_best_backfill_insertion(
            [here, dinner], REAL_HOTEL, self.DAY, self.START, self.END, "standard", {"r1": "dinner"}, [night],
        )
        assert (place.id, pos) == ("mk", 2)

    def test_restaurant_that_only_opens_in_the_evening_counts_as_the_dinner(self):
        # A lone restaurant gets no meal_role; one opening at 18:00 is the dinner all the same.
        late = make_place(
            id="r9", name="Late Kitchen", category="ร้านอาหาร", lat=16.425, lng=102.84,
            hours_periods=[{"open": {"day": d, "hour": 18, "minute": 0}, "close": {"day": d, "hour": 23, "minute": 0}} for d in range(7)],
        )
        all_day = make_place(id="r8", name="All Day Kitchen", category="ร้านอาหาร", hours_periods=None)
        assert rs._day_has_dinner([late], {}) and not rs._day_has_dinner([all_day], {})
        route = rs.order_day_stops([self.market("ตลาดโต้รุ่ง"), self.sight(), late], REAL_HOTEL, self.DAY, time(9, 0), time(20, 0), "standard")
        assert [p.id for p in route] == ["a", "r9", "mk"]

    def _market_start(self, market, end):
        stops = rs._simulate_day_walk(
            [self.sight(), market], REAL_HOTEL, self.DAY, self.START, datetime.combine(self.DAY, end), "standard",
        )
        return next(s for s in stops if s["place"].id == "mk")["start_activity_dt"].strftime("%H:%M")

    def test_night_market_listed_as_open_all_day_is_still_held_to_the_evening(self):
        # Nothing else to do after the one sight: it used to be walked at ~10:15.
        assert self._market_start(self.market("ตลาดโต้รุ่งร่วมจิตร", 6, 21), time(20, 0)) == "17:00"

    def test_the_17_00_floor_gives_way_when_the_day_ends_early(self):
        # 09:00-18:00: 120 min + the drive back only fit from 15:5x, so it is
        # not held to 17:00 and lost (the real must-go case in
        # TestEndOfDayVisitTruncation), and a 16:00 opening still decides.
        assert self._market_start(self.market("ตลาดโต้รุ่งร่วมจิตร", 6, 21), time(18, 0)) < "16:00"
        assert self._market_start(self.market("ตลาดต้นตาล", 16, 23), time(18, 0)) == "16:00"

    def test_admin_label_wins_over_hours_and_name(self):
        # places.market_time: "ตลาดสด..." open all day, but labelled an evening market.
        assert rs.market_kind(self.market("ตลาดสดเทศบาล1", 5, 17, market_time="evening")) == "evening"
        assert rs.market_kind(self.market("ตลาดต้นตาล", 16, 23, market_time="bogus")) == "evening"   # unknown label: ignored

    def test_all_day_label_has_no_window_but_may_be_auto_added(self):
        food_court = self.market("ตลาดตองแปด", 8, 20, market_time="all_day")
        assert rs.preferred_time_window(food_court) is None
        assert rs.auto_add_time_ok(food_court, datetime(2026, 7, 27, 13, 0))
        assert rs.get_visit_duration(food_court, "standard") == 120


class TestSparePlaces:
    """Spare places (Place.is_spare) only fill dead time on trips whose
    interests can't: last in line, at most two a day and one per half of it,
    outdoors only for a morning or late-afternoon walk. Real case: a
    "อาหารพื้นถิ่น + คาเฟ่" city trip, 09:00-20:00, with 284 idle minutes."""
    DAY = date(2026, 7, 27)  # Monday
    START, END = datetime(2026, 7, 27, 9, 0), datetime(2026, 7, 27, 20, 0)

    @staticmethod
    def park(place_id, lat=16.43, **overrides):
        defaults = dict(id=place_id, name=place_id, category="สวนสาธารณะ", lat=lat, lng=102.84, hours_periods=None, is_spare=True)
        defaults.update(overrides)
        return make_place(**defaults)

    @staticmethod
    def sight(place_id="a", lat=16.45):
        return make_place(id=place_id, name=place_id, category="สถานที่ท่องเที่ยว", lat=lat, lng=102.84, hours_periods=None)

    def _insert(self, route, pool, roles=None):
        return rs._find_best_backfill_insertion(route, REAL_HOTEL, self.DAY, self.START, self.END, "standard", roles or {}, pool)

    def test_spares_are_the_last_tier(self):
        own, thin, spare = self.sight("own"), make_place(id="thin", rating=3.0, review_count=5), self.park("spare")
        assert [[p.id for p in tier] for tier in rs._filler_tiers([spare, thin, own])] == [["own"], ["thin"], ["spare"]]

    def test_interest_candidate_is_used_before_a_nearer_spare(self):
        far_own, near_spare = self.sight("own", lat=16.50), self.park("spare", lat=16.425)
        place, _ = self._insert([self.sight()], [near_spare, far_own])
        assert place.id == "own"

    def test_outdoor_spare_only_for_a_morning_or_late_afternoon_walk(self):
        spare, at = self.park("p"), lambda h, m=0: datetime(2026, 7, 27, h, m)
        assert rs.auto_add_time_ok(spare, at(9, 30)) and rs.auto_add_time_ok(spare, at(16, 30))
        assert not rs.auto_add_time_ok(spare, at(13, 0)) and not rs.auto_add_time_ok(spare, at(19, 0))
        assert rs.auto_add_time_ok(self.park("mine", is_spare=False), at(13, 0))   # an interest match: unrestricted

    def test_no_more_than_two_spares_a_day(self):
        day = [self.park("p1"), self.park("p2"), self.sight()]
        assert not rs._category_cap_ok(day, self.park("p3"))
        assert rs._category_cap_ok(day, self.sight("another"))
        assert rs._category_cap_ok(day[1:], self.park("p3"))

    def test_one_spare_per_half_of_the_day(self):
        at = lambda h: datetime(2026, 7, 27, h, 0)
        assert not rs._spare_half_free(self.park("p"), at(10), [at(9)])
        assert rs._spare_half_free(self.park("p"), at(17), [at(9)])
        assert rs._spare_half_free(self.sight(), at(10), [at(9)])           # not a spare: no such limit

    def test_second_spare_is_not_added_to_the_same_morning(self):
        first, second = self.park("p1"), self.park("p2", lat=16.435)
        place, pos = self._insert([self.sight()], [first, second])
        assert place.is_spare and pos == 0
        route = [place, self.sight()]
        assert self._insert(route, [p for p in (first, second) if p.id != place.id]) == (None, None)

    def test_polish_does_not_move_a_spare_to_midday(self):
        # Two cafes back to back cost a penalty that parking the spare between
        # them would save -- which is how it ended up walked at 13:57.
        lunch = make_place(id="r0", name="Lunch", category="ร้านอาหาร", lat=16.43, lng=102.84, hours_periods=None)
        cafes = [make_place(id=f"c{i}", name=f"C{i}", category="คาเฟ่", lat=16.43 + i * 0.002, lng=102.84, hours_periods=None) for i in (1, 2)]
        spare = self.park("p")
        route = [spare, lunch, *cafes]
        polish = lambda added: rs._or_opt_polish(
            route, set(), REAL_HOTEL, self.DAY, self.START, self.END, "standard", {"r0": "lunch"}, auto_added_ids=added,
        )
        assert [p.id for p in polish(None)] != [p.id for p in route]      # free to move: it does
        assert [p.id for p in polish({"p"})][0] == "p"                    # an auto-added spare keeps its morning

    def test_gap_filler_respects_the_half_day_rule(self):
        spare, here, nxt = self.park("p"), self.sight(), self.sight("b", lat=16.44)
        find = lambda taken: rs._find_gap_filler([spare], here, nxt, datetime(2026, 7, 27, 9, 0), 120, "standard", [], spare_starts=taken)
        assert find([])["place"].id == "p"
        assert find([datetime(2026, 7, 27, 9, 30)]) is None


class TestDinnerFillTarget:
    """Dinner is seated from 17:30 whatever time the day ends (a 09:00-20:00
    day was home by 18:36). Fillers may now run up to the latest start that
    still ends the day on time -- but dinner never waits for it."""
    DAY = date(2026, 7, 27)  # Monday

    @staticmethod
    def dinner(**overrides):
        defaults = dict(id="r1", name="Dinner", category="ร้านอาหาร", lat=16.425, lng=102.84, hours_periods=None)
        defaults.update(overrides)
        return make_place(**defaults)

    def _until(self, end, place=None, later=(), roles=None):
        return rs._dinner_fill_until(
            place or self.dinner(), {"r1": "dinner"} if roles is None else roles, list(later),
            datetime.combine(self.DAY, end), REAL_HOTEL, "standard", True,
        )

    def test_target_follows_the_days_end(self):
        # 20:00 - 60 min meal - 5 min drive - 20 min filler slack
        assert self._until(time(20, 0)) == 18 * 60 + 35
        assert self._until(time(22, 0)) == rs.DINNER_LATEST_START
        assert self._until(time(18, 30)) is None            # no later than the normal 17:30: nothing to extend

    def test_room_is_kept_for_the_market_walk_after_dinner(self):
        market = make_place(id="mk", name="ตลาดโต้รุ่ง", category="ตลาด", hours_periods=None)
        assert self._until(time(20, 0), later=[market]) == 18 * 60 + 35 - rs.MARKET_AFTER_DINNER_MINUTES - rs.AFTER_DINNER_HOP_MINUTES

    def test_no_target_for_a_non_dinner_or_a_restaurant_that_closes_too_early(self):
        assert self._until(time(20, 0), roles={}) is None
        closes_at_19 = self.dinner(hours_periods=[
            {"open": {"day": d, "hour": 11, "minute": 0}, "close": {"day": d, "hour": 19, "minute": 0}} for d in range(7)
        ])
        assert self._until(time(20, 0), place=closes_at_19) is None

    def _afternoon(self, pool):
        sight = make_place(id="a", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.45, lng=102.84, hours_periods=None)
        schedule, _, _ = rs.materialize_day_schedule(
            [sight, self.dinner()], set(), {"r1": "dinner"}, REAL_HOTEL, self.DAY, time(15, 0), time(20, 0), "standard",
            gap_filler_pool=pool,
        )
        return schedule

    @staticmethod
    def _fillers(second_is_spare):
        return [
            make_place(id="f1", name="F1", category="สถานที่ท่องเที่ยว", lat=16.44, lng=102.84, hours_periods=None),
            make_place(id="f2", name="F2", category="สวนสาธารณะ", lat=16.435, lng=102.84, hours_periods=None, is_spare=second_is_spare),
        ]

    def test_a_spare_carries_dinner_past_17_30(self):
        # f1 closes the real wait for 17:30; the spare then uses the longer evening.
        schedule = self._afternoon(self._fillers(second_is_spare=True))
        assert [s.place.id for s in schedule[:-1]] == ["a", "f1", "f2", "r1"]
        assert next(s for s in schedule if s.place.id == "r1").arrival_time > "18:00"
        assert schedule[-1].arrival_time <= "20:00"

    def test_the_longer_evening_is_not_spent_from_the_shared_pool(self):
        # Replays: day 1 took a park for a later dinner, and day 2, which had
        # used that park to close a real wait, got a 129-minute hole instead.
        pool = self._fillers(second_is_spare=False)
        schedule = self._afternoon(pool)
        assert [s.place.id for s in schedule[:-1]] == ["a", "f1", "r1"]
        assert [p.id for p in pool] == ["f2"]          # still there for another day

    def test_dinner_does_not_wait_when_nothing_fills_the_time(self):
        schedule = self._afternoon([])
        dinner = next(s for s in schedule if s.place.id == "r1")
        assert dinner.arrival_time == "17:30"


class TestStretchStays:
    """Idle time that fillers could not use goes into longer stays at the
    stops the day already has. Real 09:00-20:00 trip (cafes + local food in
    the city): 173 idle minutes before dinner while every stop kept its fixed
    45-60 minutes."""
    DAY = date(2026, 7, 27)  # Monday

    @staticmethod
    def place(place_id, category, **overrides):
        defaults = dict(id=place_id, name=place_id.upper(), category=category, lat=16.43, lng=102.84, hours_periods=None)
        defaults.update(overrides)
        return make_place(**defaults)

    def _meals_and_cafe(self, **cafe):
        return [self.place("r0", "ร้านอาหาร"), self.place("c1", "คาเฟ่", lat=16.431, **cafe), self.place("r1", "ร้านอาหาร", lat=16.432)]

    def _day(self, route, roles=None, start=time(9, 0), end=time(20, 0), pace="standard"):
        schedule, _, _ = rs.materialize_day_schedule(
            route, set(), {"r0": "lunch", "r1": "dinner"} if roles is None else roles,
            REAL_HOTEL, self.DAY, start, end, pace,
        )
        return {s.place.id: s for s in schedule}, schedule

    @staticmethod
    def _seated(slot):
        return (datetime.strptime(slot.arrival_time, "%H:%M") + timedelta(minutes=slot.wait_time_min)).strftime("%H:%M")

    def _stay(self, slot):
        return (datetime.strptime(slot.departure_time, "%H:%M") - datetime.strptime(self._seated(slot), "%H:%M")).seconds // 60

    def test_room_by_category_and_pace(self):
        cafe, wat = self.place("c1", "คาเฟ่"), self.place("w1", "วัด")
        assert [rs._stretch_room(cafe, pace) for pace in ("relaxed", "standard", "packed")] == [45, 30, 0]
        assert rs._stretch_room(wat, "relaxed") == 15
        assert rs._stretch_room(self.place("b1", "ร้านอาหาร", name="หมูกระทะ"), "relaxed") == 0   # already two hours
        market = self.place("mk", "ตลาด", name="ตลาดโต้รุ่ง")
        assert rs._stretch_room(market, "relaxed") == 30
        assert rs._stretch_room(market, "relaxed", day_has_dinner=True) == 0    # the short walk after dinner stays short

    def test_stops_before_a_wait_stay_longer_and_the_meal_keeps_its_time(self):
        by_id, schedule = self._day(self._meals_and_cafe())
        assert (self._stay(by_id["r0"]), self._stay(by_id["c1"])) == (80, 75)
        assert (self._seated(by_id["r0"]), self._seated(by_id["r1"])) == ("11:00", "17:30")
        # What is still idle before dinner starts when the cafe is left.
        free = next(s for s in schedule if s.status == "Free Time" and s.arrival_time > "12:00")
        assert free.arrival_time == by_id["c1"].departure_time
        # Dinner, the day's last stop, uses the time left before 20:00.
        assert self._stay(by_id["r1"]) == 80
        assert schedule[-1].arrival_time <= "20:00"

    def test_pace_decides_how_much(self):
        packed, _ = self._day(self._meals_and_cafe(), pace="packed")
        relaxed, _ = self._day(self._meals_and_cafe(), pace="relaxed")
        assert [self._stay(packed[i]) for i in ("r0", "c1", "r1")] == [60, 45, 60]
        assert [self._stay(relaxed[i]) for i in ("r0", "c1", "r1")] == [90, 90, 90]

    def test_never_past_closing_time(self):
        hours = [{"open": {"day": d, "hour": 8, "minute": 0}, "close": {"day": d, "hour": 13, "minute": 0}} for d in range(7)]
        by_id, _ = self._day(self._meals_and_cafe(hours_periods=hours))
        assert by_id["c1"].departure_time <= "13:00"
        assert self._stay(by_id["c1"]) >= 45

    def test_a_meal_is_never_pushed_later(self):
        # Replays: a day's only restaurant went from 15:38 to 16:33 behind
        # longer sightseeing stops. The sight before the meal may not grow;
        # the meal itself, with nothing behind it, may.
        sight, meal = self.place("a", "สถานที่ท่องเที่ยว"), self.place("r0", "ร้านอาหาร", lat=16.431)
        by_id, _ = self._day([sight, meal], roles={}, start=time(11, 0), end=time(18, 0))
        assert self._seated(by_id["r0"]) == "12:10"
        assert (self._stay(by_id["a"]), self._stay(by_id["r0"])) == (60, 80)

    def test_a_spare_walk_stays_inside_its_hours(self):
        sight = self.place("a", "สถานที่ท่องเที่ยว")
        park = self.place("p1", "สวนสาธารณะ", lat=16.431, is_spare=True)
        by_id, _ = self._day([sight, park], roles={}, pace="relaxed")
        assert by_id["p1"].arrival_time <= "10:30"       # SPARE_OUTDOOR_WINDOWS: a morning walk starts by then
        assert self._stay(by_id["a"]) > 60               # ...and the sight still got what fits before it

    def test_a_block_that_shrinks_becomes_an_ordinary_wait(self):
        sight, lunch = self.place("a", "สถานที่ท่องเที่ยว"), self.place("r0", "ร้านอาหาร", lat=16.431)
        packed, packed_schedule = self._day([sight, lunch], roles={"r0": "lunch"}, pace="packed")
        assert any(s.status == "Free Time" for s in packed_schedule)      # 50 idle minutes shown as a block
        by_id, schedule = self._day([sight, lunch], roles={"r0": "lunch"})
        assert not any(s.status == "Free Time" for s in schedule)
        assert (by_id["r0"].arrival_time, by_id["r0"].wait_time_min, by_id["r0"].status) == ("10:30", 30, "Waiting")
        assert self._seated(by_id["r0"]) == "11:00"

    def test_the_day_never_ends_later_than_asked(self):
        route = [self.place("r0", "ร้านอาหาร"), self.place("c1", "คาเฟ่", lat=16.431)]
        _, packed = self._day(route, roles={"r0": "lunch"}, end=time(13, 0), pace="packed")
        _, schedule = self._day(route, roles={"r0": "lunch"}, end=time(13, 0))
        assert (packed[-1].arrival_time, schedule[-1].arrival_time) == ("12:55", "13:00")
