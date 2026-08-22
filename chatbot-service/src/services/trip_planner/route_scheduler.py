"""Deterministic (non-LLM) route ordering and time-of-day scheduling.

The LLM only decides *which* places go on *which day* (see
llm_extractor.generate_prompt) -- it is not given coordinates and is not
asked for arrival/departure times, because it has no reliable way to reason
about geographic distance or clock-time sequencing. Everything in this
module is pure arithmetic over real lat/lng + real Google opening-hours data
and is fully unit-testable without touching the LLM or the network.
"""
import logging
import math
from datetime import date, datetime, time, timedelta
from typing import Dict, List, Optional, Tuple

from .models import DailyItinerary, Place, TimeSlot

logger = logging.getLogger(__name__)

# Category-based visit durations, keyed by our normalized Thai categories
# instead of Google's raw type slugs (place_of_worship, museum, ...) -- we
# only keep one broad category per place, not the full types[] list the old
# project had.
TYPE_DURATION_MAP = {
    "พิพิธภัณฑ์": 90, "วัด": 45, "สวนสาธารณะ": 60,
    "ตลาด": 120, "ร้านอาหาร": 60, "คาเฟ่": 45, "สถานที่ท่องเที่ยว": 60,
}

BUFFET_KEYWORDS = ["หมูกระทะ", "ปิ้งย่าง", "บุฟเฟต์", "สุกี้", "ตี๋น้อย", "buffet", "barbecue", "bbq"]
EVENING_KEYWORDS = ["หมูกระทะ", "ปิ้งย่าง", "บุฟเฟต์", "สุกี้", "ตี๋น้อย", "บาร์", "ตลาดกลางคืน"]
PRICE_MAP = {0: 0, 1: 150, 2: 400, 3: 800, 4: 1500}

# A place counts as a scheduling "anchor" (its time slot gets fixed before
# anything else is arranged around it) only if its real opening window that
# day is this narrow or narrower -- a place open 09:00-21:00 isn't a
# meaningful time constraint, a morning market open 06:00-09:00 is.
ANCHOR_MAX_WINDOW_MINUTES = 180

# Preferred time-of-day windows, in minutes-since-midnight, used as a SOFT
# cost during scheduling (never a hard filter -- real opening hours and the
# trip's end_time remain the only hard constraints, enforced by
# check_is_open()/_simulate_day_walk()). This is what stops "lunch at 3pm"
# and "temple visit at 8pm" from being scheduling-legal-but-nonsensical.
MEAL_LUNCH_WINDOW = (11 * 60, 13 * 60 + 30)
MEAL_DINNER_WINDOW = (17 * 60 + 30, 20 * 60)
CAFE_WINDOW = (13 * 60, 17 * 60)
ATTRACTION_WINDOW = (8 * 60, 15 * 60)
MARKET_EVENING_WINDOW = (17 * 60, 21 * 60)
ATTRACTION_CATEGORIES = ("วัด", "สถานที่ท่องเที่ยว", "พิพิธภัณฑ์", "สวนสาธารณะ")

# Cost-function weights for cheapest-insertion/Or-opt: how many detour-km one
# minute outside a place's preferred window is "worth". 1/15 means 15
# minutes off-window is roughly as bad as a 1km detour -- tunable, chosen to
# keep geography and time-of-day both meaningfully influential without
# either one completely dominating the other.
DISTANCE_WEIGHT = 1.0
TIME_PENALTY_PER_MIN = 1.0 / 15.0
# Applied per stop that a candidate route fails to fit at all (dropped by
# _simulate_day_walk) -- large enough that cheapest-insertion/Or-opt never
# prefers a cheaper-but-drops-a-stop route over a pricier-but-complete one.
DROPPED_STOP_PENALTY = 1000.0

ASSUMED_SPEED_KMH = 30.0


