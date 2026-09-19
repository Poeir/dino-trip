"""Unit tests for thai_holidays.py -- a passive advisory calendar, not a
scheduling rule (see route_scheduler.py, which never imports this module)."""
from datetime import date

from src.services.trip_planner import thai_holidays as th


class TestHolidaysInRange:
    def test_fixed_date_holiday_inside_range_is_found(self):
        # Apr 13 is Songkran every year, including years with no movable-
        # holiday table at all.
        found = th.holidays_in_range(date(2030, 4, 12), 3)  # Apr 12-14, 2030
        assert (date(2030, 4, 13), "วันสงกรานต์") in found

    def test_no_holiday_in_range_returns_empty(self):
        # A quiet stretch with no fixed or movable holiday.
        found = th.holidays_in_range(date(2026, 2, 10), 3)  # Feb 10-12, 2026
        assert found == []

    def test_movable_holiday_in_a_covered_year_is_found(self):
        found = th.holidays_in_range(date(2026, 3, 1), 5)  # Mar 1-5, 2026
        assert (date(2026, 3, 3), "วันมาฆบูชา") in found

    def test_movable_holiday_in_an_uncovered_year_is_silently_skipped(self):
        # 2031 has no entry in MOVABLE_HOLIDAYS_BY_YEAR -- must not guess a
        # date, just report nothing for the movable side (fixed-date
        # holidays in the same range still show up).
        found = th.holidays_in_range(date(2031, 3, 1), 5)  # Mar 1-5, 2031
        assert found == []

    def test_range_spanning_multiple_holidays_returns_all_in_date_order(self):
        found = th.holidays_in_range(date(2026, 4, 12), 5)  # Apr 12-16, 2026
        dates = [d for d, _ in found]
        assert dates == sorted(dates)
        assert date(2026, 4, 13) in dates
        assert date(2026, 4, 14) in dates
        assert date(2026, 4, 15) in dates

    def test_single_day_trip_on_a_holiday_is_found(self):
        found = th.holidays_in_range(date(2026, 1, 1), 1)
        assert found == [(date(2026, 1, 1), "วันขึ้นปีใหม่")]
