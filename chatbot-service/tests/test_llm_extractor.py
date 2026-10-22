"""Unit tests for llm_extractor.py -- prompt construction, the LLM-output ->
real-itinerary pipeline (_build_itinerary_from_llm_days), and the judge
generate/regenerate loop. No network (mocks out _call_llm_for_itinerary);
the deterministic geographic ordering/time-window logic itself is tested in
test_route_scheduler.py, not re-derived here -- these tests only check that
llm_extractor correctly wires the LLM's day-assignment output into that
scheduler (parsing, dedup, day-reassignment, meal_role passthrough).
"""
import pytest

from src.services.trip_planner.llm_extractor import MAX_JUDGE_ATTEMPTS, LLMTripPlanner
from src.services.trip_planner.models import DailyItinerary, JudgeVerdict, Place, TimeSlot, TripInput


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


HOTEL = make_place(id="hotel", name="Hotel", category="ที่พัก", lat=16.44, lng=102.84)


class TestGeneratePrompt:
    def _prompt(self, planner, **overrides):
        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            **overrides,
        )
        return planner.generate_prompt(user_input, "PACE", "BUDGET")

    def test_does_not_ask_for_arrival_or_departure_time(self, planner):
        # The LLM only picks which places go on which day now -- ordering
        # and timing are entirely route_scheduler's job.
        prompt = self._prompt(planner)
        assert "arrival_time" not in prompt
        assert "departure_time" not in prompt

    def test_includes_district_but_not_coordinates(self, planner):
        candidate = make_place(id="c1", name="Candidate", district="เมืองขอนแก่น")
        p = LLMTripPlanner(candidates=[candidate])
        prompt = self._prompt(p)
        assert "District: เมืองขอนแก่น" in prompt
        assert "lat" not in prompt.lower()
        assert "lng" not in prompt.lower()

    def test_mentions_meal_role_and_uniqueness_rules(self, planner):
        prompt = self._prompt(planner)
        assert "meal_role" in prompt
        assert "AT MOST ONCE" in prompt

    def test_example_output_uses_places_schema(self, planner):
        prompt = self._prompt(planner)
        assert '"places"' in prompt


def force_passing_judge(planner):
    """Forces the judge to pass on the first round, so tests that only care
    about the day-assignment -> itinerary pipeline don't also have to model
    judge interaction."""
    planner.judge.evaluate = lambda user_input, itinerary, **_: JudgeVerdict(
        passed=True, score=1.0, pacing_ok=True, intent_match_ok=True, rationale="looks good",
    )


class TestBuildItineraryFromLLMDays:
    """solve_route_with_llm() trusts the LLM only for which places go on
    which day -- everything else (ordering, timing, opening-hours
    enforcement, dedup, day-of-week correction, return-to-hotel) is
    route_scheduler's job. These mock out _call_llm_for_itinerary() to feed
    a controlled day-assignment into the real pipeline."""

    def test_drops_a_place_thats_closed_every_day_of_the_trip(self):
        closed_place = make_place(
            id="closed1", name="ClosedPlace", category="คาเฟ่", lat=16.44, lng=102.84,
            hours_periods=[{"open": {"day": 0, "hour": 9, "minute": 0}, "close": {"day": 0, "hour": 18, "minute": 0}}],  # Sunday only
        )
        open_place = make_place(id="open1", name="OpenPlace", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[closed_place, open_place], start_point=HOTEL)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [{"day": 1, "places": [
            {"place_id": "closed1"}, {"place_id": "open1"},
        ]}]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",  # Monday
            start_time="09:00", end_time="18:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        names = [s.place.name for s in result[0].schedule]
        assert "ClosedPlace" not in names
        assert "OpenPlace" in names

    def test_place_closed_on_assigned_day_is_moved_to_a_day_its_open_on(self):
        # Reassignment happens automatically now regardless of which day the
        # LLM picked -- it's not a "hope the LLM got it right" backstop
        # anymore, the correct day is deterministically found.
        tuesday_only = make_place(
            id="p1", name="TuesdayOnly", category="คาเฟ่", lat=16.44, lng=102.84,
            hours_periods=[{"open": {"day": 2, "hour": 9, "minute": 0}, "close": {"day": 2, "hour": 18, "minute": 0}}],
        )
        planner = LLMTripPlanner(candidates=[tuesday_only], start_point=HOTEL)
        force_passing_judge(planner)
        # LLM (wrongly) assigns it to day 1 (Monday).
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "p1"}]},
            {"day": 2, "places": []},
        ]}

        user_input = TripInput(
            trip_duration_days=2, start_date="2026-08-03", accommodation_name="Hotel",  # Mon + Tue
            start_time="09:00", end_time="18:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")

        day1_names = [s.place.name for s in result[0].schedule]
        day2_names = [s.place.name for s in result[1].schedule]
        assert "TuesdayOnly" not in day1_names
        assert "TuesdayOnly" in day2_names
        assert result[0].date == "2026-08-03"
        assert result[1].date == "2026-08-04"

    def test_duplicate_place_id_across_days_is_only_scheduled_once(self):
        place = make_place(id="p1", name="Place1", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[place], start_point=HOTEL)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "p1"}]},
            {"day": 2, "places": [{"place_id": "p1"}]},  # LLM repeated it -- should be dropped here
        ]}

        user_input = TripInput(
            trip_duration_days=2, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="18:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        total_occurrences = sum(
            1 for day in result for s in day.schedule if s.place.id == "p1"
        )
        assert total_occurrences == 1

    def test_duplicate_place_id_within_same_day_is_only_scheduled_once(self):
        place = make_place(id="p1", name="Place1", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[place], start_point=HOTEL)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "p1"}, {"place_id": "p1"}]},
        ]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="18:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        total_occurrences = sum(1 for s in result[0].schedule if s.place.id == "p1")
        assert total_occurrences == 1

    def test_last_day_of_trip_still_returns_to_hotel(self):
        # Regression: the old single-pass implementation only added the
        # return-to-hotel leg when day_num < trip_duration_days.
        place = make_place(id="p1", name="Place1", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[place], start_point=HOTEL)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "p1"}]},
        ]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="18:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        assert result[0].schedule[-1].status == "End of Day (Return to Hotel)"

    def test_meal_role_is_forwarded_onto_the_resulting_slot(self):
        place = make_place(id="p1", name="Restaurant1", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[place], start_point=HOTEL)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "p1", "meal_role": "lunch"}]},
        ]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="18:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        slot = next(s for s in result[0].schedule if s.place.id == "p1")
        assert slot.meal_role == "lunch"

    def test_unknown_place_id_from_llm_is_ignored(self):
        place = make_place(id="p1", name="Place1", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[place], start_point=HOTEL)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "does-not-exist"}, {"place_id": "p1"}]},
        ]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="18:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        names = [s.place.name for s in result[0].schedule]
        assert "Place1" in names