def calculate_distance(loc1: Place, loc2: Place) -> float:
    R = 6371
    dlat = math.radians(loc2.latitude - loc1.latitude)
    dlon = math.radians(loc2.longitude - loc1.longitude)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(loc1.latitude)) * math.cos(math.radians(loc2.latitude)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def travel_minutes(dist_km: float) -> int:
    return int((dist_km / ASSUMED_SPEED_KMH) * 60)


def get_visit_duration(loc: Place, pace: str) -> int:
    name_lower = loc.name.lower()
    if any(kw in name_lower for kw in BUFFET_KEYWORDS):
        return 120

    base_duration = TYPE_DURATION_MAP.get(loc.category, 60)

    if pace == "relaxed":
        return base_duration + 30
    elif pace == "packed":
        return max(30, base_duration - 15)
    return base_duration


def is_evening_place(loc: Place) -> bool:
    name_lower = loc.name.lower()
    return any(kw in name_lower for kw in EVENING_KEYWORDS)


def _periods_for_weekday(loc: Place, google_day: int) -> List[dict]:
    if not loc.hours_periods:
        return []
    return [p for p in loc.hours_periods if p["open"]["day"] == google_day]


def check_is_open(loc: Place, arrival_dt: datetime) -> dict:
    """Check whether `loc` is open at `arrival_dt`. Needs the raw Google
    `periods` data (places.hours_periods) -- `loc.hours` is only a
    formatted display string, not usable for this.

    Handles multiple periods for the same day (e.g. split lunch/dinner
    hours) and overnight periods (close.day == open.day + 1) uniformly by
    walking every period for the day and keeping the best match, instead of
    returning on whichever period happens to be listed first -- a place
    with both a 09:00-12:00 slot and a 20:00-02:00 slot listed in that
    order used to have the overnight slot's "Waiting until 20:00" answer
    win even for a 10:00 arrival that the first slot already covers.

    A period matching "yesterday's" overnight hours spilling into this
    morning (open.day == google_day - 1, close.day == google_day) is a
    real, separate gap this does not attempt to cover -- it would require
    looking at the previous day's periods too, not just today's.
    """
    if not loc.hours_periods:
        return {"is_open": True, "wait_min": 0, "status": "Open (No Data)"}

    # Google Maps: 0=Sunday, 1=Monday... | Python: 0=Monday, 6=Sunday
    google_day = (arrival_dt.weekday() + 1) % 7
    arrival_minutes = arrival_dt.hour * 60 + arrival_dt.minute

    today_periods = _periods_for_weekday(loc, google_day)
    if not today_periods:
        return {"is_open": False, "wait_min": 0, "status": "Closed Today"}

    best_wait = None
    for p in today_periods:
        open_min = p["open"]["hour"] * 60 + p["open"]["minute"]
        if "close" in p and p["close"]["day"] == google_day:
            close_min = p["close"]["hour"] * 60 + p["close"]["minute"]
        else:
            # Overnight hours (closes after midnight, on the following
            # day) -- for a same-day arrival check, the window simply runs
            # to the end of this calendar day.
            close_min = 24 * 60

        if open_min <= arrival_minutes < close_min:
            return {"is_open": True, "wait_min": 0, "status": "Open"}
        elif arrival_minutes < open_min:
            wait = open_min - arrival_minutes
            if best_wait is None or wait < best_wait:
                best_wait = wait

    if best_wait is not None:
        return {"is_open": False, "wait_min": best_wait, "status": "Waiting"}
    return {"is_open": False, "wait_min": 0, "status": "Closed"}


def find_anchor_window(loc: Place, day_date: date) -> Optional[Tuple[int, int]]:
    """A place is a fixed-time scheduling anchor if it has exactly one
    opening period on this calendar date and that period is narrow enough
    (<= ANCHOR_MAX_WINDOW_MINUTES) to be a real constraint, e.g. a morning
    market open 06:00-09:00. Returns (open_min, close_min) in
    minutes-since-midnight, or None if the place isn't an anchor (no hours
    data, multiple periods that day, or a wide/all-day window)."""
    if not loc.hours_periods:
        return None
    google_day = (day_date.weekday() + 1) % 7
    periods = _periods_for_weekday(loc, google_day)
    if len(periods) != 1:
        return None
    p = periods[0]
    open_min = p["open"]["hour"] * 60 + p["open"]["minute"]
    if "close" in p and p["close"]["day"] == google_day:
        close_min = p["close"]["hour"] * 60 + p["close"]["minute"]
    else:
        # Overnight window -- open-ended for our purposes, not a narrow
        # anchor.
        return None
    if close_min - open_min <= ANCHOR_MAX_WINDOW_MINUTES:
        return (open_min, close_min)
    return None


def preferred_time_window(loc: Place, meal_role: Optional[str] = None) -> Optional[Tuple[int, int]]:
    """Soft "should land around this time of day" window per category, in
    minutes-since-midnight. None means no preference (fully flexible)."""
    if loc.category == "ร้านอาหาร":
        if meal_role == "dinner":
            return MEAL_DINNER_WINDOW
        if meal_role == "lunch":
            return MEAL_LUNCH_WINDOW
        if is_evening_place(loc):
            return MEAL_DINNER_WINDOW
        # No role assigned and not an evening-only spot: any mealtime is
        # fine, union of lunch..dinner.
        return (MEAL_LUNCH_WINDOW[0], MEAL_DINNER_WINDOW[1])
    if loc.category == "คาเฟ่":
        return CAFE_WINDOW
    if loc.category in ATTRACTION_CATEGORIES:
        return ATTRACTION_WINDOW
    if loc.category == "ตลาด" and is_evening_place(loc):
        return MARKET_EVENING_WINDOW
    return None


def _simulate_day_walk(
    ordered_places: List[Place], hotel: Place, day_date: date,
    start_dt: datetime, end_dt_bound: datetime, pace: str,
) -> List[dict]:
    """Walk `ordered_places` in the given order starting from `hotel` at
    `start_dt`. Returns one dict per stop that's actually feasible (arrives
    before `end_dt_bound`, isn't closed, AND can still get back to `hotel`
    by `end_dt_bound` -- see the trim loop below) -- infeasible stops are
    silently skipped, same "drop rather than show a doomed visit" policy the
    old single-pass backstop used. Shared by both the cheapest-insertion/
    Or-opt cost function and the final schedule materialization, so the two
    can't drift apart."""
    stops = []
    current_loc = hotel
    current_dt = start_dt
    for place in ordered_places:
        if current_dt >= end_dt_bound:
            continue
        dist = calculate_distance(current_loc, place) if current_loc else 0.0
        travel_min = travel_minutes(dist) if current_loc else 0
        arrival_at_door = current_dt + timedelta(minutes=travel_min)
        if arrival_at_door >= end_dt_bound:
            continue

        open_info = check_is_open(place, arrival_at_door)
        if open_info["status"] in ("Closed", "Closed Today"):
            continue

        wait_min = open_info["wait_min"] if open_info["status"] == "Waiting" else 0
        start_activity_dt = arrival_at_door + timedelta(minutes=wait_min)
        if start_activity_dt >= end_dt_bound:
            continue

        visit_min = get_visit_duration(place, pace)
        departure_dt = start_activity_dt + timedelta(minutes=visit_min)

        stops.append({
            "place": place, "dist": dist, "travel_min": travel_min,
            "arrival_at_door": arrival_at_door, "wait_min": wait_min,
            "start_activity_dt": start_activity_dt, "departure_dt": departure_dt,
            "open_info": open_info,
        })
        current_loc = place
        current_dt = departure_dt

    # Every stop above only checked that ARRIVING there fit before
    # end_dt_bound -- a far-out place (e.g. a same-day round trip well
    # outside the city) can still pass that check yet leave the return-to-
    # hotel leg landing hours after end_dt_bound, since that leg was never
    # bound-checked anywhere. Trim from the end until the day can actually
    # get back to the hotel by end_dt_bound; may cascade (the new last stop
    # can itself be too far) so this repeats, not just runs once.
    while stops and hotel:
        last = stops[-1]
        return_travel = travel_minutes(calculate_distance(last["place"], hotel))
        if last["departure_dt"] + timedelta(minutes=return_travel) <= end_dt_bound:
            break
        stops.pop()
    return stops


def _route_cost(
    route: List[Place], hotel: Place, day_date: date,
    start_dt: datetime, end_dt_bound: datetime, pace: str,
    meal_roles: Dict[str, str],
) -> float:
    stops = _simulate_day_walk(route, hotel, day_date, start_dt, end_dt_bound, pace)
    surviving_ids = {s["place"].id for s in stops}
    total = DROPPED_STOP_PENALTY * sum(1 for p in route if p.id not in surviving_ids)
    for s in stops:
        total += s["dist"] * DISTANCE_WEIGHT
        window = preferred_time_window(s["place"], meal_roles.get(s["place"].id))
        if window:
            lo, hi = window
            arrival_min = s["arrival_at_door"].hour * 60 + s["arrival_at_door"].minute
            if arrival_min < lo:
                total += (lo - arrival_min) * TIME_PENALTY_PER_MIN
            elif arrival_min > hi:
                total += (arrival_min - hi) * TIME_PENALTY_PER_MIN
    return total


def order_day_stops(
    day_places: List[Place], hotel: Place, day_date: date,
    start_time_of_day: time, end_time_of_day: time, pace: str,
    meal_roles: Optional[Dict[str, str]] = None,
) -> List[Place]:
    """Order one day's places using real geography and real opening hours:
    fixed-time anchors (narrow real opening windows) are placed first as a
    skeleton in window order, then remaining stops are added one at a time
    at their cheapest-insertion position (least added travel distance +
    time-of-day-window penalty), then polished with an Or-opt pass
    (single-stop relocation -- not 2-opt, since 2-opt's segment reversal
    would flip anchors out of their required forward time order).

    Never raises on an infeasible input -- anchors that can't be reached in
    time get demoted back to flexible stops, and flexible stops that can't
    fit anywhere get dropped (final drop/keep decision belongs to
    materialize_day_schedule's real simulation, this function only decides
    order)."""
    meal_roles = meal_roles or {}
    start_dt = datetime.combine(day_date, start_time_of_day)
    end_dt_bound = datetime.combine(day_date, end_time_of_day)

    anchors: List[Tuple[Place, Tuple[int, int]]] = []
    flexible: List[Place] = []
    for p in day_places:
        window = find_anchor_window(p, day_date)
        if window:
            anchors.append((p, window))
        else:
            flexible.append(p)
    anchors.sort(key=lambda pair: pair[1][0])

    route: List[Place] = []
    prev_place: Optional[Place] = None
    prev_departure_min: Optional[int] = None
    for place, (open_min, close_min) in anchors:
        if prev_place is not None:
            dist = calculate_distance(prev_place, place)
            earliest_arrival_min = prev_departure_min + travel_minutes(dist)
            if earliest_arrival_min >= close_min:
                # Can't make it from the previous anchor in time -- demote
                # instead of producing an impossible schedule.
                flexible.append(place)
                continue
            arrival_min = max(open_min, earliest_arrival_min)
        else:
            arrival_min = open_min
        route.append(place)
        prev_departure_min = arrival_min + get_visit_duration(place, pace)
        prev_place = place

    # Once the skeleton is built, nothing may be inserted ahead of its first
    # stop when that first stop is a real anchor -- a flexible detour is
    # never allowed to eat into a time-critical anchor's buffer just
    # because the raw distance/window cost happens to look cheaper.
    # Insertion between/after anchors is still free.
    anchor_skeleton_ids = {p.id for p in route}
    min_insert_pos = 1 if anchor_skeleton_ids else 0

    # Cheapest insertion: repeatedly insert the (place, position) pair with
    # the lowest cost across everything still remaining. A position is only
    # a candidate if the newly-inserted place survives there AND every
    # place that was already committed to `route` in an earlier round still
    # survives too -- a later, lower-priority place is never allowed to
    # bump an already-committed one out of the day just because it happens
    # to slot in cheaply; if nothing fits without evicting a committed stop,
    # it's dropped instead (mirrors the old single-pass backstop's
    # first-come-first-served drop policy, just applied per candidate
    # instead of per LLM-given order). Route length is monotonically
    # non-decreasing, so once nothing remaining is feasible anywhere,
    # nothing ever will be -- safe to stop.
    #
    # Ties (e.g. several candidates at genuinely equal distance/window cost)
    # are broken by how close the position is to where the place would
    # naturally fall if the day's places were simply kept in their given
    # order, then by that given order itself -- so when geography/timing
    # truly don't distinguish two arrangements, the result stays the
    # day-assignment order instead of shuffling arbitrarily.
    remaining = list(flexible)
    orig_index = {p.id: i for i, p in enumerate(day_places)}
    while remaining:
        baseline_ids = {s["place"].id for s in _simulate_day_walk(route, hotel, day_date, start_dt, end_dt_bound, pace)}
        best_key = None
        best_place = None
        best_pos = None
        for place in remaining:
            natural_pos = sum(1 for r in route if orig_index.get(r.id, 0) < orig_index.get(place.id, 0))
            for pos in range(min_insert_pos, len(route) + 1):
                candidate = route[:pos] + [place] + route[pos:]
                survive_ids = {s["place"].id for s in _simulate_day_walk(candidate, hotel, day_date, start_dt, end_dt_bound, pace)}
                if place.id not in survive_ids or not baseline_ids.issubset(survive_ids):
                    continue  # infeasible, or would evict an already-committed stop
                cost = _route_cost(candidate, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles)
                key = (round(cost, 6), abs(pos - natural_pos), orig_index.get(place.id, 0))
                if best_key is None or key < best_key:
                    best_key, best_place, best_pos = key, place, pos
        if best_place is None:
            logger.info("trip planner: could not fit %d remaining place(s) into the day, dropping", len(remaining))
            break
        route = route[:best_pos] + [best_place] + route[best_pos:]
        remaining.remove(best_place)

    anchor_ids = {p.id for p, _ in anchors if p in route}
    return _or_opt_polish(route, anchor_ids, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles)


def _or_opt_polish(
    route: List[Place], anchor_ids: set, hotel: Place, day_date: date,
    start_dt: datetime, end_dt_bound: datetime, pace: str,
    meal_roles: Dict[str, str],
) -> List[Place]:
    """Single-stop relocation local search: try moving each non-anchor stop
    to every other position, keep the move if it strictly reduces total
    route cost. Bounded to a handful of passes -- at n<=8 stops/day this
    converges almost immediately."""
    # Same rule as the insertion phase: never relocate a stop to position 0
    # if the day starts with a real anchor -- Or-opt must not undo the
    # insertion phase's "don't eat into the first anchor's buffer" rule
    # just because raw cost looks cheaper there.
    min_pos = 1 if anchor_ids else 0
    for _ in range(10):
        improved = False
        for i, place in enumerate(route):
            if place.id in anchor_ids:
                continue
            without = route[:i] + route[i + 1:]
            base_cost = _route_cost(route, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles)
            for pos in range(min_pos, len(without) + 1):
                if pos == i:
                    continue
                candidate = without[:pos] + [place] + without[pos:]
                cost = _route_cost(candidate, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles)
                if cost < base_cost - 1e-6:
                    route = candidate
                    improved = True
                    break
            if improved:
                break
        if not improved:
            break
    return route


# Any single idle stretch longer than this -- before the first stop,
# between two consecutive stops, or after the last stop and before
# end_time_of_day -- triggers backfill. A safety net for a day left with a
# large unplanned gap anywhere in it (e.g. lunch, then nothing until a
# single 17:00 stop), not a packer that fights a relaxed pace's intentional
# idle time.
UNDERFILLED_GAP_MINUTES = 180
# Absolute cap on stops in one day, regardless of how much daylight backfill
# still finds underfilled -- matches _or_opt_polish's documented n<=8
# convergence assumption. Tops a sparse day up to "reasonable", it doesn't
# repack it solid.
MAX_STOPS_PER_DAY = 8


def _largest_gap_minutes(stops: List[dict], start_dt: datetime, end_dt_bound: datetime) -> float:
    """Biggest idle stretch anywhere in a simulated day: before the first
    stop, between two consecutive stops, or after the last stop and before
    end_dt_bound. Travel time is not idle time and is excluded -- only the
    time spent neither traveling nor visiting counts."""
    prev_departure = start_dt
    largest = 0.0
    for s in stops:
        gap = (s["arrival_at_door"] - prev_departure).total_seconds() / 60 - s["travel_min"]
        largest = max(largest, gap)
        prev_departure = s["departure_dt"]
    largest = max(largest, (end_dt_bound - prev_departure).total_seconds() / 60)
    return largest


def _find_best_backfill_insertion(
    route: List[Place], hotel: Place, day_date: date,
    start_dt: datetime, end_dt_bound: datetime, pace: str,
    meal_roles: Dict[str, str], backfill_pool: List[Place],
) -> Tuple[Optional[Place], Optional[int]]:
    """Cheapest (place, position) to insert from `backfill_pool` into
    `route`, or (None, None) if nothing in the pool fits anywhere without
    becoming infeasible or evicting an already-committed stop. Shared by
    backfill_underfilled_day (saturates one day) and
    backfill_underfilled_trip (spreads insertions across days) so the two
    can't drift apart on what counts as a valid insertion."""
    baseline_ids = {s["place"].id for s in _simulate_day_walk(route, hotel, day_date, start_dt, end_dt_bound, pace)}
    best_key = None
    best_place = None
    best_pos = None
    for place in backfill_pool:
        for pos in range(len(route) + 1):
            candidate = route[:pos] + [place] + route[pos:]
            survive_ids = {s["place"].id for s in _simulate_day_walk(candidate, hotel, day_date, start_dt, end_dt_bound, pace)}
            if place.id not in survive_ids or not baseline_ids.issubset(survive_ids):
                continue  # infeasible, or would evict an already-committed stop
            cost = _route_cost(candidate, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles)
            key = (round(cost, 6), place.id)
            if best_key is None or key < best_key:
                best_key, best_place, best_pos = key, place, pos
    return best_place, best_pos


def backfill_underfilled_day(
    route: List[Place], meal_roles: Dict[str, str], hotel: Place,
    day_date: date, start_time_of_day: time, end_time_of_day: time, pace: str,
    backfill_pool: List[Place],
) -> List[Place]:
    """Deterministic backstop for when the LLM under-selects places for a
    day (see orchestrator.py's candidate-quota sizing): route ordering and
    time-of-day windows can be entirely correct while the day still has a
    large idle stretch -- trailing (day ends hours before end_time_of_day)
    or in the middle (e.g. lunch, then nothing until a single late stop).
    Tops the day up from `backfill_pool` (places not used anywhere else in
    the trip -- mutated in place, consumed places are removed so other days
    can't reuse them) using the same cheapest-insertion cost function as
    the LLM's own picks, until every gap is <= UNDERFILLED_GAP_MINUTES, the
    day hits MAX_STOPS_PER_DAY, or nothing in the pool fits anywhere --
    closes stretches nothing was scheduled to fill, not an aggressive
    re-pack.

    Single-day only -- saturates this one day completely before returning.
    For a multi-day trip sharing one `backfill_pool` across days, prefer
    backfill_underfilled_trip instead: calling this per day in day-number
    order lets an early day exhaust a limited pool before later days get a
    turn (confirmed live on a 3-day request where day 1 alone consumed the
    pool down to nothing, leaving days 2-3 with multi-hour dead
    stretches)."""
    if not backfill_pool:
        return route

    start_dt = datetime.combine(day_date, start_time_of_day)
    end_dt_bound = datetime.combine(day_date, end_time_of_day)
    added = 0

    while len(route) < MAX_STOPS_PER_DAY:
        stops = _simulate_day_walk(route, hotel, day_date, start_dt, end_dt_bound, pace)
        if _largest_gap_minutes(stops, start_dt, end_dt_bound) < UNDERFILLED_GAP_MINUTES:
            break

        best_place, best_pos = _find_best_backfill_insertion(
            route, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, backfill_pool,
        )
        if best_place is None:
            break  # nothing in the pool fits the remaining gap
        route = route[:best_pos] + [best_place] + route[best_pos:]
        backfill_pool.remove(best_place)
        added += 1

    if not added:
        return route
    anchor_ids = {p.id for p in route if find_anchor_window(p, day_date)}
    return _or_opt_polish(route, anchor_ids, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles)


def backfill_underfilled_trip(
    routes: Dict[int, List[Place]], day_dates: Dict[int, date], meal_roles: Dict[str, str],
    hotel: Place, start_time_of_day: time, end_time_of_day: time, pace: str,
    backfill_pool: List[Place],
) -> Dict[int, List[Place]]:
    """Cross-day counterpart of backfill_underfilled_day: each round finds
    the single day with the largest idle gap across the WHOLE trip (not
    just one day) and adds one candidate to just that day, then
    reconsiders every day from scratch -- instead of saturating day 1
    before day 2 gets a turn, which can starve later days when
    `backfill_pool` is limited (see backfill_underfilled_day's docstring).
    Mirrors the "exchange activities between days" idea hybrid
    LLM-optimization trip planners use for balancing multi-day itineraries
    (e.g. Google Research's local-search set-packing approach), scaled
    down to this codebase's per-day cheapest-insertion cost function
    instead of a full multi-day solver.

    `routes` is a day_num -> route dict of already-ordered
    (order_day_stops) routes, one per day, not yet materialized into a
    schedule. Returns a same-shape dict; `backfill_pool` is mutated as
    usual."""
    if not backfill_pool:
        return routes

    start_dts = {d: datetime.combine(day_dates[d], start_time_of_day) for d in routes}
    end_dts = {d: datetime.combine(day_dates[d], end_time_of_day) for d in routes}
    changed_days = set()
    # Days where nothing in the pool fits anymore -- without this, a day
    # that's out of feasible insertions but still has the largest gap would
    # be picked again every round, starving progress on every other day.
    stuck_days = set()

    while True:
        best_day, best_gap = None, 0.0
        for day_num, route in routes.items():
            if day_num in stuck_days or len(route) >= MAX_STOPS_PER_DAY:
                continue
            stops = _simulate_day_walk(route, hotel, day_dates[day_num], start_dts[day_num], end_dts[day_num], pace)
            gap = _largest_gap_minutes(stops, start_dts[day_num], end_dts[day_num])
            if gap > best_gap:
                best_day, best_gap = day_num, gap
        if best_day is None or best_gap < UNDERFILLED_GAP_MINUTES:
            break

        route = routes[best_day]
        day_date, start_dt, end_dt_bound = day_dates[best_day], start_dts[best_day], end_dts[best_day]
        best_place, best_pos = _find_best_backfill_insertion(
            route, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, backfill_pool,
        )
        if best_place is None:
            stuck_days.add(best_day)  # this day's gap can't be closed with what's left -- try others
            continue
        routes[best_day] = route[:best_pos] + [best_place] + route[best_pos:]
        backfill_pool.remove(best_place)
        changed_days.add(best_day)

    for day_num in changed_days:
        anchor_ids = {p.id for p in routes[day_num] if find_anchor_window(p, day_dates[day_num])}
        routes[day_num] = _or_opt_polish(
            routes[day_num], anchor_ids, hotel, day_dates[day_num],
            start_dts[day_num], end_dts[day_num], pace, meal_roles,
        )
    return routes


def reassign_infeasible_days(
    day_assignments: Dict[int, List[Place]], trip_start_date: date, trip_duration_days: int,
) -> Dict[int, List[Place]]:
    """If the LLM assigned a place to a day of the week it's actually
    closed on, move it to another day of the trip it's open on; drop it if
    it's closed on every day of the trip. Purely a day-of-week feasibility
    fix (checked at a representative midday time) -- intra-day timing is
    the anchor system's job, not this function's."""
    result: Dict[int, List[Place]] = {day: list(places) for day, places in day_assignments.items()}
    for day_num, places in list(day_assignments.items()):
        day_date = trip_start_date + timedelta(days=day_num - 1)
        noon = datetime.combine(day_date, time(12, 0))
        for place in list(places):
            if not place.hours_periods:
                continue
            if check_is_open(place, noon)["status"] != "Closed Today":
                continue
            moved = False
            for other_day in range(1, trip_duration_days + 1):
                if other_day == day_num:
                    continue
                other_date = trip_start_date + timedelta(days=other_day - 1)
                other_noon = datetime.combine(other_date, time(12, 0))
                if check_is_open(place, other_noon)["status"] != "Closed Today":
                    result[day_num].remove(place)
                    result.setdefault(other_day, []).append(place)
                    moved = True
                    logger.info("trip planner: moved %s from day %d to day %d (closed on original day)", place.name, day_num, other_day)
                    break
            if not moved:
                result[day_num].remove(place)
                logger.info("trip planner: dropping %s, closed every day of the trip", place.name)
    return result


def materialize_day_schedule(
    route: List[Place], anchor_ids: set, meal_roles: Dict[str, str], hotel: Place,
    day_date: date, start_time_of_day: time, end_time_of_day: time, pace: str,
) -> Tuple[List[TimeSlot], float, int]:
    """Walk the already-ordered `route` and build the final TimeSlot list:
    real arrival/departure/wait times, "free time" filler blocks for gaps
    > 45min, per-stop fuel + place cost, and a return-to-hotel leg at the
    end of every day (including the last -- a trip's final day still ends
    back at the accommodation, same as every other day)."""
    schedule: List[TimeSlot] = []
    current_loc = hotel
    current_dt = datetime.combine(day_date, start_time_of_day)
    end_dt_bound = datetime.combine(day_date, end_time_of_day)
    day_cost = 0.0
    day_travel = 0

    for place in route:
        if current_dt >= end_dt_bound:
            break

        dist = 0.0
        travel_min = 0
        if current_loc:
            dist = calculate_distance(current_loc, place)
            travel_min = travel_minutes(dist)

        arrival_at_door = current_dt + timedelta(minutes=travel_min)
        open_info = check_is_open(place, arrival_at_door)

        if open_info["status"] in ("Closed", "Closed Today"):
            logger.info("trip planner: dropping %s, %s at %s", place.name, open_info["status"], arrival_at_door)
            continue

        gap_minutes = 0
        role = meal_roles.get(place.id)
        meal_window = preferred_time_window(place, role) if place.category == "ร้านอาหาร" and role else None

        # Two independent constraints can each push the start time later:
        # the place's own real opening hours (open_info "Waiting") and a
        # "lunch"/"dinner" meal_role's target window. These used to be
        # elif branches -- only one ever applied -- which let a restaurant
        # that happens to open earlier than its meal_role's window get
        # seated right when it opens, with the meal_role tag now
        # meaningless (a "dinner"-tagged place open since 10:00 getting
        # seated at 10:19 because the 19-minute "Waiting" for it to open
        # took priority over the still-unmet dinner window entirely).
        # Whichever constraint requires waiting longer wins.
        wait_candidates = []
        if open_info["status"] == "Waiting":
            wait_candidates.append(open_info["wait_min"])
        if meal_window and arrival_at_door.hour * 60 + arrival_at_door.minute < meal_window[0]:
            # A restaurant explicitly tagged "lunch"/"dinner" that would
            # otherwise land well before its mealtime (e.g. a "dinner" spot
            # arrived at straight after lunch) waits for its window instead
            # of just eating whenever the route happens to pass by --
            # otherwise the ordering-phase cost penalty (see
            # preferred_time_window/_route_cost) only shapes WHICH slot a
            # meal lands in, not WHEN, so "dinner" could still land at
            # 16:00 if nothing else filled the afternoon.
            target_dt = arrival_at_door.replace(hour=meal_window[0] // 60, minute=meal_window[0] % 60, second=0, microsecond=0)
            wait_candidates.append(int((target_dt - arrival_at_door).total_seconds() / 60))
        if wait_candidates:
            gap_minutes = max(wait_candidates)
        elif is_evening_place(place) and arrival_at_door.hour < 17:
            target_dt = arrival_at_door.replace(hour=17, minute=0, second=0)
            gap_minutes = int((target_dt - arrival_at_door).total_seconds() / 60)

        wait_min = 0
        if gap_minutes > 45:
            dummy_loc = Place(
                id="free_time_dummy", name="☕ พักผ่อนตามอัธยาศัย / แวะเดินเล่นชิลๆ",
                category=None, rating=0.0,
                lat=current_loc.latitude if current_loc else place.latitude,
                lng=current_loc.longitude if current_loc else place.longitude,
            )
            free_departure = current_dt + timedelta(minutes=gap_minutes)
            schedule.append(TimeSlot(
                place=dummy_loc, arrival_time=current_dt.strftime("%H:%M"),
                departure_time=free_departure.strftime("%H:%M"),
                travel_time_min=0, distance_km=0.0, status="Free Time", wait_time_min=0,
            ))
            current_dt = free_departure
            arrival_at_door = current_dt + timedelta(minutes=travel_min)
            open_info = check_is_open(place, arrival_at_door)
            wait_min = open_info["wait_min"] if open_info["status"] == "Waiting" else 0
        else:
            wait_min = gap_minutes

        start_activity_dt = arrival_at_door + timedelta(minutes=wait_min)
        visit_min = get_visit_duration(place, pace)
        departure_dt = start_activity_dt + timedelta(minutes=visit_min)

        schedule.append(TimeSlot(
            place=place, arrival_time=arrival_at_door.strftime("%H:%M"),
            departure_time=departure_dt.strftime("%H:%M"), travel_time_min=travel_min,
            distance_km=round(dist, 2), status=open_info["status"] if wait_min == 0 else "Waiting",
            wait_time_min=wait_min, is_anchor=place.id in anchor_ids,
            meal_role=meal_roles.get(place.id),
        ))

        fuel_cost = dist * 4.0  # 4 THB/km
        if place.price_level is not None:
            place_cost = PRICE_MAP.get(place.price_level, 150)
        elif place.category in ("ร้านอาหาร", "คาเฟ่"):
            place_cost = 250
        elif place.category == "ตลาด":
            place_cost = 300
        elif place.category in ("วัด", "สวนสาธารณะ", "พิพิธภัณฑ์"):
            place_cost = 0
        else:
            place_cost = 100

        day_cost += fuel_cost + place_cost
        day_travel += travel_min
        current_loc = place
        current_dt = departure_dt

    if current_loc and hotel:
        dist = calculate_distance(current_loc, hotel)
        travel_min = travel_minutes(dist)
        arrival_at_hotel = current_dt + timedelta(minutes=travel_min)
        schedule.append(TimeSlot(
            place=hotel, arrival_time=arrival_at_hotel.strftime("%H:%M"),
            departure_time=arrival_at_hotel.strftime("%H:%M"),
            travel_time_min=travel_min, distance_km=round(dist, 2),
            status="End of Day (Return to Hotel)", wait_time_min=0,
        ))
        day_cost += dist * 4.0
        day_travel += travel_min

    return schedule, round(day_cost, 2), day_travel


def build_day_itinerary(
    day_num: int, day_date: date, day_places: List[Place], hotel: Place,
    start_time_of_day: time, end_time_of_day: time, pace: str,
    meal_roles: Optional[Dict[str, str]] = None,
    backfill_pool: Optional[List[Place]] = None,
) -> DailyItinerary:
    meal_roles = meal_roles or {}
    route = order_day_stops(day_places, hotel, day_date, start_time_of_day, end_time_of_day, pace, meal_roles)
    if backfill_pool:
        route = backfill_underfilled_day(
            route, meal_roles, hotel, day_date, start_time_of_day, end_time_of_day, pace, backfill_pool,
        )
    anchor_ids = {p.id for p in route if find_anchor_window(p, day_date)}
    schedule, day_cost, day_travel = materialize_day_schedule(
        route, anchor_ids, meal_roles, hotel, day_date, start_time_of_day, end_time_of_day, pace,
    )
    return DailyItinerary(
        day=day_num, date=day_date.strftime("%Y-%m-%d"), schedule=schedule,
        day_cost_estimate=day_cost, day_travel_time_total=day_travel,
    )
