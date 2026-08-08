"""Unit tests for judge.py -- no network (mocks out _call_llm_for_verdict,
mirroring test_llm_extractor.py's direct-lambda-assignment idiom)."""
import logging
import re

import pytest

from src.services.trip_planner.judge import TripItineraryJudge
from src.services.trip_planner.models import DailyItinerary, Place, TimeSlot, TripInput


@pytest.fixture
def judge():
    return TripItineraryJudge()


def make_itinerary():
    place = Place(id="p1", name="Test Cafe", category="คาเฟ่", rating=4.5, lat=16.44, lng=102.84)
    slot = TimeSlot(place=place, arrival_time="10:00", departure_time="11:00", travel_time_min=10, distance_km=2.0)
    return [DailyItinerary(day=1, date="2026-08-10", schedule=[slot], day_cost_estimate=250.0, day_travel_time_total=10)]


def make_user_input(**overrides):
    defaults = dict(
        trip_duration_days=1, start_date="2026-08-10", accommodation_name="Hotel",
        interests=["คาเฟ่"], must_go=["Test Cafe"],
    )
    defaults.update(overrides)
    return TripInput(**defaults)


class TestEvaluate:
    def test_passes_when_score_high_and_flags_true(self, judge):
        judge._call_llm_for_verdict = lambda prompt: {
            "score": 0.9, "pacing_ok": True, "intent_match_ok": True,
            "issues": [], "feedback": "", "rationale": "จัดได้ดี",
        }
        verdict = judge.evaluate(make_user_input(), make_itinerary())
        assert verdict.passed is True
        assert verdict.score == 0.9
        assert verdict.rationale == "จัดได้ดี"

    def test_fails_when_hard_gate_flag_false_even_with_high_score(self, judge):
        # Proves flags can't be bought off by a high score.
        judge._call_llm_for_verdict = lambda prompt: {
            "score": 0.95, "pacing_ok": False, "intent_match_ok": True,
            "issues": ["back-to-back meals"], "feedback": "space out the meals", "rationale": "",
        }
        verdict = judge.evaluate(make_user_input(), make_itinerary())
        assert verdict.passed is False

    def test_fails_when_score_below_threshold_even_with_flags_true(self, judge):
        judge._call_llm_for_verdict = lambda prompt: {
            "score": 0.3, "pacing_ok": True, "intent_match_ok": True,
            "issues": [], "feedback": "", "rationale": "",
        }
        verdict = judge.evaluate(make_user_input(), make_itinerary())
        assert verdict.passed is False

    def test_missing_optional_fields_default_sensibly(self, judge):
        judge._call_llm_for_verdict = lambda prompt: {
            "score": 0.9, "pacing_ok": True, "intent_match_ok": True,
        }
        verdict = judge.evaluate(make_user_input(), make_itinerary())
        assert verdict.issues == []
        assert verdict.feedback == ""
        assert verdict.rationale == ""

    def test_llm_call_exception_fails_open(self, judge, caplog):
        def raise_err(prompt):
            raise RuntimeError("network down")
        judge._call_llm_for_verdict = raise_err

        with caplog.at_level(logging.WARNING):
            verdict = judge.evaluate(make_user_input(), make_itinerary())

        assert verdict.passed is True
        assert verdict.rationale == ""
        assert any("fail" in r.message.lower() for r in caplog.records)

    def test_malformed_json_fails_open(self, judge, caplog):
        def bad_parse(prompt):
            raise ValueError("Expecting value: line 1 column 1")
        judge._call_llm_for_verdict = bad_parse

        with caplog.at_level(logging.WARNING):
            verdict = judge.evaluate(make_user_input(), make_itinerary())

        assert verdict.passed is True


class TestGenerateJudgePrompt:
    def test_contains_user_context(self, judge):
        user_input = make_user_input(trip_pace="packed", interests=["ธรรมชาติ"], must_go=["ตลาดต้นตาล"])
        prompt = judge.generate_judge_prompt(user_input, make_itinerary())
        assert "packed" in prompt
        assert "ธรรมชาติ" in prompt
        assert "ตลาดต้นตาล" in prompt

    def test_instructs_judge_not_to_check_opening_hours_or_end_time(self, judge):
        # The prompt does mention opening hours/end time, but only inside an
        # explicit "do not evaluate this" instruction -- that's the guarantee
        # this test is protecting, not the words' mere absence.
        prompt = judge.generate_judge_prompt(make_user_input(), make_itinerary())
        assert "WHAT NOT TO EVALUATE" in prompt
        not_to_evaluate_section = prompt.split("WHAT NOT TO EVALUATE", 1)[1].split("[RATIONALE", 1)[0]
        assert "opening" in not_to_evaluate_section.lower()
        assert re.search(r"end\s+time", not_to_evaluate_section.lower())
