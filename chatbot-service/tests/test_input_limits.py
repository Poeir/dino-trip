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
