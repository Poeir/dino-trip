"""Where a trip's last day ends when it isn't the accommodation.

The trip form's "วันสุดท้ายจบที่" (TripInput.trip_end): a flight, bus or train
out of Khon Kaen, an อำเภอ the traveller drives on to, or a pin. The last day
then ends there instead of back at the accommodation, and early enough to
make the departure. Every other day is unchanged.

Only the last day's END changes. The scheduler already counts the final drive
in a day's route cost (route_scheduler._route_cost), so with the end point as
that drive's destination the day's stops are ordered toward it by themselves.
"""
from __future__ import annotations

import logging
from datetime import datetime, time
from typing import Callable, Optional

from .models import Place, TripEnd, TripInput

logger = logging.getLogger(__name__)

# Category / status of the final slot when the day ends at the trip's end
# point rather than the accommodation ("ที่พัก" / "End of Day (Return to Hotel)").
TRIP_END_CATEGORY = "จุดจบทริป"
TRIP_END_STATUS = "End of Trip"
TRIP_END_PLACE_ID = "trip_end"

# Slots that are not a visit: the free-time block (None), the accommodation
# leg and the trip's end point.
NON_VISIT_CATEGORIES = (None, "ที่พัก", TRIP_END_CATEGORY)

# name, lat, lng. Airport: the aerodrome reference point in the Thai AIP
# (VTUK, 16 27 59.86N 102 47 01.26E). Bus terminal 3 (on the ring road,
# where long-distance buses leave from) and the railway station:
# OpenStreetMap, checked 2026-10-21.
TRANSPORT_HUBS = {
    "airport": ("ท่าอากาศยานขอนแก่น", 16.46663, 102.78368),
    "bus": ("สถานีขนส่งผู้โดยสารขอนแก่น แห่งที่ 3", 16.39027, 102.80474),
    "train": ("สถานีรถไฟขอนแก่น", 16.42681, 102.82567),
}

# Minutes to be there before the departure time: check-in and security at
# the airport, finding the platform/bay elsewhere. A district or pin is a
# destination, not a departure, so nothing is added.
DEPARTURE_BUFFER_MINUTES = {"airport": 90, "bus": 30, "train": 30}

# A last day with less time than this before it has to leave gets no stops:
# the traveller just goes to the end point (a 07:30 flight, say).
MIN_PLANNED_DAY_MINUTES = 90


def _minutes(t: time) -> int:
    return t.hour * 60 + t.minute


def _parse(hhmm: str) -> time:
    return datetime.strptime(hhmm, "%H:%M").time()


def last_day_end_time(user_input: TripInput) -> time:
    """When the last day's stops must be over: the normal end_time, or
    earlier when the trip ends with a departure (its time minus the buffer).
    Never before start_time (such a day has nothing in it, see
    is_travel_only_day)."""
    start = _parse(user_input.start_time)
    end = _parse(user_input.end_time)
    trip_end = user_input.trip_end
    if trip_end is None or trip_end.time is None:
        return end
    leave_by = _minutes(_parse(trip_end.time)) - DEPARTURE_BUFFER_MINUTES.get(trip_end.kind, 0)
    leave_by = max(leave_by, _minutes(start))
    if leave_by >= _minutes(end):
        return end
    return time(leave_by // 60, leave_by % 60)


def departure_day_window(user_input: TripInput, travel_min: int) -> tuple[time, time]:
    """Window for a departure-only last day (is_travel_only_day): it starts
    when the traveller has to leave the accommodation to reach the end point
    by the departure time minus its buffer, not at the day's usual
    start_time. Live: a 09:30 flight was reached at 09:17 by setting off at
    the usual 09:00. Both ends of the window are that moment -- nothing is
    planned in it."""
    trip_end = user_input.trip_end
    leave_by = _minutes(_parse(trip_end.time)) - DEPARTURE_BUFFER_MINUTES.get(trip_end.kind, 0)
    depart = max(0, min(leave_by - travel_min, _minutes(_parse(user_input.start_time))))
    return time(depart // 60, depart % 60), time(depart // 60, depart % 60)


def is_travel_only_day(start: time, end: time) -> bool:
    """Too short to plan anything in (see MIN_PLANNED_DAY_MINUTES)."""
    return _minutes(end) - _minutes(start) < MIN_PLANNED_DAY_MINUTES


def day_window(user_input: TripInput, day_num: int) -> tuple[time, time]:
    """(start, end) of one day's stops. Only the last day can differ."""
    start = _parse(user_input.start_time)
    if day_num == user_input.trip_duration_days:
        return start, last_day_end_time(user_input)
    return start, _parse(user_input.end_time)


def resolve_trip_end(
    trip_end: Optional[TripEnd], district_centre: Callable[[str], Optional[dict]],
) -> Optional[Place]:
    """The end point as a Place, or None when the trip ends at the
    accommodation as usual -- also when an อำเภอ has no located place to
    take a centre from (logged; the form only offers districts that do)."""
    if trip_end is None:
        return None
    if trip_end.kind in TRANSPORT_HUBS:
        name, lat, lng = TRANSPORT_HUBS[trip_end.kind]
    elif trip_end.kind == "district":
        centre = district_centre(trip_end.name or "")
        if centre is None:
            logger.warning("trip planner: no located place in district %r, the trip ends at the accommodation", trip_end.name)
            return None
        name, lat, lng = f"อำเภอ{trip_end.name.strip()}", centre["lat"], centre["lng"]
    else:  # pin
        name, lat, lng = (trip_end.name or "").strip() or "จุดหมายปลายทาง", trip_end.lat, trip_end.lng
    return Place(id=TRIP_END_PLACE_ID, name=name, category=TRIP_END_CATEGORY, lat=lat, lng=lng)


def describe_for_prompt(user_input: TripInput, end_place: Optional[Place]) -> str:
    """One line for the generator/judge prompts about how the last day ends,
    "" when it ends at the accommodation like the others."""
    if end_place is None:
        return ""
    last = user_input.trip_duration_days
    start, end = day_window(user_input, last)
    if is_travel_only_day(start, end):
        return (
            f"Day {last} is the departure day: the traveller leaves for {end_place.name} at the start of the day, "
            f"so plan NO places on Day {last}."
        )
    return (
        f"Day {last} does not return to the accommodation: it ends at {end_place.name}"
        f"{' by ' + end.strftime('%H:%M') if end != _parse(user_input.end_time) else ''}. "
        f"Its window is {start.strftime('%H:%M')}-{end.strftime('%H:%M')}; pick places for Day {last} that lie on the way "
        f"there (between the accommodation and {end_place.name}) and that fit that shorter window."
    )
