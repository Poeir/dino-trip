"""Static Thai public holiday advisory -- NOT used anywhere in scheduling
logic (see route_scheduler.py, which never imports this module). Most
tourist-facing venues in this dataset (temples, restaurants, markets, cafes)
stay open, or get busier, on public holidays -- Songkran and the Buddhist
holy days especially. Only government offices/banks reliably close, and
neither is a trip-planner candidate category here. There is no reliable
per-place signal in the data for "does this specific place close on public
holidays", so guessing shut/open per place would be wrong more often than
right. This only flags that a trip date might behave unusually, for
routes_tripplanner.py to surface as a passive note -- it must never be used
to change what route_scheduler schedules.
"""
from datetime import date, timedelta
from typing import Dict, List, Tuple

# (month, day) -> Thai name. Repeats every year -- Gregorian-fixed Thai
# public holidays (royal/national observances) only, safe to hardcode
# indefinitely.
FIXED_DATE_HOLIDAYS: Dict[Tuple[int, int], str] = {
    (1, 1): "วันขึ้นปีใหม่",
    (4, 6): "วันจักรี",
    (4, 13): "วันสงกรานต์",
    (4, 14): "วันสงกรานต์",
    (4, 15): "วันสงกรานต์",
    (5, 1): "วันแรงงานแห่งชาติ",
    (5, 4): "วันฉัตรมงคล",
    (7, 28): "วันเฉลิมพระชนมพรรษา ร.10",
    (8, 12): "วันแม่แห่งชาติ",
    (10, 13): "วันคล้ายวันสวรรคต ร.9",
    (10, 23): "วันปิยมหาราช",
    (12, 5): "วันพ่อแห่งชาติ",
    (12, 10): "วันรัฐธรรมนูญ",
    (12, 31): "วันสิ้นปี",
}

# Lunar-calendar Buddhist holy days and cabinet-announced special/in-lieu
# days shift every year and can't be computed from a rule -- only years
# explicitly listed here are covered. A trip in an unlisted year simply gets
# no movable-holiday advisory (silently skipped), never a wrong guess.
# 2026 dates verified against official calendar coverage (Bank of
# Thailand / Office Holidays) at the time this module was written -- add
# each new year's dates here as they're confirmed; don't extrapolate.
MOVABLE_HOLIDAYS_BY_YEAR: Dict[int, Dict[date, str]] = {
    2026: {
        date(2026, 1, 2): "วันหยุดพิเศษ (มติ ครม.)",
        date(2026, 3, 3): "วันมาฆบูชา",
        date(2026, 5, 31): "วันวิสาขบูชา",
        date(2026, 6, 1): "วันหยุดชดเชยวันวิสาขบูชา",
        date(2026, 7, 29): "วันอาสาฬหบูชา",
        date(2026, 7, 30): "วันเข้าพรรษา",
    },
}


def holidays_in_range(start_date: date, duration_days: int) -> List[Tuple[date, str]]:
    """Every known holiday (fixed every year, or movable for a covered
    year) falling within [start_date, start_date + duration_days - 1], in
    date order. Advisory data only -- see module docstring."""
    found: List[Tuple[date, str]] = []
    for i in range(duration_days):
        day = start_date + timedelta(days=i)
        movable = MOVABLE_HOLIDAYS_BY_YEAR.get(day.year, {})
        if day in movable:
            found.append((day, movable[day]))
        elif (day.month, day.day) in FIXED_DATE_HOLIDAYS:
            found.append((day, FIXED_DATE_HOLIDAYS[(day.month, day.day)]))
    return found