class TestRestaurantCapAndRoles:
    """_enforce_restaurant_cap_and_roles: caps ร้านอาหาร at
    MAX_RESTAURANTS_PER_DAY per day (relocating excess to another day with
    room, dropping only if nowhere fits) and backfills lunch/dinner roles
    for any day left with exactly 2 restaurants and an incomplete pairing,
    regardless of whether the LLM ever set meal_role itself."""

    def test_third_restaurant_in_a_single_day_trip_is_dropped(self):
        r1 = make_place(id="r1", name="R1", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        r2 = make_place(id="r2", name="R2", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        r3 = make_place(id="r3", name="R3", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[r1, r2, r3], start_point=HOTEL)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "r1"}, {"place_id": "r2"}, {"place_id": "r3"}]},
        ]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="20:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        restaurant_ids = {s.place.id for s in result[0].schedule if s.place.category == "ร้านอาหาร"}
        assert len(restaurant_ids) == 2
        roles = {s.meal_role for s in result[0].schedule if s.place.id in restaurant_ids}
        assert roles == {"lunch", "dinner"}

    def test_third_restaurant_relocated_to_an_emptier_day_instead_of_dropped(self):
        r1 = make_place(id="r1", name="R1", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        r2 = make_place(id="r2", name="R2", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        r3 = make_place(id="r3", name="R3", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[r1, r2, r3], start_point=HOTEL)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "r1"}, {"place_id": "r2"}, {"place_id": "r3"}]},
            {"day": 2, "places": []},
        ]}

        user_input = TripInput(
            trip_duration_days=2, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="20:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        day1_ids = {s.place.id for s in result[0].schedule}
        day2_ids = {s.place.id for s in result[1].schedule}
        assert "r3" not in day1_ids
        assert "r3" in day2_ids  # relocated, not dropped -- day 2 had room

    def test_business_closed_restaurant_with_no_hours_data_is_not_relocated(self):
        # Regression: the relocation check used to be skipped entirely
        # whenever hours_periods was None, so a permanently-closed
        # restaurant with no scraped hours could get "relocated" to
        # another day instead of dropped.
        r1 = make_place(id="r1", name="R1", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        r2 = make_place(id="r2", name="R2", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        r3 = make_place(
            id="r3", name="Defunct", category="ร้านอาหาร", lat=16.44, lng=102.84,
            hours_periods=None, business_status="CLOSED_PERMANENTLY",
        )
        planner = LLMTripPlanner(candidates=[r1, r2, r3], start_point=HOTEL)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "r1"}, {"place_id": "r2"}, {"place_id": "r3"}]},
            {"day": 2, "places": []},
        ]}

        user_input = TripInput(
            trip_duration_days=2, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="20:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        all_ids = {s.place.id for day in result for s in day.schedule}
        assert "r3" not in all_ids

    def test_two_restaurants_without_llm_assigned_roles_still_get_lunch_and_dinner(self):
        r1 = make_place(id="r1", name="R1", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        r2 = make_place(id="r2", name="R2", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[r1, r2], start_point=HOTEL)
        force_passing_judge(planner)
        # LLM didn't set meal_role at all -- STRICT RULE 6 isn't always
        # obeyed, this is the deterministic backstop for that gap too.
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "r1"}, {"place_id": "r2"}]},
        ]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="20:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        roles = {s.place.id: s.meal_role for s in result[0].schedule if s.place.id in ("r1", "r2")}
        assert roles == {"r1": "lunch", "r2": "dinner"}


class TestUnfittableMealRole:
    """A "dinner" role on a day that ends 18:00 can never be seated (17:30 +
    a meal). Real trip, 2026-10-11 09:00-18:00, rebuilt here from the places'
    real coordinates and Sunday hours: the dinner pick was planned at 15:00,
    cut at the very end, and took the cafe ordered after it along -- three
    stops, home at 13:05."""

    @staticmethod
    def _sunday(open_h, open_m, close_h):
        return [{"open": {"day": 0, "hour": open_h, "minute": open_m}, "close": {"day": 0, "hour": close_h, "minute": 0}}]

    def _places(self):
        return [
            make_place(id="temple", name="Temple", category="วัด", lat=16.4616, lng=102.8224, hours_periods=None),
            make_place(id="noodle", name="Noodle", category="ร้านอาหาร", lat=16.4529, lng=102.8326,
                       hours_periods=self._sunday(8, 0, 17)),
            make_place(id="rin", name="Rin", category="คาเฟ่", lat=16.4572, lng=102.7975,
                       hours_periods=self._sunday(7, 30, 16)),
            make_place(id="ready", name="Ready", category="คาเฟ่", lat=16.4361, lng=102.8240,
                       hours_periods=self._sunday(8, 0, 17)),
            make_place(id="en", name="En", category="ร้านอาหาร", lat=16.4527, lng=102.8240,
                       hours_periods=self._sunday(15, 0, 23)),
        ]

    HOTEL = make_place(id="hotel", name="Hotel", category="ที่พัก", lat=16.4290, lng=102.8304)

    def _build(self, planner, picks, end_time="18:00"):
        user_input = TripInput(
            trip_duration_days=1, start_date="2026-10-11", accommodation_name="Hotel",  # Sunday
            trip_pace="standard", start_time="09:00", end_time=end_time,
        )
        return planner._build_itinerary_from_llm_days({"itinerary": [{"day": 1, "places": picks}]}, user_input)

    REAL_PICKS = [
        {"place_id": "temple"}, {"place_id": "noodle", "meal_role": "lunch"}, {"place_id": "rin"},
        {"place_id": "ready"}, {"place_id": "en", "meal_role": "dinner"},
    ]

    def test_dinner_that_cannot_fit_no_longer_takes_another_stop_down_with_it(self):
        planner = LLMTripPlanner(candidates=self._places(), start_point=self.HOTEL, must_go_ids={"temple"})
        itinerary, feedback = self._build(planner, self.REAL_PICKS)
        ids = [s.place.id for s in itinerary[0].schedule if s.status != "Free Time"]
        assert sorted(ids[:-1]) == ["noodle", "ready", "rin", "temple"]
        assert itinerary[0].schedule[-1].arrival_time > "13:05"
        # Not worth a regenerate round: it could only pick no dinner at all.
        assert feedback == ""

    def test_dinner_is_still_scheduled_when_the_day_runs_late_enough(self):
        planner = LLMTripPlanner(candidates=self._places(), start_point=self.HOTEL, must_go_ids={"temple"})
        itinerary, _ = self._build(planner, self.REAL_PICKS, end_time="20:00")
        en = next(s for s in itinerary[0].schedule if s.place.id == "en")
        assert en.meal_role == "dinner"

    def test_unfittable_dinner_gives_way_to_a_lunch_that_opens_at_noon(self):
        # The day (09:00-18:00) only holds lunch, and "en" opens at 15:00: it
        # used to stay as the day's only meal, eaten mid-afternoon.
        planner = LLMTripPlanner(candidates=self._places(), start_point=self.HOTEL)
        itinerary, _ = self._build(planner, [{"place_id": "temple"}, {"place_id": "en", "meal_role": "dinner"}])
        meals = {s.place.id: s.meal_role for s in itinerary[0].schedule if s.place.category == "ร้านอาหาร"}
        assert meals == {"noodle": "lunch"}
        from datetime import datetime as _dt, timedelta as _td
        noodle = next(s for s in itinerary[0].schedule if s.place.id == "noodle")
        seated = (_dt.strptime(noodle.arrival_time, "%H:%M") + _td(minutes=noodle.wait_time_min)).strftime("%H:%M")
        assert "11:30" <= seated <= "13:30"

    def test_only_restaurant_of_the_day_is_kept_when_nothing_serves_lunch(self):
        places = [p for p in self._places() if p.id != "noodle"]
        planner = LLMTripPlanner(candidates=places, start_point=self.HOTEL)
        itinerary, _ = self._build(planner, [{"place_id": "temple"}, {"place_id": "en", "meal_role": "dinner"}])
        en = next(s for s in itinerary[0].schedule if s.place.id == "en")
        assert en.meal_role is None
        assert en.arrival_time < "17:30"  # by its real opening hours (15:00), not the dinner window

    def test_must_go_restaurant_is_never_taken_off_the_day(self):
        planner = LLMTripPlanner(candidates=self._places(), start_point=self.HOTEL, must_go_ids={"en"})
        itinerary, _ = self._build(planner, [
            {"place_id": "noodle", "meal_role": "lunch"}, {"place_id": "en", "meal_role": "dinner"},
        ])
        ids = {s.place.id for s in itinerary[0].schedule}
        assert {"noodle", "en"} <= ids
        assert planner.last_dropped_must_go == []


