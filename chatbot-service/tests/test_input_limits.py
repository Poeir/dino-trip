import pytest
from pydantic import ValidationError

from src.api.routes_chatbot import MAX_MESSAGE_CHARS, ChatRequest
from src.services.trip_planner.models import TripInput

BASE = dict(trip_duration_days=2, start_date="2026-08-03", accommodation_name="Hotel")


def test_chat_message_at_limit_is_accepted():
    assert ChatRequest(message="ก" * MAX_MESSAGE_CHARS).message


def test_chat_message_over_limit_is_rejected():
    with pytest.raises(ValidationError):
        ChatRequest(message="ก" * (MAX_MESSAGE_CHARS + 1))


def test_trip_input_defaults_and_normal_request_still_valid():
    t = TripInput(**BASE, must_go=["พิพิธภัณฑ์ไดโนเสาร์"], interests=["คาเฟ่"])
    assert t.must_go == ["พิพิธภัณฑ์ไดโนเสาร์"] and t.trip_pace == "relaxed"


@pytest.mark.parametrize(
    "overrides",
    [
        {"trip_duration_days": 0},
        {"trip_duration_days": 365},
        {"accommodation_name": "x" * 201},
        {"must_go": ["x"] * 31},
        {"must_go": ["x" * 201]},
        {"interests": ["x" * 101]},
    ],
)
def test_trip_input_rejects_oversized_fields(overrides):
    with pytest.raises(ValidationError):
        TripInput(**{**BASE, **overrides})


@pytest.mark.parametrize(
    "overrides",
    [
        {"start_date": "11/10/2026"},                       # was a 500 from strptime further down
        {"start_date": "2026-02-30"},
        {"start_time": "9am"},
        {"end_time": "25:00"},
        {"start_time": "18:00", "end_time": "09:00"},       # was a trip with no stops in it
        {"start_time": "09:00", "end_time": "09:00"},
        {"trip_pace": "กำลังดี"},                             # the label, not the key the form sends
        {"budget_level": "luxury"},
        {"area_scope": "ทั้งประเทศ"},
        {"accommodation_lat": 116.4, "accommodation_lng": 102.8},
        {"accommodation_lat": 16.4, "accommodation_lng": 1028.0},
    ],
)
def test_trip_input_rejects_malformed_values(overrides):
    with pytest.raises(ValidationError):
        TripInput(**{**BASE, **overrides})


def test_trip_input_accepts_every_value_the_form_sends():
    for pace in ("relaxed", "standard", "packed"):
        for budget in ("ประหยัด", "ปานกลาง", "หรูหรา"):
            for area in ("เมือง", "ทั่วขอนแก่น"):
                TripInput(**BASE, trip_pace=pace, budget_level=budget, area_scope=area,
                          start_time="08:30", end_time="20:00", accommodation_lat=16.43, accommodation_lng=102.83)
