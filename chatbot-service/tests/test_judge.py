"""Unit tests for judge.py -- no network (mocks out _call_llm_for_verdict,
mirroring test_llm_extractor.py's direct-lambda-assignment idiom)."""
import logging

import pytest

from src.services.trip_planner.judge import TripItineraryJudge
from src.services.trip_planner.models import DailyItinerary, Place, TimeSlot, TripInput


@pytest.fixture
def judge():
    return TripItineraryJudge()


HOTEL = Place(id="hotel_dummy", name="โรงแรมของผู้ใช้", category="ที่พัก", lat=16.43, lng=102.82)


def make_itinerary():
    cafe = Place(id="p1", name="Test Cafe", category="คาเฟ่", rating=4.5, lat=16.44, lng=102.84, tags=["คาเฟ่"], price_level=2)
    free = Place(id="free1", name="Free Time", category=None, rating=0.0)
    slots = [
        TimeSlot(place=cafe, arrival_time="10:00", departure_time="11:00", travel_time_min=10, distance_km=2.0, status="Open (No Data)"),
        TimeSlot(place=free, arrival_time="11:00", departure_time="13:00", travel_time_min=0, distance_km=0.0, status="Free Time"),
        TimeSlot(place=HOTEL, arrival_time="15:00", departure_time="15:00", travel_time_min=10, distance_km=2.0,
                 status="End of Day (Return to Hotel)"),
    ]
    return [DailyItinerary(day=1, date="2026-08-10", schedule=slots, day_cost_estimate=250.0, day_travel_time_total=10)]


def make_user_input(**overrides):
    defaults = dict(
        trip_duration_days=1, start_date="2026-08-10", accommodation_name="Hotel",
        interests=["คาเฟ่"], must_go=["Test Cafe"],
    )
    defaults.update(overrides)
    return TripInput(**defaults)


def issue(severity, problem="p", fix="f", day=1):
    return {"severity": severity, "day": day, "problem": problem, "fix": fix}


class TestEvaluate:
    def test_passes_with_only_minor_issues(self, judge):
        judge._call_llm_for_verdict = lambda prompt: {
            "issues": [issue("minor", "two cafes in a row")], "score": 0.8, "rationale": "จัดได้ดี",
        }
        verdict = judge.evaluate(make_user_input(), make_itinerary())
        assert verdict.passed is True
        assert verdict.major_issues == 0
        assert verdict.score == 0.8
        assert verdict.rationale == "จัดได้ดี"
        assert verdict.issues == ["[minor] Day 1: two cafes in a row"]

    def test_one_major_issue_fails_whatever_the_score(self, judge):
        # The gate is the severity, not a score threshold that depends on how
        # generously a given model scores.
        judge._call_llm_for_verdict = lambda prompt: {
            "issues": [issue("minor", "a"), issue("major", "dinosaur interest missing", "add Dino Museum to day 2", day=2)],
            "score": 0.95, "rationale": "",
        }
        verdict = judge.evaluate(make_user_input(), make_itinerary())
        assert verdict.passed is False
        assert verdict.major_issues == 1
        # Majors come first, each with its fix -- that's what the next round reads.
        assert verdict.feedback.splitlines()[0] == "- [major] Day 2: dinosaur interest missing -> add Dino Museum to day 2"

    def test_trip_wide_issue_is_labelled_trip(self, judge):
        judge._call_llm_for_verdict = lambda prompt: {"issues": [issue("major", "x", day=0)], "score": 0.5, "rationale": ""}
        assert judge.evaluate(make_user_input(), make_itinerary()).issues == ["[major] Trip: x"]

    def test_missing_optional_fields_default_sensibly(self, judge):
        judge._call_llm_for_verdict = lambda prompt: {"score": 0.9}
        verdict = judge.evaluate(make_user_input(), make_itinerary())
        assert verdict.passed is True
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
        assert verdict.judge_call_failed is True
        assert any("fail" in r.message.lower() for r in caplog.records)

    def test_genuine_pass_does_not_set_judge_call_failed(self, judge):
        judge._call_llm_for_verdict = lambda prompt: {"issues": [], "score": 0.9, "rationale": "จัดได้ดี"}
        assert judge.evaluate(make_user_input(), make_itinerary()).judge_call_failed is False