class TestEveningMarketWithDinner:
    """Evening market + dinner restaurant on one day: sit down to dinner
    first, then a short walk through the market. No dinner restaurant: the
    market keeps its full visit and is where the evening is spent."""

    @staticmethod
    def _stay(slot):
        from datetime import datetime
        return (datetime.strptime(slot.departure_time, "%H:%M") - datetime.strptime(slot.arrival_time, "%H:%M")).seconds // 60 - slot.wait_time_min

    def _run(self, picks):
        places = [
            make_place(id="sight", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.47, lng=102.84, hours_periods=None),
            make_place(id="lunch", name="Lunch", category="ร้านอาหาร", lat=16.46, lng=102.84, hours_periods=None),
            make_place(id="dinner", name="Dinner", category="ร้านอาหาร", lat=16.445, lng=102.84, hours_periods=None),
            make_place(id="market", name="ตลาดโต้รุ่ง", category="ตลาด", lat=16.455, lng=102.84, hours_periods=None),
        ]
        planner = LLMTripPlanner(candidates=places, start_point=HOTEL)
        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            trip_pace="relaxed", start_time="09:00", end_time="20:00",
        )
        itinerary, _ = planner._build_itinerary_from_llm_days({"itinerary": [{"day": 1, "places": picks}]}, user_input)
        return [s for s in itinerary[0].schedule if s.status != "Free Time"]

    def test_dinner_then_a_short_market_walk(self):
        slots = self._run([
            {"place_id": "sight"}, {"place_id": "market"},
            {"place_id": "lunch", "meal_role": "lunch"}, {"place_id": "dinner", "meal_role": "dinner"},
        ])
        ids = [s.place.id for s in slots]
        assert ids.index("dinner") < ids.index("market")
        assert self._stay(next(s for s in slots if s.place.id == "market")) == 45
        assert slots[-1].arrival_time <= "20:00"

    def test_market_is_the_evening_when_there_is_no_dinner_restaurant(self):
        slots = self._run([{"place_id": "sight"}, {"place_id": "market"}, {"place_id": "lunch"}])
        market = next(s for s in slots if s.place.id == "market")
        assert self._stay(market) >= 120        # the full evening, not the 45-minute walk
        assert market.arrival_time >= "15:00"   # pulled towards the evening, not left mid-morning


