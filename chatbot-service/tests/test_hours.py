import datetime

import pytest

from src.services.rag.hours import annotate_overnight, is_open_at, requested_time, strip_time_words

BKK = datetime.timezone(datetime.timedelta(hours=7))
WED_5PM = datetime.datetime(2026, 10, 21, 17, 0, tzinfo=BKK)  # a Wednesday

# Google periods: 0=Sunday. Open 07:00 to 04:00 the next morning, every day.
OVERNIGHT = [{"open": {"day": d, "hour": 7, "minute": 0}, "close": {"day": (d + 1) % 7, "hour": 4, "minute": 0}} for d in range(7)]
DAYTIME = [{"open": {"day": d, "hour": 9, "minute": 0}, "close": {"day": d, "hour": 15, "minute": 30}} for d in range(7)]
ALWAYS = [{"open": {"day": 0, "hour": 0, "minute": 0}}]


def at(day, hour, minute=0):
    return datetime.datetime(2026, 10, day, hour, minute, tzinfo=BKK)


class TestIsOpenAt:
    def test_early_hours_belong_to_the_night_before(self):
        # Thursday 01:00 is inside Wednesday's 07:00-04:00.
        assert is_open_at(OVERNIGHT, at(22, 1)) is True
        assert is_open_at(OVERNIGHT, at(22, 5)) is False

    def test_saturday_night_wraps_into_sunday(self):
        assert is_open_at(OVERNIGHT, at(25, 2)) is True  # Sunday 02:00

    def test_daytime_place_is_shut_at_night(self):
        assert is_open_at(DAYTIME, at(22, 1)) is False
        assert is_open_at(DAYTIME, at(21, 10)) is True

    def test_open_24_hours(self):
        assert is_open_at(ALWAYS, at(22, 3)) is True

    def test_no_data_is_unknown(self):
        assert is_open_at(None, at(22, 1)) is None
        assert is_open_at([], at(22, 1)) is None


class TestAnnotateOvernight:
    def test_a_close_after_midnight_is_spelled_out(self):
        # Live: "7:00–4:00" was read as closing at 16:00.
        assert annotate_overnight("ทุกวัน 7:00–4:00") == "ทุกวัน 7:00–4:00 (ปิดตี 4 ของวันถัดไป)"

    def test_midnight(self):
        assert annotate_overnight("ทุกวัน 17:00–0:00") == "ทุกวัน 17:00–0:00 (ปิดเที่ยงคืน)"

    def test_daytime_hours_are_left_alone(self):
        text = "วันจันทร์: 9:00–17:00\nวันอังคาร: 9:00–17:00"
        assert annotate_overnight(text) == text

    def test_empty(self):
        assert annotate_overnight(None) is None


class TestRequestedTime:
    @pytest.mark.parametrize("query, hour", [("หิวตอนตีหนึ่ง", 1), ("ตี 3 มีอะไรกิน", 3), ("ตีสองยังมีร้านเปิดไหม", 2)])
    def test_ti_hours_are_tonight(self, query, hour):
        when, _ = requested_time(query, WED_5PM)
        assert (when.day, when.hour) == (22, hour)

    def test_ti_hours_asked_before_dawn_are_the_night_under_way(self):
        when, _ = requested_time("ตีหนึ่งมีร้านไหนเปิด", at(22, 0, 30))
        assert (when.day, when.hour) == (22, 1)

    def test_late_means_late_tonight(self):
        when, _ = requested_time("ร้านเปิดดึกแถวมข.", WED_5PM)
        assert (when.day, when.hour, when.minute) == (21, 23, 30)

    def test_now(self):
        assert requested_time("ตอนนี้ร้านไหนเปิดอยู่", WED_5PM)[0] == WED_5PM

    def test_no_time_asked(self):
        assert requested_time("ร้านอาหารแถวบึงแก่นนคร", WED_5PM) is None
        assert requested_time("ตีกอล์ฟที่ไหนดี", WED_5PM) is None


def test_strip_time_words_leaves_the_rest():
    assert strip_time_words("หิวตอนตีหนึ่ง มีร้านไหนเปิดบ้าง") == "มีร้านไหน บ้าง"