class TestGenerateJudgePrompt:
    def test_contains_trip_settings(self, judge):
        user_input = make_user_input(trip_pace="packed", interests=["ธรรมชาติ"], must_go=["ตลาดต้นตาล"],
                                     start_time="10:00", end_time="17:00")
        prompt = judge.generate_judge_prompt(user_input, make_itinerary())
        assert "packed" in prompt and "ธรรมชาติ" in prompt and "ตลาดต้นตาล" in prompt
        assert "10:00-17:00" in prompt
        assert "Meals each day: lunch" in prompt   # so it can't ask for a dinner the day can't hold

    def test_days_come_with_idle_time_and_early_end_worked_out(self, judge):
        prompt = judge.generate_judge_prompt(make_user_input(), make_itinerary())
        assert "idle 120 min" in prompt
        assert "back at the accommodation 15:00 (180 min before the window ends)" in prompt

    def test_places_show_interest_matches_and_price(self, judge):
        prompt = judge.generate_judge_prompt(make_user_input(), make_itinerary())
        assert "Test Cafe [คาเฟ่] | interests: คาเฟ่ | price: ฿฿" in prompt

    def test_noise_it_cannot_act_on_is_left_out(self, judge):
        prompt = judge.generate_judge_prompt(make_user_input(), make_itinerary())
        assert "โรงแรมของผู้ใช้" not in prompt
        assert "No Data" not in prompt

    def test_unused_candidates_are_listed_interest_matches_first(self, judge):
        unused = [
            Place(id="u1", name="Plain Park", category="สวนสาธารณะ", rating=4.9),
            Place(id="u2", name="Another Cafe", category="คาเฟ่", rating=4.1, tags=["คาเฟ่"]),
        ]
        prompt = judge.generate_judge_prompt(make_user_input(), make_itinerary(), unused)
        section = prompt.split("[UNUSED CANDIDATES", 1)[1].split("[HOW TO REVIEW]", 1)[0]
        assert section.index("Another Cafe") < section.index("Plain Park")

    def test_states_the_hard_daily_limits(self, judge):
        # Live: it asked for two more cafes on a day already at the cafe cap.
        prompt = judge.generate_judge_prompt(make_user_input(trip_pace="standard"), make_itinerary())
        assert 'Hard limits per day the planner cannot exceed: 6 attractions, 2 "คาเฟ่", 3 of any other category' in prompt

    def test_lists_picks_that_did_not_fit(self, judge):
        park = Place(id="np", name="อุทยานแห่งชาติภูเวียง", category="อุทยานแห่งชาติ")
        prompt = judge.generate_judge_prompt(make_user_input(), make_itinerary(), [], [(2, park)])
        section = prompt.split("[PICKED BUT DIDN'T FIT", 1)[1].split("[HOW TO REVIEW]", 1)[0]
        assert "Day 2: อุทยานแห่งชาติภูเวียง [อุทยานแห่งชาติ]" in section
        assert "must not add back a place from PICKED BUT DIDN'T FIT" in prompt

    def test_says_when_nothing_is_left_to_swap_in(self, judge):
        prompt = judge.generate_judge_prompt(make_user_input(), make_itinerary(), [])
        assert "every candidate is already used" in prompt

    def test_still_tells_the_judge_not_to_review_times_or_order(self, judge):
        prompt = judge.generate_judge_prompt(make_user_input(), make_itinerary())
        do_not = prompt.split("Do NOT raise", 1)[1].split("[RATIONALE]", 1)[0].lower()
        assert "exact times" in do_not and "visiting order" in do_not
