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
