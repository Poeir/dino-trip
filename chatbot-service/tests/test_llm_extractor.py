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
from src.services.trip_planner.models import JudgeVerdict, Place, TripInput


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
    planner.judge.evaluate = lambda user_input, itinerary: JudgeVerdict(
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
        planner.judge.evaluate = lambda user_input, itinerary: JudgeVerdict(
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
            JudgeVerdict(passed=False, score=0.2, pacing_ok=False, intent_match_ok=True,
                         issues=["too many cafes"], feedback="add a restaurant instead", rationale=""),
            JudgeVerdict(passed=True, score=0.9, pacing_ok=True, intent_match_ok=True, rationale="fixed"),
        ]
        planner.judge.evaluate = lambda user_input, itinerary: verdicts.pop(0)

        result, rationale = planner.solve_route_with_llm(self._user_input(), "", "")
        assert len(prompts) == 2
        assert "add a restaurant instead" not in prompts[0]
        assert "add a restaurant instead" in prompts[1]
        assert rationale == "fixed"

    def test_judge_fails_every_attempt_returns_last_itinerary_without_raising(self):
        planner = self._planner_with_one_place()
        planner.judge.evaluate = lambda user_input, itinerary: JudgeVerdict(
            passed=False, score=0.1, pacing_ok=False, intent_match_ok=False,
            issues=["bad"], feedback="try harder", rationale="best effort so far",
        )
        calls = []
        original = planner._call_llm_for_itinerary
        planner._call_llm_for_itinerary = lambda prompt: (calls.append(prompt), original(prompt))[1]

        result, rationale = planner.solve_route_with_llm(self._user_input(), "", "")
        assert len(calls) == MAX_JUDGE_ATTEMPTS
        assert result[0].schedule  # still a valid itinerary
        assert rationale == "best effort so far"

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
        planner.judge.evaluate = lambda user_input, itinerary: JudgeVerdict(
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

        def judge_should_not_be_called(user_input, itinerary):
            raise AssertionError("judge.evaluate should never be called when generation fails technically")
        planner.judge.evaluate = judge_should_not_be_called

        with pytest.raises(ValueError):
            planner.solve_route_with_llm(self._user_input(), "", "")


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