class TestScheduleTimeDropsReachFeedback:
    """Picks that survive ordering but are cut while the real schedule is
    built used to leave only a log line, so the regenerate loop never heard
    of them."""

    def test_only_the_llms_own_picks_are_reported(self, monkeypatch):
        cafe = make_place(id="c1", name="PickedCafe", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        rest = make_place(id="r1", name="R1", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        extra = make_place(id="x1", name="BackfillOnly", category="วัด", lat=16.44, lng=102.84, hours_periods=None)
        from src.services.trip_planner import route_scheduler
        real = route_scheduler.materialize_day_schedule

        def cutting(*args, dropped=None, **kwargs):
            dropped.append((cafe, "the day would end after 18:00"))
            dropped.append((extra, "the day would end after 18:00"))
            return real(*args, **kwargs)

        monkeypatch.setattr(route_scheduler, "materialize_day_schedule", cutting)
        planner = LLMTripPlanner(candidates=[cafe, rest, extra], start_point=HOTEL)
        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="18:00",
        )
        _, feedback = planner._build_itinerary_from_llm_days(
            {"itinerary": [{"day": 1, "places": [{"place_id": "c1"}, {"place_id": "r1"}]}]}, user_input,
        )
        assert "PickedCafe" in feedback and "the day would end after 18:00" in feedback
        assert "BackfillOnly" not in feedback


class TestSolveRouteWithLLMJudgeRegeneration:
    def _planner_with_one_place(self):
        place = make_place(id="p1", name="Place1", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[place], start_point=HOTEL)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "p1"}]},
        ]}
        return planner

    def _user_input(self):
        return TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="18:00",
        )

    def test_judge_passes_first_try_calls_generation_once(self):
        planner = self._planner_with_one_place()
        calls = []
        original = planner._call_llm_for_itinerary
        planner._call_llm_for_itinerary = lambda prompt: (calls.append(prompt), original(prompt))[1]
        planner.judge.evaluate = lambda user_input, itinerary, **_: JudgeVerdict(
            passed=True, score=1.0, pacing_ok=True, intent_match_ok=True, rationale="ok",
        )

        result, rationale = planner.solve_route_with_llm(self._user_input(), "", "")
        assert len(calls) == 1
        assert rationale == "ok"

    def test_judge_fails_once_then_passes_threads_feedback_into_second_prompt(self):
        planner = self._planner_with_one_place()
        prompts = []
        original = planner._call_llm_for_itinerary
        planner._call_llm_for_itinerary = lambda prompt: (prompts.append(prompt), original(prompt))[1]

        verdicts = [
            JudgeVerdict(passed=False, score=0.2, major_issues=1,
                         issues=["[major] Day 1: too many cafes"], feedback="add a restaurant instead", rationale=""),
            JudgeVerdict(passed=True, score=0.9, rationale="fixed"),
        ]
        planner.judge.evaluate = lambda user_input, itinerary, **_: verdicts.pop(0)

        result, rationale = planner.solve_route_with_llm(self._user_input(), "", "")
        assert len(prompts) == 2
        assert "add a restaurant instead" not in prompts[0]
        assert "add a restaurant instead" in prompts[1]
        assert rationale == "fixed"

    def test_judge_fails_every_attempt_returns_the_best_round_without_raising(self):
        planner = self._planner_with_one_place()
        judged = []

        def judge(user_input, itinerary, **_):
            judged.append(itinerary)
            # Round 1 has 3 major issues, round 2 only 1: round 2 is the better one.
            majors = 3 if len(judged) == 1 else 1
            return JudgeVerdict(
                passed=False, score=0.1, major_issues=majors,
                issues=["[major] Trip: bad"], feedback="try harder", rationale=f"judge on round {len(judged)}",
            )
        planner.judge.evaluate = judge
        calls = []
        planner._call_llm_for_itinerary = lambda prompt: (calls.append(prompt), {
            "itinerary": [{"day": 1, "places": [{"place_id": "p1"}]}], "rationale": f"generator round {len(calls)}",
        })[1]

        result, rationale = planner.solve_route_with_llm(self._user_input(), "", "")
        assert len(calls) == MAX_JUDGE_ATTEMPTS
        assert len(judged) == MAX_JUDGE_ATTEMPTS   # every round is judged now
        assert result[0].schedule  # still a valid itinerary
        assert rationale == f"judge on round {MAX_JUDGE_ATTEMPTS}"

    def test_a_worse_regenerated_round_does_not_replace_the_first(self):
        planner = self._planner_with_one_place()
        verdicts = [
            JudgeVerdict(passed=False, score=0.6, major_issues=1, feedback="fix it", rationale="first"),
            JudgeVerdict(passed=False, score=0.4, major_issues=2, feedback="fix it", rationale="second"),
        ]
        planner.judge.evaluate = lambda user_input, itinerary, **_: verdicts.pop(0)
        _, rationale = planner.solve_route_with_llm(self._user_input(), "", "")
        assert rationale == "first"

    def _far_pick_planner(self, must_go_ids=None):
        near = make_place(id="p1", name="Near", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        # ~400 km away: can never fit a day, so the scheduler drops it.
        far = make_place(id="far", name="FarAway", category="วัด", lat=20.0, lng=100.0, hours_periods=None)
        planner = LLMTripPlanner(candidates=[near, far], start_point=HOTEL, must_go_ids=must_go_ids)
        calls = []
        planner._call_llm_for_itinerary = lambda prompt: (calls.append(prompt), {
            "itinerary": [{"day": 1, "places": [{"place_id": "p1"}, {"place_id": "far"}]}],
        })[1]
        seen = {}

        def judge(user_input, itinerary, unused=None, dropped=None):
            seen["dropped"] = [p.id for _, p in dropped or []]
            seen["unused"] = [p.id for p in unused or []]
            return JudgeVerdict(passed=True, score=0.9, rationale="ok")
        planner.judge.evaluate = judge
        return planner, calls, seen

    def test_an_optional_pick_that_did_not_fit_is_no_reason_to_regenerate(self):
        planner, calls, seen = self._far_pick_planner()
        planner.solve_route_with_llm(self._user_input(), "", "")
        assert len(calls) == 1
        # ...and the judge is told it didn't fit, not offered it as unused.
        assert seen["dropped"] == ["far"] and "far" not in seen["unused"]

    def test_a_must_go_that_did_not_fit_still_triggers_another_round(self):
        planner, calls, _ = self._far_pick_planner(must_go_ids={"far"})
        planner.solve_route_with_llm(self._user_input(), "", "")
        assert len(calls) == MAX_JUDGE_ATTEMPTS

    def test_the_judge_is_shown_the_candidates_left_unused(self):
        used = make_place(id="p1", name="Place1", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        # Closed, so backfill can't add it to the day either.
        spare = make_place(id="p2", name="Unpicked", category="วัด", lat=16.44, lng=102.84, hours_periods=None,
                           business_status="CLOSED_TEMPORARILY")
        planner = LLMTripPlanner(candidates=[used, spare], start_point=HOTEL)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [{"day": 1, "places": [{"place_id": "p1"}]}]}
        seen = {}

        def judge(user_input, itinerary, unused=None, **_):
            seen["unused"] = [p.id for p in unused or []]
            return JudgeVerdict(passed=True, score=0.9, rationale="ok")
        planner.judge.evaluate = judge
        planner.solve_route_with_llm(self._user_input(), "", "")
        assert "p2" in seen["unused"] and "p1" not in seen["unused"]

    def test_judge_rationale_wins_when_the_judge_ran(self):
        planner = self._planner_with_one_place()
        planner._call_llm_for_itinerary = lambda prompt: {
            "itinerary": [{"day": 1, "places": [{"place_id": "p1"}]}], "rationale": "from the generator",
        }
        planner.judge.evaluate = lambda user_input, itinerary, **_: JudgeVerdict(
            passed=True, score=0.9, pacing_ok=True, intent_match_ok=True, rationale="from the judge",
        )
        _, rationale = planner.solve_route_with_llm(self._user_input(), "", "")
        assert rationale == "from the judge"

    def test_generator_rationale_when_the_judge_wrote_none(self):
        planner = self._planner_with_one_place()
        planner._call_llm_for_itinerary = lambda prompt: {
            "itinerary": [{"day": 1, "places": [{"place_id": "p1"}]}], "rationale": "from the generator",
        }
        planner.judge.evaluate = lambda user_input, itinerary, **_: JudgeVerdict(
            passed=True, score=0.0, pacing_ok=True, intent_match_ok=True, rationale="", judge_call_failed=True,
        )
        _, rationale = planner.solve_route_with_llm(self._user_input(), "", "")
        assert rationale == "from the generator"

    def test_judge_call_failed_still_accepted_immediately_but_logged_distinctly(self, caplog):
        # judge_call_failed=True is judge.py's fail-open path (see judge.py's
        # evaluate()) -- it must still short-circuit the loop (no point
        # regenerating when the judge itself is broken, not the itinerary),
        # but should be visibly distinguishable from a genuine pass in logs,
        # since a metrics/experiment pipeline reading these logs would
        # otherwise silently count an unevaluated itinerary as "passed".
        planner = self._planner_with_one_place()
        calls = []
        original = planner._call_llm_for_itinerary
        planner._call_llm_for_itinerary = lambda prompt: (calls.append(prompt), original(prompt))[1]
        planner.judge.evaluate = lambda user_input, itinerary, **_: JudgeVerdict(
            passed=True, score=0.0, pacing_ok=True, intent_match_ok=True,
            rationale="", judge_call_failed=True,
        )

        import logging
        with caplog.at_level(logging.WARNING):
            result, rationale = planner.solve_route_with_llm(self._user_input(), "", "")

        assert len(calls) == 1
        assert any("fail-open" in r.message.lower() for r in caplog.records)

    def test_technical_generation_failure_propagates_and_judge_never_called(self):
        place = make_place(id="p1", name="Place1", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[place], start_point=HOTEL)

        def always_fail(prompt):
            raise ValueError("bad json")
        planner._call_llm_for_itinerary = always_fail

        def judge_should_not_be_called(user_input, itinerary, **_):
            raise AssertionError("judge.evaluate should never be called when generation fails technically")
        planner.judge.evaluate = judge_should_not_be_called

        with pytest.raises(ValueError):
            planner.solve_route_with_llm(self._user_input(), "", "")


class TestSlotSource:
    def test_each_stop_says_who_put_it_in_the_day(self):
        picked = make_place(id="c1", name="PickedCafe", category="คาเฟ่", lat=16.441, lng=102.841, hours_periods=None)
        unpicked = make_place(id="w1", name="UnpickedTemple", category="วัด", lat=16.442, lng=102.842, hours_periods=None)
        restaurant = make_place(id="r1", name="Restaurant", category="ร้านอาหาร", lat=16.443, lng=102.843, hours_periods=None)
        planner = LLMTripPlanner(candidates=[picked, unpicked, restaurant], start_point=HOTEL_PLACE)
        user_input = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel", trip_pace="packed")
        itinerary, _ = planner._build_itinerary_from_llm_days({"itinerary": [{"day": 1, "places": [{"place_id": "c1"}]}]}, user_input)
        sources = {s.place.id: s.source for s in itinerary[0].schedule}
        assert sources["c1"] == "llm"
        assert sources["r1"] == "meal"                         # brought in for lunch
        assert sources["w1"] in ("backfill", "gap_filler")     # the LLM never picked it
        hotel_leg = itinerary[0].schedule[-1]
        assert hotel_leg.source is None


class TestHoursForTrip:
    WEEK = "วันจันทร์: ปิดทำการ\nวันอังคาร: 7:00–21:00\nวันพุธ: 7:00–21:00\nวันพฤหัสบดี: 7:00–21:00\nวันศุกร์: 7:00–21:00\nวันเสาร์: 7:00–21:00\nวันอาทิตย์: 8:00–20:00"

    def test_keeps_only_the_trips_weekdays_on_one_line(self):
        from src.services.trip_planner.llm_extractor import hours_for_trip
        assert hours_for_trip(self.WEEK, {0, 6}) == "วันจันทร์: ปิดทำการ; วันอาทิตย์: 8:00–20:00"

    def test_other_formats_are_kept_whole(self):
        from src.services.trip_planner.llm_extractor import hours_for_trip
        assert hours_for_trip("ทุกวัน 8:30–0:00", {2}) == "ทุกวัน 8:30–0:00"
        assert hours_for_trip("Monday: 9 AM–5 PM\nTuesday: Closed", {0}) == "Monday: 9 AM–5 PM; Tuesday: Closed"
        assert hours_for_trip(None, {0}) == "unknown"

    def test_prompt_shows_only_trip_days(self):
        place = make_place(id="p1", name="Place1", category="คาเฟ่", hours=self.WEEK)
        planner = LLMTripPlanner(candidates=[place])
        # 2026-08-03 is a Monday; a one-day trip shouldn't list Sunday's hours.
        user_input = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel")
        prompt = planner.generate_prompt(user_input, "", "")
        assert "วันจันทร์: ปิดทำการ" in prompt
        assert "วันอาทิตย์" not in prompt

    def test_prompt_shows_each_places_visit_length(self):
        park = make_place(id="np", name="NationalPark", category="อุทยานแห่งชาติ")
        cafe = make_place(id="c1", name="Cafe", category="คาเฟ่")
        planner = LLMTripPlanner(candidates=[park, cafe])
        user_input = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel")
        prompt = planner.generate_prompt(user_input, "", "")
        assert "Name: NationalPark, Category: อุทยานแห่งชาติ" in prompt and "Visit: ~2h," in prompt
        assert "Visit: ~45m," in prompt


class TestMustGoProtection:
    """must_go_ids (see orchestrator.build_candidate_list /
    routes_tripplanner.py) marks which candidates came from the user's
    must_go list -- these tests check the resulting protection: the LLM
    skipping a must-go id entirely no longer means it's silently absent,
    order_day_stops' priority tier keeps it off the drop list when
    possible, the restaurant cap trims optional picks first, and a
    genuinely infeasible must-go place is still reported instead of
    vanishing."""

    def test_llm_omits_must_go_place_but_it_still_gets_injected_and_scheduled(self):
        must_go_place = make_place(id="mg1", name="MustGoPlace", category="คาเฟ่", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[must_go_place], start_point=HOTEL, must_go_ids={"mg1"})
        force_passing_judge(planner)
        # LLM ignores the must-go candidate entirely -- STRICT RULE 1 only
        # says derive from provided data, nothing forces inclusion.
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [{"day": 1, "places": []}]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="18:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        names = [s.place.name for s in result[0].schedule]
        assert "MustGoPlace" in names
        assert planner.last_dropped_must_go == []

    def test_must_go_place_genuinely_infeasible_is_reported_via_last_dropped_must_go(self):
        # Closed every day of a 1-day (Monday) trip -- injection + priority
        # can't rescue a real hard infeasibility, but it must not vanish
        # silently either.
        closed_must_go = make_place(
            id="mg1", name="ClosedMustGo", category="คาเฟ่", lat=16.44, lng=102.84,
            hours_periods=[{"open": {"day": 0, "hour": 9, "minute": 0}, "close": {"day": 0, "hour": 18, "minute": 0}}],  # Sunday only
        )
        planner = LLMTripPlanner(candidates=[closed_must_go], start_point=HOTEL, must_go_ids={"mg1"})
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [{"day": 1, "places": [{"place_id": "mg1"}]}]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",  # Monday
            start_time="09:00", end_time="18:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        names = [s.place.name for s in result[0].schedule]
        assert "ClosedMustGo" not in names
        assert [p.name for p in planner.last_dropped_must_go] == ["ClosedMustGo"]

    def test_must_go_restaurant_is_kept_over_optional_ones_at_the_cap(self):
        r_must = make_place(id="rmust", name="MustGoRestaurant", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        r1 = make_place(id="r1", name="R1", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        r2 = make_place(id="r2", name="R2", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[r_must, r1, r2], start_point=HOTEL, must_go_ids={"rmust"})
        force_passing_judge(planner)
        # Must-go restaurant listed LAST -- a plain "keep the first N, drop
        # the rest" policy would drop it by accident; this only passes if
        # priority (not list order) decides who gets trimmed.
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [
            {"day": 1, "places": [{"place_id": "r1"}, {"place_id": "r2"}, {"place_id": "rmust"}]},
        ]}

        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="20:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        restaurant_ids = {s.place.id for s in result[0].schedule if s.place.category == "ร้านอาหาร"}
        assert "rmust" in restaurant_ids
        assert len(restaurant_ids) == 2


class TestPaceAttractionRange:
    """trip_pace now sets a per-day attraction range scaled to the time
    window (route_scheduler.pace_stop_range): the max is enforced on the
    LLM's picks, the min is topped up from unused candidates, restaurants
    don't count and cafes do."""

    # Rotated so the per-category daily cap (3) never decides what fits.
    CATEGORIES = ("สถานที่ท่องเที่ยว", "วัด", "สวนสาธารณะ", "พิพิธภัณฑ์")

    def _wats(self, n, **overrides):
        # Tightly clustered so geography never decides what fits.
        return [
            make_place(
                id=f"w{i}", name=f"Wat{i}", category=self.CATEGORIES[i % len(self.CATEGORIES)], rating=3.0 + i * 0.1,
                lat=16.44 + i * 0.001, lng=102.84, hours_periods=None, **overrides,
            )
            for i in range(n)
        ]

    def test_one_category_is_capped_at_three_a_day(self):
        same = [
            make_place(id=f"p{i}", name=f"Park{i}", category="สวนสาธารณะ", lat=16.44 + i * 0.001, lng=102.84, hours_periods=None)
            for i in range(6)
        ]
        planner = LLMTripPlanner(candidates=same, start_point=HOTEL)
        stops = self._run(planner, [p.id for p in same], "packed")
        assert sum(1 for p in stops if p.category == "สวนสาธารณะ") == 3

    def _run(self, planner, llm_places, pace, start="09:00", end="18:00"):
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {
            "itinerary": [{"day": 1, "places": [{"place_id": pid} for pid in llm_places]}]
        }
        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time=start, end_time=end, trip_pace=pace,
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        return [s.place for s in result[0].schedule if s.place.category not in (None, "ที่พัก")]

    def test_relaxed_day_is_capped_even_if_llm_over_assigns(self):
        wats = self._wats(7)
        planner = LLMTripPlanner(candidates=wats, start_point=HOTEL)
        stops = self._run(planner, [w.id for w in wats], "relaxed")
        assert len([p for p in stops if p.category != "ร้านอาหาร"]) <= 4  # relaxed 09-18 -> 3-4

    def test_must_go_places_are_never_trimmed_by_the_cap(self):
        wats = self._wats(6)
        planner = LLMTripPlanner(candidates=wats, start_point=HOTEL, must_go_ids={"w0"})  # lowest rated
        stops = self._run(planner, [w.id for w in wats], "relaxed")
        assert "w0" in {p.id for p in stops}

    def test_packed_day_is_topped_up_to_its_minimum_from_unused_candidates(self):
        wats = self._wats(10)
        planner = LLMTripPlanner(candidates=wats, start_point=HOTEL)
        stops = self._run(planner, ["w9"], "packed")  # LLM under-selects: 1 pick
        assert len([p for p in stops if p.category != "ร้านอาหาร"]) >= 6  # packed 09-18 -> 6-7

    def test_floor_applies_even_when_no_idle_gap_is_large(self):
        # 3 stops leave under UNDERFILLED_GAP_MINUTES idle, so gap-based
        # backfill alone would stop -- only the pace floor adds more.
        wats = self._wats(10)
        planner = LLMTripPlanner(candidates=wats, start_point=HOTEL)
        stops = self._run(planner, ["w7", "w8", "w9"], "packed", "09:00", "15:00")
        assert len(stops) >= 3
        lo, _ = route_scheduler_range("packed", "09:00", "15:00")
        assert len(stops) >= lo

    def test_relaxed_day_is_not_padded_up_to_packed_levels(self):
        wats = self._wats(10)
        planner = LLMTripPlanner(candidates=wats, start_point=HOTEL)
        stops = self._run(planner, ["w9"], "relaxed")
        assert len([p for p in stops if p.category != "ร้านอาหาร"]) <= 4

    def test_narrow_window_gets_a_smaller_cap_than_a_wide_one(self):
        wats = self._wats(9)
        narrow = self._run(LLMTripPlanner(candidates=list(wats), start_point=HOTEL), [w.id for w in wats], "standard", "09:00", "13:00")
        wide = self._run(LLMTripPlanner(candidates=list(wats), start_point=HOTEL), [w.id for w in wats], "standard", "09:00", "21:00")
        assert len(narrow) < len(wide)

    def test_restaurants_do_not_use_up_the_attraction_cap(self):
        wats = self._wats(4)
        rest = make_place(id="r1", name="R1", category="ร้านอาหาร", lat=16.445, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=wats + [rest], start_point=HOTEL)
        stops = self._run(planner, [w.id for w in wats] + ["r1"], "relaxed")
        assert "r1" in {p.id for p in stops}
        assert len([p for p in stops if p.category != "ร้านอาหาร"]) == 4


def route_scheduler_range(pace, start, end):
    from datetime import datetime as _dt
    from src.services.trip_planner import route_scheduler as _rs
    return _rs.pace_stop_range(pace, _dt.strptime(start, "%H:%M").time(), _dt.strptime(end, "%H:%M").time())


HOTEL_PLACE = Place(id="hotel", name="Hotel", category="ที่พัก", lat=16.44, lng=102.84)


class TestGuaranteedRestaurantPerDay:
    """The zero-restaurant fallback tops up a day the LLM left without a
    "ร้านอาหาร"; the injected restaurant must survive order_day_stops'
    competition (priority), and _build_post_schedule_feedback catches it when
    even priority isn't enough."""

    def test_injected_restaurant_gets_priority_over_a_cheaper_optional_place(self):
        cheap = make_place(id="cheap", name="Cheap", category="สถานที่ท่องเที่ยว", lat=16.4401, lng=102.8401, hours_periods=None)
        restaurant = make_place(id="rest1", name="Restaurant1", category="ร้านอาหาร", lat=16.455, lng=102.855, hours_periods=None)
        planner = LLMTripPlanner(candidates=[cheap, restaurant], start_point=HOTEL_PLACE)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [{"day": 1, "places": [{"place_id": "cheap"}]}]}
        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="10:15", trip_pace="standard",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        assert "Restaurant1" in [s.place.name for s in result[0].schedule]

    def _one_restaurant_day(self, end_time):
        r1 = make_place(id="r1", name="R1", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        spare = make_place(id="spare", name="SpareRestaurant", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        planner = LLMTripPlanner(candidates=[r1, spare], start_point=HOTEL_PLACE)
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [{"day": 1, "places": [{"place_id": "r1"}]}]}
        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time=end_time,
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        return {s.place.name: s.meal_role for s in result[0].schedule if s.place.category == "ร้านอาหาร"}

    def test_a_day_out_of_town_eats_lunch_out_there_not_back_in_the_city(self):
        # Live 2026-10-21: a Phu Wiang day (~55 km out) had only an in-town
        # restaurant, eaten at 16:56 after driving back.
        sights = [
            make_place(id=f"dino{i}", name=f"Dino{i}", category="พิพิธภัณฑ์", lat=16.66 + i * 0.03, lng=102.37 - i * 0.03, hours_periods=None)
            for i in range(4)
        ]
        city = make_place(id="city", name="CityRestaurant", category="ร้านอาหาร", lat=16.44, lng=102.84, hours_periods=None)
        local = make_place(id="local", name="PhuWiangRestaurant", category="ร้านอาหาร", lat=16.70, lng=102.33, hours_periods=None)
        planner = LLMTripPlanner(candidates=sights + [city], start_point=HOTEL_PLACE, meal_pool=[local])
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [{"day": 1, "places": [
            *({"place_id": s.id} for s in sights), {"place_id": "city", "meal_role": "lunch"},
        ]}]}
        user_input = TripInput(
            trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time="18:00",
        )
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        meals = {s.place.name: s for s in result[0].schedule if s.place.category == "ร้านอาหาร"}
        assert {name: s.meal_role for name, s in meals.items()} == {"PhuWiangRestaurant": "lunch"}
        # ...and at lunchtime, not after the day's sights (live: 16:16).
        from datetime import datetime as _dt, timedelta as _td
        lunch = meals["PhuWiangRestaurant"]
        assert (_dt.strptime(lunch.arrival_time, "%H:%M") + _td(minutes=lunch.wait_time_min)).strftime("%H:%M") <= "13:30"

    def test_a_lunch_only_day_with_its_restaurant_is_left_alone(self):
        assert self._one_restaurant_day("18:00") == {"R1": "lunch"}

    def test_a_day_that_reaches_dinner_gets_a_dinner_too(self):
        assert self._one_restaurant_day("20:00") == {"R1": "lunch", "SpareRestaurant": "dinner"}


class TestPickFallbackRestaurant:
    """Which restaurant tops up a day the LLM left without one: open at a meal
    time in the day's window first, then at least visitable, then closest to
    the day's other places, then best rated. Used to be "first unused in
    candidate order", which handed a 09:00-18:00 day an evening-only place."""
    from datetime import date as _date, time as _time
    DAY = _date(2026, 8, 3)  # Monday

    @staticmethod
    def rest(place_id, open_h, lat=16.44, lng=102.84, rating=4.5):
        periods = [
            {"open": {"day": d, "hour": open_h, "minute": 0}, "close": {"day": d, "hour": 23, "minute": 59}}
            for d in range(7)
        ]
        return make_place(id=place_id, name=place_id, category="ร้านอาหาร", lat=lat, lng=lng, rating=rating, hours_periods=periods)

    def _pick(self, candidates, day_places=(), start=(9, 0), end=(18, 0), used=()):
        planner = LLMTripPlanner(candidates=list(candidates), start_point=HOTEL_PLACE)
        return planner._pick_fallback_restaurant(
            list(day_places), self.DAY, self._time(*start), self._time(*end), set(used),
        )

    def test_returns_none_when_there_is_no_unused_restaurant(self):
        assert self._pick([]) is None
        assert self._pick([self.rest("a", 10)], used={"a"}) is None

    def test_prefers_a_restaurant_open_at_lunch_over_an_evening_only_one_listed_first(self):
        picked = self._pick([self.rest("evening", 17), self.rest("noon", 10)])
        assert picked.id == "noon"

    def test_prefers_a_visitable_restaurant_over_one_that_opens_after_the_day_ends(self):
        # 13:00-18:00 window: neither is open at the 15:30 meal time; "ok" opens
        # at 17:00 (still reachable before the end), "never" opens at 18:00.
        picked = self._pick([self.rest("never", 18), self.rest("ok", 17)], start=(13, 0), end=(18, 0))
        assert picked.id == "ok"

    def test_prefers_the_restaurant_closest_to_the_days_other_places(self):
        stop = make_place(id="stop", name="Stop", category="สถานที่ท่องเที่ยว", lat=16.70, lng=102.30)
        far = self.rest("far", 10, lat=16.44, lng=102.84)      # in town, ~70 km from the stop
        near = self.rest("near", 10, lat=16.70, lng=102.31)    # next to the stop
        assert self._pick([far, near], day_places=[stop]).id == "near"

    def test_uses_the_hotel_as_the_anchor_when_the_day_has_no_places(self):
        near_hotel = self.rest("near", 10, lat=16.441, lng=102.841)
        far_away = self.rest("far", 10, lat=16.70, lng=102.30)
        assert self._pick([far_away, near_hotel]).id == "near"

    def test_better_rating_breaks_a_distance_tie(self):
        a = self.rest("a", 10, rating=3.5)
        b = self.rest("b", 10, rating=4.8)
        assert self._pick([a, b]).id == "b"

    def test_solve_route_gives_a_day_without_a_restaurant_the_lunch_capable_one(self):
        attraction = make_place(id="a1", name="Attraction", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
        planner = LLMTripPlanner(
            candidates=[attraction, self.rest("evening", 17), self.rest("noon", 10)], start_point=HOTEL_PLACE,
        )
        force_passing_judge(planner)
        planner._call_llm_for_itinerary = lambda prompt: {"itinerary": [{"day": 1, "places": [{"place_id": "a1"}]}]}
        user_input = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel", start_time="09:00", end_time="18:00")
        result, _ = planner.solve_route_with_llm(user_input, "", "")
        meals = [s.place.id for s in result[0].schedule if s.place.category == "ร้านอาหาร"]
        assert meals == ["noon"]


class TestBuildPostScheduleFeedback:
    def _hotel_leg(self):
        return TimeSlot(
            place=HOTEL_PLACE, arrival_time="18:00", departure_time="18:00",
            travel_time_min=0, distance_km=0.0, status="End of Day (Return to Hotel)",
        )

    def _free_time_slot(self):
        dummy = make_place(id="free1", name="Free Time", category=None, rating=0.0)
        return TimeSlot(
            place=dummy, arrival_time="09:00", departure_time="12:00",
            travel_time_min=0, distance_km=0.0, status="Free Time",
        )

    def _real_slot(self, place):
        return TimeSlot(place=place, arrival_time="09:00", departure_time="10:00", travel_time_min=0, distance_km=0.0)

    def _day(self, *slots):
        return DailyItinerary(day=1, date="2026-08-03", schedule=list(slots), day_cost_estimate=0.0, day_travel_time_total=0)

    def test_day_with_only_a_hotel_leg_is_flagged_as_completely_empty(self):
        feedback = LLMTripPlanner(candidates=[])._build_post_schedule_feedback([self._day(self._hotel_leg())])
        assert "Day 1" in feedback and "completely empty" in feedback

    def test_day_with_only_a_free_time_placeholder_is_flagged_as_completely_empty(self):
        feedback = LLMTripPlanner(candidates=[])._build_post_schedule_feedback(
            [self._day(self._free_time_slot(), self._hotel_leg())])
        assert "completely empty" in feedback

    def test_day_with_a_real_stop_but_no_restaurant_is_flagged_when_a_restaurant_candidate_exists(self):
        cafe = make_place(id="c1", name="Cafe1", category="คาเฟ่")
        rest = make_place(id="r1", name="R1", category="ร้านอาหาร")
        feedback = LLMTripPlanner(candidates=[cafe, rest])._build_post_schedule_feedback(
            [self._day(self._real_slot(cafe), self._hotel_leg())])
        assert "restaurant" in feedback.lower()

    def test_day_missing_a_restaurant_is_not_flagged_when_no_restaurant_candidate_exists_at_all(self):
        cafe = make_place(id="c1", name="Cafe1", category="คาเฟ่")
        feedback = LLMTripPlanner(candidates=[cafe])._build_post_schedule_feedback(
            [self._day(self._real_slot(cafe), self._hotel_leg())])
        assert feedback == ""

    def test_day_with_a_restaurant_among_real_stops_is_not_flagged(self):
        rest = make_place(id="r1", name="R1", category="ร้านอาหาร")
        feedback = LLMTripPlanner(candidates=[rest])._build_post_schedule_feedback(
            [self._day(self._real_slot(rest), self._hotel_leg())])
        assert feedback == ""


class TestFoodPreferences:
    """TripInput.food_preferences: meals go to restaurants of the wanted kinds."""

    @staticmethod
    def rest(place_id, kind, lat=16.441, lng=102.841):
        return make_place(id=place_id, name=place_id, category="ร้านอาหาร", subcategory=kind, lat=lat, lng=lng, hours_periods=None)

    def _meals(self, planner, picks, days=1, food=(), end="18:00"):
        user_input = TripInput(
            trip_duration_days=days, start_date="2026-08-03", accommodation_name="Hotel",
            start_time="09:00", end_time=end, food_preferences=list(food),
        )
        itinerary, _ = planner._build_itinerary_from_llm_days({"itinerary": picks}, user_input)
        return [{s.place.id: s.meal_role for s in day.schedule if s.place.category == "ร้านอาหาร"} for day in itinerary]

    def test_a_wanted_kind_replaces_the_llms_other_restaurant(self):
        sight = make_place(id="a1", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
        sushi, isan = self.rest("sushi", "ญี่ปุ่น/เกาหลี"), self.rest("isan", "อาหารอีสาน")
        planner = LLMTripPlanner(candidates=[sight, sushi], start_point=HOTEL_PLACE, meal_pool=[isan])
        meals = self._meals(planner, [{"day": 1, "places": [{"place_id": "a1"}, {"place_id": "sushi", "meal_role": "lunch"}]}],
                            food=["อาหารอีสาน"])
        assert meals == [{"isan": "lunch"}]

    def test_no_preference_keeps_the_llms_restaurant(self):
        sight = make_place(id="a1", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
        sushi, isan = self.rest("sushi", "ญี่ปุ่น/เกาหลี"), self.rest("isan", "อาหารอีสาน")
        planner = LLMTripPlanner(candidates=[sight, sushi], start_point=HOTEL_PLACE, meal_pool=[isan])
        meals = self._meals(planner, [{"day": 1, "places": [{"place_id": "a1"}, {"place_id": "sushi", "meal_role": "lunch"}]}])
        assert meals == [{"sushi": "lunch"}]

    def test_kinds_rotate_meal_after_meal(self):
        pool = [self.rest("isan1", "อาหารอีสาน"), self.rest("isan2", "อาหารอีสาน"),
                self.rest("noodle1", "ก๋วยเตี๋ยว"), self.rest("noodle2", "ก๋วยเตี๋ยว")]
        sights = [make_place(id=f"a{i}", name=f"Sight{i}", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
                  for i in range(2)]
        planner = LLMTripPlanner(candidates=sights, start_point=HOTEL_PLACE, meal_pool=pool)
        meals = self._meals(planner, [{"day": 1, "places": [{"place_id": "a0"}]}, {"day": 2, "places": [{"place_id": "a1"}]}],
                            days=2, food=["อาหารอีสาน", "ก๋วยเตี๋ยว"])
        kinds = [next(iter(day)).rstrip("12") for day in meals]
        assert kinds == ["isan", "noodle"]

    def test_luxury_brings_in_the_priciest_restaurant(self):
        sight = make_place(id="a1", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
        cheap = make_place(id="cheap", name="cheap", category="ร้านอาหาร", price="฿1-200 ต่อคน", lat=16.441, lng=102.841, hours_periods=None)
        premium = make_place(id="premium", name="premium", category="ร้านอาหาร", price="฿600-800 ต่อคน",
                             lat=16.45, lng=102.85, hours_periods=None)
        pool = [cheap, premium]
        luxury = LLMTripPlanner(candidates=[sight], start_point=HOTEL_PLACE, meal_pool=pool, budget_level="หรูหรา")
        assert self._meals(luxury, [{"day": 1, "places": [{"place_id": "a1"}]}]) == [{"premium": "lunch"}]
        standard = LLMTripPlanner(candidates=[sight], start_point=HOTEL_PLACE, meal_pool=pool, budget_level="ปานกลาง")
        assert self._meals(standard, [{"day": 1, "places": [{"place_id": "a1"}]}]) == [{"cheap": "lunch"}]

    def test_falls_back_to_any_restaurant_when_no_wanted_kind_exists(self):
        sight = make_place(id="a1", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
        sushi = self.rest("sushi", "ญี่ปุ่น/เกาหลี")
        planner = LLMTripPlanner(candidates=[sight, sushi], start_point=HOTEL_PLACE)
        meals = self._meals(planner, [{"day": 1, "places": [{"place_id": "a1"}, {"place_id": "sushi", "meal_role": "lunch"}]}],
                            food=["เวียดนาม"])
        assert meals == [{"sushi": "lunch"}]

    def test_prompt_shows_the_preferences_and_each_restaurants_type(self):
        isan = self.rest("isan", "อาหารอีสาน")
        planner = LLMTripPlanner(candidates=[isan])
        user_input = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel", food_preferences=["อาหารอีสาน"])
        prompt = planner.generate_prompt(user_input, "", "")
        assert "Food preferences: อาหารอีสาน" in prompt
        assert "Type: อาหารอีสาน" in prompt


class TestFoodPreferenceInput:
    def test_unknown_choice_is_rejected(self):
        with pytest.raises(ValueError):
            TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="H", food_preferences=["พิซซ่า"])

    def test_old_local_food_interest_becomes_isan_food(self):
        t = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="H", interests=["คาเฟ่", "อาหารพื้นถิ่น"])
        assert t.interests == ["คาเฟ่"]
        assert t.food_preferences == ["อาหารอีสาน"]

    def test_duplicates_are_dropped(self):
        t = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="H", food_preferences=["ก๋วยเตี๋ยว", "ก๋วยเตี๋ยว"])
        assert t.food_preferences == ["ก๋วยเตี๋ยว"]


class TestBreakfast:
    """The "อาหารเช้า" food choice adds a breakfast meal to days that start early enough."""

    @staticmethod
    def shop(place_id, kind, open_h, close_h, lat=16.433, lng=102.824):
        periods = [{"open": {"day": d, "hour": open_h, "minute": 0}, "close": {"day": d, "hour": close_h, "minute": 0}} for d in range(7)]
        return make_place(id=place_id, name=place_id, category="ร้านอาหาร", subcategory=kind, lat=lat, lng=lng, hours_periods=periods)

    def _day(self, food, start="09:00", end="18:00"):
        sights = [make_place(id=f"a{i}", name=f"Sight{i}", category=cat, lat=16.44 + i * 0.002, lng=102.84, hours_periods=None)
                  for i, cat in enumerate(["วัด", "พิพิธภัณฑ์", "สวนสาธารณะ"])]
        breakfast = self.shop("joke", "อาหารเช้า", 6, 11)
        lunch = self.shop("isan", "อาหารอีสาน", 10, 21)
        planner = LLMTripPlanner(candidates=sights + [lunch], start_point=HOTEL_PLACE, meal_pool=[breakfast])
        user_input = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
                               start_time=start, end_time=end, food_preferences=list(food))
        itinerary, _ = planner._build_itinerary_from_llm_days(
            {"itinerary": [{"day": 1, "places": [{"place_id": s.id} for s in sights] + [{"place_id": "isan", "meal_role": "lunch"}]}]},
            user_input,
        )
        return itinerary[0].schedule

    def test_breakfast_comes_first_in_the_morning(self):
        schedule = self._day(["อาหารเช้า"])
        first = schedule[0]
        assert (first.place.id, first.meal_role) == ("joke", "breakfast")
        assert first.arrival_time <= "09:45"
        assert {s.place.id: s.meal_role for s in schedule if s.place.category == "ร้านอาหาร"} == {"joke": "breakfast", "isan": "lunch"}

    def test_no_breakfast_unless_asked_for(self):
        assert "joke" not in {s.place.id for s in self._day([])}

    def test_no_breakfast_on_a_day_that_starts_late(self):
        assert "joke" not in {s.place.id for s in self._day(["อาหารเช้า"], start="10:00")}


class TestOneKindPerDay:
    @staticmethod
    def rest(place_id, kind):
        return make_place(id=place_id, name=place_id, category="ร้านอาหาร", subcategory=kind, lat=16.441, lng=102.841, hours_periods=None)

    def _meals(self, food, days=1):
        sights = [make_place(id=f"a{i}", name=f"Sight{i}", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
                  for i in range(days)]
        pool = [self.rest(f"grill{i}", "ปิ้งย่าง/ชาบู") for i in range(4)] + [self.rest(f"isan{i}", "อาหารอีสาน") for i in range(4)]
        planner = LLMTripPlanner(candidates=sights, start_point=HOTEL_PLACE, meal_pool=pool)
        user_input = TripInput(trip_duration_days=days, start_date="2026-08-03", accommodation_name="Hotel",
                               start_time="09:00", end_time="20:00", food_preferences=food)
        itinerary, _ = planner._build_itinerary_from_llm_days(
            {"itinerary": [{"day": d + 1, "places": [{"place_id": f"a{d}"}]} for d in range(days)]}, user_input)
        return [{s.meal_role: s.place.subcategory for s in day.schedule if s.meal_role} for day in itinerary]

    def test_a_single_kind_gets_one_meal_a_day_and_the_other_is_different(self):
        for day in self._meals(["ปิ้งย่าง/ชาบู"], days=2):
            assert sorted(day.values()) == ["ปิ้งย่าง/ชาบู", "อาหารอีสาน"]

    def test_two_kinds_share_the_day(self):
        assert sorted(self._meals(["ปิ้งย่าง/ชาบู", "อาหารอีสาน"])[0].values()) == ["ปิ้งย่าง/ชาบู", "อาหารอีสาน"]

    def test_the_same_kind_twice_only_when_nothing_else_exists(self):
        sights = [make_place(id="a0", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)]
        pool = [self.rest(f"grill{i}", "ปิ้งย่าง/ชาบู") for i in range(2)]
        planner = LLMTripPlanner(candidates=sights, start_point=HOTEL_PLACE, meal_pool=pool)
        user_input = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
                               start_time="09:00", end_time="20:00", food_preferences=["ปิ้งย่าง/ชาบู"])
        itinerary, _ = planner._build_itinerary_from_llm_days({"itinerary": [{"day": 1, "places": [{"place_id": "a0"}]}]}, user_input)
        assert sorted(s.meal_role for s in itinerary[0].schedule if s.meal_role) == ["dinner", "lunch"]


class TestOneKindPerDayWithLlmPicks:
    """Live 2026-10-21: the LLM itself picked two Isan restaurants (lunch and
    dinner) for an "อาหารอีสาน"-only trip; the rule only steered fallbacks."""

    def test_the_llms_second_same_kind_restaurant_is_swapped_for_another_kind(self):
        rest = TestOneKindPerDay.rest
        sight = make_place(id="a0", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
        isan_lunch, isan_dinner, noodle = rest("isan_l", "อาหารอีสาน"), rest("isan_d", "อาหารอีสาน"), rest("noodle", "ก๋วยเตี๋ยว")
        planner = LLMTripPlanner(candidates=[sight, isan_lunch, isan_dinner], start_point=HOTEL_PLACE, meal_pool=[noodle])
        user_input = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
                               start_time="09:00", end_time="20:00", food_preferences=["อาหารอีสาน"])
        itinerary, _ = planner._build_itinerary_from_llm_days({"itinerary": [{"day": 1, "places": [
            {"place_id": "a0"}, {"place_id": "isan_l", "meal_role": "lunch"}, {"place_id": "isan_d", "meal_role": "dinner"},
        ]}]}, user_input)
        meals = {s.meal_role: s.place.id for s in itinerary[0].schedule if s.meal_role}
        assert meals == {"lunch": "isan_l", "dinner": "noodle"}

    def test_with_two_wanted_kinds_a_repeat_beats_a_kind_nobody_asked_for(self):
        # Live 2026-10-22: "ก๋วยเตี๋ยว + อาหารอีสาน", no noodle shop for dinner,
        # and the LLM's Isan dinner was swapped for a yakiniku place.
        rest = TestOneKindPerDay.rest
        sight = make_place(id="a0", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
        isan_lunch, isan_dinner, yakiniku = rest("isan_l", "อาหารอีสาน"), rest("isan_d", "อาหารอีสาน"), rest("yaki", "ญี่ปุ่น/เกาหลี")
        planner = LLMTripPlanner(candidates=[sight, isan_lunch, isan_dinner], start_point=HOTEL_PLACE, meal_pool=[yakiniku])
        user_input = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel",
                               start_time="09:00", end_time="20:00", food_preferences=["ก๋วยเตี๋ยว", "อาหารอีสาน"])
        itinerary, _ = planner._build_itinerary_from_llm_days({"itinerary": [{"day": 1, "places": [
            {"place_id": "a0"}, {"place_id": "isan_l", "meal_role": "lunch"}, {"place_id": "isan_d", "meal_role": "dinner"},
        ]}]}, user_input)
        meals = {s.meal_role: s.place.id for s in itinerary[0].schedule if s.meal_role}
        assert meals == {"lunch": "isan_l", "dinner": "isan_d"}


def test_a_breakfast_shop_is_not_a_dinner_when_another_restaurant_can_be():
    rest = TestOneKindPerDay.rest
    sight = make_place(id="a0", name="Sight", category="สถานที่ท่องเที่ยว", lat=16.441, lng=102.841, hours_periods=None)
    planner = LLMTripPlanner(candidates=[sight, rest("isan", "อาหารอีสาน"), rest("joke", "อาหารเช้า")],
                             start_point=HOTEL_PLACE, meal_pool=[rest("noodle", "ก๋วยเตี๋ยว")])
    user_input = TripInput(trip_duration_days=1, start_date="2026-08-03", accommodation_name="Hotel", start_time="09:00", end_time="20:00")
    itinerary, _ = planner._build_itinerary_from_llm_days({"itinerary": [{"day": 1, "places": [
        {"place_id": "a0"}, {"place_id": "isan", "meal_role": "lunch"}, {"place_id": "joke", "meal_role": "dinner"},
    ]}]}, user_input)
    assert {s.meal_role: s.place.id for s in itinerary[0].schedule if s.meal_role} == {"lunch": "isan", "dinner": "noodle"}
