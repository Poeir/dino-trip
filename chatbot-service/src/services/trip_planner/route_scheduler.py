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

from . import pricing
from .models import DailyItinerary, Place, TimeSlot
from .trip_ends import TRIP_END_STATUS

logger = logging.getLogger(__name__)

# Category-based visit durations, keyed by our normalized Thai categories
# instead of Google's raw type slugs (place_of_worship, museum, ...) -- we
# only keep one broad category per place, not the full types[] list the old
# project had.
#
# Reviewed 2026-10-21 against 30 live trips:
# - อุทยานแห่งชาติ had no entry, so Phu Wiang National Park (a 70 km drive)
#   got the 60-minute default; 2 hours is a short visit to a national park.
# - พิพิธภัณฑ์ 90 -> 75: Khon Kaen's museums are mostly small (median 164
#   reviews); 90 also went to an outdoor dinosaur-footprint site.
# - ตลาด is split by market_kind in get_visit_duration: an evening market is
#   where the evening is spent (EVENING_MARKET_MINUTES), a daytime market is a
#   walk through (this entry); a 2-hour daytime market read as padding.
TYPE_DURATION_MAP = {
    "พิพิธภัณฑ์": 75, "วัด": 45, "สวนสาธารณะ": 60, "อุทยานแห่งชาติ": 120,
    "ตลาด": 60, "ร้านอาหาร": 60, "คาเฟ่": 45, "สถานที่ท่องเที่ยว": 60,
    "ห้างสรรพสินค้า": 90,
    # A souvenir shop is a quick stop to buy something, not a place to spend
    # the afternoon (as "ตลาด" one of them was booked for two hours).
    "ร้านของฝาก": 30,
}
# An evening market visited as the evening itself (no dinner restaurant that
# day). After a dinner it's MARKET_AFTER_DINNER_MINUTES instead.
EVENING_MARKET_MINUTES = 120
# Buffet / grill-it-yourself meals take longer than a plate of food, but two
# hours for lunch (live: a sukiyaki lunch 11:30-13:30) ate half the afternoon.
BUFFET_MINUTES = 90

BUFFET_KEYWORDS = ["หมูกระทะ", "ปิ้งย่าง", "บุฟเฟต์", "สุกี้", "ตี๋น้อย", "buffet", "barbecue", "bbq"]
EVENING_KEYWORDS = ["หมูกระทะ", "ปิ้งย่าง", "บุฟเฟต์", "สุกี้", "ตี๋น้อย", "บาร์", "ตลาดกลางคืน"]
PRICE_MAP = {0: 0, 1: 150, 2: 400, 3: 800, 4: 1500}

# Google's operating-status values that mean "closed regardless of what the
# scraped weekly hours say" -- a business that's shut down doesn't reopen
# just because hours_periods (scraped once, not re-verified) still lists a
# normal week. OPERATIONAL and None/unknown both fall through to the normal
# hours_periods-based check.
CLOSED_BUSINESS_STATUSES = {"CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"}


def _is_business_closed(loc: Place) -> bool:
    return loc.business_status in CLOSED_BUSINESS_STATUSES

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
# Lunch from 11:30: an 11:00 floor let a lunch be seated at 10:30-11:00 on
# live trips (2026-10-21), which reads as brunch, not lunch.
MEAL_LUNCH_WINDOW = (11 * 60 + 30, 13 * 60 + 30)
MEAL_DINNER_WINDOW = (17 * 60 + 30, 20 * 60)
# Only planned when the traveller picks the "อาหารเช้า" food choice (otherwise
# breakfast is assumed at the accommodation). Ends 09:45: a day starting at
# 10:00 has no breakfast stop.
MEAL_BREAKFAST_WINDOW = (7 * 60, 9 * 60 + 45)
MEAL_WINDOWS = {"breakfast": MEAL_BREAKFAST_WINDOW, "lunch": MEAL_LUNCH_WINDOW, "dinner": MEAL_DINNER_WINDOW}
CAFE_WINDOW = (13 * 60, 17 * 60)
ATTRACTION_WINDOW = (8 * 60, 15 * 60)
MARKET_EVENING_WINDOW = (17 * 60, 21 * 60)
MARKET_MORNING_WINDOW = (6 * 60, 9 * 60 + 30)
ATTRACTION_CATEGORIES = ("วัด", "สถานที่ท่องเที่ยว", "พิพิธภัณฑ์", "สวนสาธารณะ", "อุทยานแห่งชาติ")

# Cost-function weights for cheapest-insertion/Or-opt: how many detour-km one
# minute outside a place's preferred window is "worth". 1/15 means 15
# minutes off-window is roughly as bad as a 1km detour -- tunable, chosen to
# keep geography and time-of-day both meaningfully influential without
# either one completely dominating the other.
DISTANCE_WEIGHT = 1.0
TIME_PENALTY_PER_MIN = 1.0 / 15.0
# Minutes spent waiting at a door (for opening time, or a meal's start) cost
# the same as minutes off-window. Without it waiting was free to the
# optimizer: live trips arrived at lunch at 10:30 and sat until it opened
# rather than visit something first.
WAIT_PENALTY_PER_MIN = 1.0 / 15.0
# A lunch/dinner (meal_role set) seated after its window closes costs this
# much per minute instead of TIME_PENALTY_PER_MIN: 1 km of detour per 3
# minutes late. At the general rate a late meal was cheaper than a detour or
# a wait -- live trips ate "lunch" at 15:38 and 16:16 (2026-10-21).
MEAL_LATE_PENALTY_PER_MIN = 1.0 / 3.0
# Per stop ahead of the day's breakfast. Breakfast's window (07:00-09:45) is
# wide enough that a park could come first and breakfast after it at 09:10
# (live 2026-10-21) at no cost; breakfast is where the day starts.
BREAKFAST_NOT_FIRST_PENALTY = 20.0
# Applied per stop that a candidate route fails to fit at all (dropped by
# _simulate_day_walk) -- large enough that cheapest-insertion/Or-opt never
# prefers a cheaper-but-drops-a-stop route over a pricier-but-complete one.
DROPPED_STOP_PENALTY = 1000.0

# Per-day cap on categories that can still be added AFTER llm_extractor's own
# LLM-facing cap (MAX_CAFES_PER_DAY there) has already run -- that cap only
# constrains the LLM's initial picks. backfill_underfilled_day/_trip and
# materialize_day_schedule's gap-filler below all pull from the same shared
# candidate pool independently of it and of each other, so without a check
# here they can (and did, confirmed live) push a day to 3-4 "คาเฟ่" back to
# back even when the LLM-side pick was capped at 2. Restaurants don't need an
# entry here: they're excluded from both pools entirely (see
# llm_extractor.py's backfill_pool construction), never just capped.
CATEGORY_DAILY_CAP = {"คาเฟ่": 2}
# Every other attraction category (restaurants excepted, see above) is held
# to this many a day. Live 2026-10-21: "family + nature" days had 4-5
# parks, nearly all of them the LLM's own picks.
DEFAULT_CATEGORY_DAILY_CAP = 3


def category_daily_cap(category: Optional[str]) -> Optional[int]:
    """Max places of `category` in one day; None means uncapped (restaurants,
    which the meal logic sizes, and uncategorised placeholders)."""
    if not category or category in ("ร้านอาหาร", "ที่พัก"):
        return None
    return CATEGORY_DAILY_CAP.get(category, DEFAULT_CATEGORY_DAILY_CAP)

# Soft cost (same "detour-km equivalent" units as DISTANCE_WEIGHT/
# TIME_PENALTY_PER_MIN below) charged in _route_cost when two stops of one
# of these categories land back-to-back in a day's route. CATEGORY_DAILY_CAP
# only limits COUNT per day, not adjacency -- confirmed live: a
# budget-หรูหรา trip with a wide candidate pool regularly placed its 2
# allowed "คาเฟ่" for the day right next to each other, since
# cheapest-insertion/Or-opt had no signal telling that pairing apart from
# any other. A soft penalty (not a hard filter) lets the optimizer avoid it
# when a better arrangement exists, without risking an infeasible day or a
# dropped stop when a day's pool genuinely has nothing else to interleave.
ADJACENT_PENALTY_CATEGORIES = {"คาเฟ่"}
ADJACENT_SAME_CATEGORY_PENALTY = 5.0


def _category_count(places: List[Place], category: str) -> int:
    return sum(1 for p in places if p.category == category)


# Auto-added stops (backfill + gap-filler) are chosen by geometry, not by how
# well-reviewed a place is, so a thinly-reviewed place that is simply open 24h
# and nearby kept winning every gap (confirmed on real data: a 10-review flower
# field turned up in most city trips). Same bar as backend/scripts/fetch-places.js
# (MIN_RATING, MIN_REVIEWS) -- keep the two in sync. A tier, not a filter: places
# under the bar are only used once no trusted place fits, so a small pool
# degrades to what it had before instead of to more "free time" blocks. Missing
# values pass (old rows may simply lack them).
MIN_FILLER_RATING = 3.5
MIN_FILLER_REVIEWS = 20


def is_trustworthy_filler(place: Place) -> bool:
    rating_ok = not place.rating or place.rating >= MIN_FILLER_RATING   # None/0 = unknown
    reviews_ok = not place.review_count or place.review_count >= MIN_FILLER_REVIEWS
    return rating_ok and reviews_ok


# Spare places (Place.is_spare, built by the orchestrator) exist for trips
# whose interests can't fill a day: "อาหารพื้นถิ่น + คาเฟ่" in the city yields
# one temple, four cafes and restaurants, so a 09:00-20:00 day had 284 idle
# minutes and nothing to put in them. They are neutral places to walk around
# -- parks, lakes, landmarks, a market at its hour -- never a temple or a
# museum the traveller showed no interest in. Kept few and in their own last
# tier so the trip stays what was asked for.
MAX_SPARE_STOPS_PER_DAY = 2
# ...and one per half of the day (see _spare_half_free): without this both
# went into the morning, where they are cheapest to insert, and the evening
# the pool was meant to extend got nothing.
SPARE_HALF_DAY_SPLIT_HOUR = 12
SPARE_OUTDOOR_CATEGORIES = ("สวนสาธารณะ", "สถานที่ท่องเที่ยว")
# Start times an outdoor spare may be given: a morning walk, or one late in
# the afternoon. Midday is left alone (an assumption about the heat, not
# something measured).
SPARE_OUTDOOR_WINDOWS = ((6 * 60, 10 * 60 + 30), (16 * 60, 18 * 60 + 30))


def _spare_half_free(place: Place, start_activity_dt: datetime, other_spare_starts: List[datetime]) -> bool:
    """A spare may only be added to a half of the day (before/after
    SPARE_HALF_DAY_SPLIT_HOUR) that holds no other spare yet. Always True for
    a place that isn't a spare."""
    if not place.is_spare:
        return True
    half = start_activity_dt.hour < SPARE_HALF_DAY_SPLIT_HOUR
    return all((other.hour < SPARE_HALF_DAY_SPLIT_HOUR) != half for other in other_spare_starts)


def _filler_tiers(pool: List[Place]) -> List[List[Place]]:
    """[trusted, rest, spares] with empty tiers dropped. Callers try each
    tier in order and stop at the first that yields something."""
    own = [p for p in pool if not p.is_spare]
    trusted = [p for p in own if is_trustworthy_filler(p)]
    rest = [p for p in own if not is_trustworthy_filler(p)]
    spares = [p for p in pool if p.is_spare]
    return [t for t in (trusted, rest, spares) if t]


def _category_cap_ok(existing: List[Place], candidate: Place) -> bool:
    """Would adding `candidate` to a day that already has `existing` places
    breach CATEGORY_DAILY_CAP for its category, or MAX_SPARE_STOPS_PER_DAY
    for a spare? True (no cap, or still under it) means the candidate may be
    added."""
    if candidate.is_spare and sum(1 for p in existing if p.is_spare) >= MAX_SPARE_STOPS_PER_DAY:
        return False
    cap = category_daily_cap(candidate.category)
    if cap is None:
        return True
    return _category_count(existing, candidate.category) < cap

# A single flat speed doesn't fit both cases we route: short in-city hops
# (traffic lights, one-way streets, no highway run-up) and long intercity
# legs (mostly highway once out of town). Using one number either makes
# in-town hops read as near-teleportation or makes a highway leg to another
# district eat far more of the day than it really would -- confirmed live
# on a real itinerary where a ~0.6km cafe-to-cafe hop came out to 1 minute
# and an 81km trip to Chumphae came out to 2h37m of travel alone.
URBAN_SPEED_KMH = 25.0
INTERCITY_SPEED_KMH = 60.0
INTERCITY_THRESHOLD_KM = 15.0
# Floor under travel_minutes regardless of speed tier -- parking, walking
# from the car to the door, and traffic lights take a few minutes even
# when two places are map-adjacent; pure distance/speed arithmetic can't
# capture that and was producing 1-minute "transitions" between places a
# block apart.
MIN_TRAVEL_MINUTES = 5


def calculate_distance(loc1: Place, loc2: Place) -> float:
    R = 6371
    dlat = math.radians(loc2.latitude - loc1.latitude)
    dlon = math.radians(loc2.longitude - loc1.longitude)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(loc1.latitude)) * math.cos(math.radians(loc2.latitude)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def travel_minutes(dist_km: float) -> int:
    if dist_km <= 0:
        # Genuinely the same location (e.g. a place fixture reused as the
        # hotel in tests) -- no transition to floor.
        return 0
    speed_kmh = INTERCITY_SPEED_KMH if dist_km > INTERCITY_THRESHOLD_KM else URBAN_SPEED_KMH
    return max(MIN_TRAVEL_MINUTES, round((dist_km / speed_kmh) * 60))


def get_visit_duration(loc: Place, pace: str, day_has_dinner: bool = False) -> int:
    """Time spent at `loc`, by category only. `pace` is accepted (and still
    threaded through every scheduling function) but no longer changes the
    duration -- pace now controls how MANY attractions a day gets instead
    (see pace_stop_range), so a wat is 45 minutes whether the trip is
    relaxed or packed.

    Markets are the exception to "by category only" (see market_kind): a
    morning fresh market is a short look around, and an evening market on a
    day that also has a dinner restaurant (`day_has_dinner`) is an
    after-dinner stroll, not the two-hour evening it is when the market
    itself is where the day eats."""
    name_lower = loc.name.lower()
    if loc.category == "ร้านอาหาร" and any(kw in name_lower for kw in BUFFET_KEYWORDS):
        return BUFFET_MINUTES

    kind = market_kind(loc)
    if kind == "morning":
        return MORNING_MARKET_MINUTES
    if kind == "evening":
        return MARKET_AFTER_DINNER_MINUTES if day_has_dinner else EVENING_MARKET_MINUTES
    return TYPE_DURATION_MAP.get(loc.category, 60)


# The day's LAST stop may be visited for less than get_visit_duration when
# the full visit plus the trip back to the hotel would overrun the day's end
# -- instead of dropping it. Confirmed on a real must-go: an evening market
# (open 16:00-21:00, 120-min visit) in an 09:00-18:00 day needs 18:05 to be
# back at the hotel, so it was dropped on EVERY run no matter what the LLM
# picked, over a 5-minute shortfall. This is meant for small overruns like
# that one, not for squeezing a stop into whatever time is left: a first
# version with a 50% floor produced 30-minute dinners and 64-minute markets in
# replays of packed-pace days, so the floor is three quarters of the normal
# visit (and never below 30 minutes).
MIN_TRUNCATED_VISIT_FRACTION = 0.75
MIN_TRUNCATED_VISIT_MINUTES = 30


def _fit_last_stop_visit(
    place: Place, pace: str, start_activity_dt: datetime, return_travel_min: int, end_dt_bound: datetime,
    day_has_dinner: bool = False,
) -> Optional[int]:
    """Visit minutes for the day's last stop so the hotel is reached by
    `end_dt_bound`: the normal duration if it already fits, a shortened one
    (above the floor) if that makes it fit, else None (genuinely doesn't fit).
    Shared by _simulate_day_walk and materialize_day_schedule, which compute
    the walk independently and must agree on what survives."""
    nominal = get_visit_duration(place, pace, day_has_dinner)
    available = int((end_dt_bound - start_activity_dt).total_seconds() // 60) - return_travel_min
    if available >= nominal:
        return nominal
    floor = max(MIN_TRUNCATED_VISIT_MINUTES, math.ceil(nominal * MIN_TRUNCATED_VISIT_FRACTION))
    return available if available >= floor else None


# Average minutes per attraction INCLUDING travel to it, per pace -- divides
# a day's usable time into a target number of attractions (pace_stop_range).
# Estimates for sizing only; the real time at each stop still comes from
# get_visit_duration's per-category durations.
# Recalibrated 2026-10-21: live standard-pace days averaged ~80-85 minutes
# per attraction (visit + drive), so at 105 a 09:00-18:00 day got 4-5 and was
# back at the hotel around 15:30-16:00. Standard is now sized to fill the
# window; relaxed keeps roughly an hour and a half of slack (filled by
# longer stays, see _stretch_stays); packed is tighter than standard.
PACE_MINUTES_PER_STOP = {"relaxed": 120, "standard": 85, "packed": 65}
# Most attractions a day gets at each pace, however long the window. Without
# it a 07:00-22:00 relaxed day got 6-7 (more than a packed 09:00-18:00 day),
# while the form promises relaxed means few places. A long window's spare
# time is left as rest instead of more stops.
PACE_MAX_STOPS = {"relaxed": 4, "standard": 6, "packed": 8}
# Time reserved for one restaurant meal when the day's window covers it --
# restaurants are excluded from the attraction count, so their time is
# subtracted from the day instead.
MEAL_BREAK_MINUTES = 60
_LUNCH_WINDOW = (time(12, 0), time(13, 0))    # window must start by / end after these
_DINNER_WINDOW = (time(18, 0), time(19, 0))
# Restaurants don't count toward a pace's attraction range.
_NON_ATTRACTION_CATEGORIES = ("ร้านอาหาร",)
# Categories that order_day_stops treats as a day's meals (second priority
# tier after must-go). Same set as the non-attractions, kept as its own name
# since "doesn't count toward the pace cap" and "is a meal" are different ideas.
_MEAL_CATEGORIES = _NON_ATTRACTION_CATEGORIES


def attraction_count(places: List[Place]) -> int:
    """Places that count toward a pace's per-day range: everything except
    restaurants (cafes do count)."""
    return sum(1 for p in places if p.category not in _NON_ATTRACTION_CATEGORIES)


def pace_stop_range(pace: str, start_time_of_day: time, end_time_of_day: time, breakfast: bool = False) -> Tuple[int, int]:
    """(min, max) attractions for one day at `pace`, scaled to the day's
    window: usable minutes (window minus a meal break for each of lunch /
    dinner the window covers, and for breakfast when the trip plans one, see
    day_meals) divided by PACE_MINUTES_PER_STOP[pace], floor to ceil, never
    below 1 and never above MAX_STOPS_PER_DAY. A narrow window therefore gets
    a small range and a wide one a bigger range instead of one fixed number
    that only suits a 09:00-18:00 day."""
    window_min = (
        datetime.combine(date.min, end_time_of_day) - datetime.combine(date.min, start_time_of_day)
    ).total_seconds() / 60
    meals = 0
    if start_time_of_day <= _LUNCH_WINDOW[0] and end_time_of_day >= _LUNCH_WINDOW[1]:
        meals += 1
    if start_time_of_day <= _DINNER_WINDOW[0] and end_time_of_day >= _DINNER_WINDOW[1]:
        meals += 1
    if breakfast and meal_role_fits_window("breakfast", start_time_of_day, end_time_of_day):
        meals += 1
    usable = max(0.0, window_min - meals * MEAL_BREAK_MINUTES)
    raw = usable / PACE_MINUTES_PER_STOP.get(pace, PACE_MINUTES_PER_STOP["standard"])
    lo = max(1, math.floor(raw))
    hi = max(lo, math.ceil(raw))
    cap = min(MAX_STOPS_PER_DAY, PACE_MAX_STOPS.get(pace, MAX_STOPS_PER_DAY))
    return min(lo, cap), min(hi, cap)


def is_evening_place(loc: Place) -> bool:
    name_lower = loc.name.lower()
    return any(kw in name_lower for kw in EVENING_KEYWORDS)


def _is_always_open(loc: Place) -> bool:
    """Google's Places API represents "open 24 hours, every day of the
    week" as a SINGLE period -- {"open": {"day": 0, "hour": 0, "minute": 0}}
    with no "close" key at all -- where day 0 is a fixed sentinel, not "only
    open on Sundays" (see Places API docs on regularOpeningHours.periods).
    Filtering periods by the arrival's actual weekday, as
    _periods_for_weekday does for every real per-day schedule, only matches
    this sentinel on an actual Sunday -- confirmed live: a real 24/7 park
    got reported "closed every day of the trip" and dropped as a must-go
    place because none of the trip's calendar days happened to be a
    Sunday."""
    periods = loc.hours_periods
    return bool(periods) and len(periods) == 1 and "close" not in periods[0]


# --- markets: when do people actually go? -------------------------------------
# A market's category says nothing about its time of day, and the old
# "ตลาดกลางคืน"-in-the-name check matched 0 of the 34 live "ตลาด" rows, so
# markets had no time preference at all. Replays showed it: a night market at
# 12:15, a fresh market at 12:16 with the morning long over. People go to a
# fresh market around 06:00-09:00 and to a night market around 17:00-20:00.
#
# Opening hours decide first (13 of the 34 rows): a market that never opens
# before mid-afternoon is an evening one, one that is always shut by early
# afternoon a morning one. The rest list all-day hours (06:00-21:30 for a
# "โต้รุ่ง"), so the name decides. Anything still undecided stays None: no
# time preference, and never auto-added (see auto_add_time_ok).
MARKET_EVENING_OPENS_FROM = 14 * 60
MARKET_MORNING_SHUT_BY = 13 * 60
EVENING_MARKET_KEYWORDS = ["โต้รุ่ง", "ไนท์", "night", "คนเดิน", "walking street", "เปิดท้าย", "ตลาดกลางคืน"]
MORNING_MARKET_KEYWORDS = ["ตลาดสด", "ตลาดเช้า"]
MORNING_MARKET_MINUTES = 60
# Evening market + dinner restaurant on the same day: dinner comes first, the
# market is the short walk after it. With no dinner restaurant the market
# keeps its full visit and is where the evening is spent eating.
MARKET_AFTER_DINNER_MINUTES = 45
# Cost (detour-km equivalent, like ADJACENT_SAME_CATEGORY_PENALTY) for a
# route that walks the evening market BEFORE that day's dinner. Large enough
# to outweigh any in-town detour -- at 5 a few km of extra driving still put
# the market first -- yet far below DROPPED_STOP_PENALTY, so the order flips
# when dinner-then-market would not fit in the day at all.
MARKET_BEFORE_DINNER_PENALTY = 20.0


def market_kind(loc: Place) -> Optional[str]:
    """"evening", "morning", "all_day", or None (not a market, or can't
    tell). An admin's label (places.market_time) wins over the guess from
    hours and name; "all_day" only ever comes from that label -- no time
    preference, but known well enough to be auto-added."""
    if loc.category != "ตลาด":
        return None
    if loc.market_time in ("morning", "evening", "all_day"):
        return loc.market_time
    periods = loc.hours_periods or []
    if periods and not _is_always_open(loc):
        if _never_opens_before(loc, MARKET_EVENING_OPENS_FROM):
            return "evening"
        if all(
            "close" in p and p["close"]["day"] == p["open"]["day"]
            and p["close"]["hour"] * 60 + p["close"]["minute"] <= MARKET_MORNING_SHUT_BY
            for p in periods
        ):
            return "morning"
    name_lower = loc.name.lower()
    if any(kw in name_lower for kw in EVENING_MARKET_KEYWORDS):
        return "evening"
    if any(kw in name_lower for kw in MORNING_MARKET_KEYWORDS):
        return "morning"
    return None


def _never_opens_before(loc: Place, minute_of_day: int) -> bool:
    """True if every listed opening period starts at or after `minute_of_day`
    (False without real hours data, including the 24h sentinel)."""
    periods = loc.hours_periods or []
    if not periods or _is_always_open(loc):
        return False
    return all(p["open"]["hour"] * 60 + p["open"]["minute"] >= minute_of_day for p in periods)


# A restaurant that never opens before this is the day's dinner whether or
# not anything tagged it: a lone restaurant gets no meal_role (prompt rule 6),
# and in replays one opening at 18:00 was not seen as a dinner -- the evening
# market kept its full two hours and the two fought over 17:00-20:00.
DINNER_ONLY_OPENS_FROM = 16 * 60


def _is_dinner_stop(place: Place, meal_roles: Optional[Dict[str, str]]) -> bool:
    if place.category != "ร้านอาหาร":
        return False
    return (
        (meal_roles or {}).get(place.id) == "dinner" or is_evening_place(place)
        or _never_opens_before(place, DINNER_ONLY_OPENS_FROM)
    )


def _day_has_dinner(places: List[Place], meal_roles: Optional[Dict[str, str]]) -> bool:
    return any(_is_dinner_stop(p, meal_roles) for p in places)


def auto_add_time_ok(place: Place, start_activity_dt: datetime) -> bool:
    """May `place` be auto-added (backfill, gap filler) at this start time?
    Only markets are restricted: nobody picked the stop, so it has to land
    when people actually go -- a market of unknown kind is never auto-added,
    and a known one only inside its window. Picked markets are not bound by
    this; for them the window is a soft cost (preferred_time_window).

    A spare outdoor place (park, lake, landmark -- see Place.is_spare) is
    likewise only added for a morning or late-afternoon walk, not at midday."""
    start_min = start_activity_dt.hour * 60 + start_activity_dt.minute
    if place.category != "ตลาด":
        if place.is_spare and place.category in SPARE_OUTDOOR_CATEGORIES:
            return any(lo <= start_min <= hi for lo, hi in SPARE_OUTDOOR_WINDOWS)
        return True
    kind = market_kind(place)
    if kind == "all_day":
        return True
    window = preferred_time_window(place)
    if window is None:
        return False
    return window[0] <= start_min <= window[1]


def _periods_for_weekday(loc: Place, google_day: int) -> List[dict]:
    if not loc.hours_periods:
        return []
    if _is_always_open(loc):
        return loc.hours_periods
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
    if _is_business_closed(loc):
        # "Closed Today" (not "Closed") is deliberate -- it's what
        # reassign_infeasible_days/_enforce_restaurant_cap_and_roles check
        # to decide "is this place closed on this candidate day", and a
        # temporarily/permanently closed place is closed on every day, not
        # just today. Every other day's check_is_open() call for it will
        # also return "Closed Today", so it correctly falls through to
        # "closed every day of the trip, drop it" with no extra code.
        return {"is_open": False, "wait_min": 0, "status": "Closed Today"}

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
    data, multiple periods that day, a wide/all-day window, or the place is
    closed for business regardless of its scraped hours -- see
    _is_business_closed)."""
    if _is_business_closed(loc) or not loc.hours_periods:
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
        if meal_role in MEAL_WINDOWS:
            return MEAL_WINDOWS[meal_role]
        if is_evening_place(loc):
            return MEAL_DINNER_WINDOW
        # No role assigned and not an evening-only spot: any mealtime is
        # fine, union of lunch..dinner.
        return (MEAL_LUNCH_WINDOW[0], MEAL_DINNER_WINDOW[1])
    if loc.category == "คาเฟ่":
        return CAFE_WINDOW
    if loc.category in ATTRACTION_CATEGORIES:
        return ATTRACTION_WINDOW
    kind = market_kind(loc)
    if kind == "evening":
        return MARKET_EVENING_WINDOW
    if kind == "morning":
        return MARKET_MORNING_WINDOW
    return None


def _forced_meal_window(place: Place, meal_roles: Optional[Dict[str, str]]) -> Optional[Tuple[int, int]]:
    """The lunch/dinner window a restaurant's explicit meal_role holds it to,
    None for everything else. Unlike preferred_time_window's soft cost, the
    START of this window is a floor: both walks wait for it (see
    _gap_minutes), so a "dinner" pick is never seated at 15:00."""
    role = (meal_roles or {}).get(place.id)
    return preferred_time_window(place, role) if place.category == "ร้านอาหาร" and role else None


def _forced_window(
    place: Place, meal_roles: Optional[Dict[str, str]], end_dt_bound: datetime,
    hotel: Optional[Place], pace: str, day_has_dinner: bool,
) -> Optional[Tuple[int, int]]:
    """Window whose START both walks wait for (see _gap_minutes): a
    restaurant's lunch/dinner role, or an evening market's 17:00.

    The soft cost alone only ORDERS a day -- with little else to do, a night
    market Google lists as open all day still landed at 11:18. The market's
    floor gives way to the day's end, though: it is never held later than the
    last moment its visit still fits (an 09:00-18:00 day gets a market that
    opens at 16:00 from 16:00, as before, instead of losing it)."""
    meal_window = _forced_meal_window(place, meal_roles)
    if meal_window or market_kind(place) != "evening":
        return meal_window
    return_min = travel_minutes(calculate_distance(place, hotel)) if hotel else 0
    latest_start = (
        end_dt_bound.hour * 60 + end_dt_bound.minute
        - get_visit_duration(place, pace, day_has_dinner) - return_min
    )
    return (min(MARKET_EVENING_WINDOW[0], latest_start), MARKET_EVENING_WINDOW[1])


# Dinner is seated from 17:30 whatever time the day ends, so a 09:00-20:00
# day was back at the hotel by 18:36. Simply holding dinner later would only
# move the dead time in front of it, so the day's end is used as a FILL
# TARGET instead: gap fillers may keep adding real stops before dinner up to
# this moment, and dinner follows them. Never later than DINNER_LATEST_START
# however late the day runs (nobody plans to sit down at 20:50).
DINNER_LATEST_START = 19 * 60
# Rough hop from the dinner table to the evening market walked after it.
AFTER_DINNER_HOP_MINUTES = 10


def _dinner_fill_until(
    place: Place, meal_roles: Optional[Dict[str, str]], later_places: List[Place],
    end_dt_bound: datetime, hotel: Optional[Place], pace: str, day_has_dinner: bool,
) -> Optional[int]:
    """Minute of the day up to which gap fillers may run before `place`, the
    day's dinner: the latest start that still fits the meal, an after-dinner
    market walk for each evening market still to come, and the drive back.
    GAP_FILLER_SLACK_MINUTES is taken off, since a filler may overshoot its
    gap by that much and the meal must not pay for it. None when `place` is
    not a dinner, when that moment is no later than dinner's normal 17:30, or
    when the restaurant would have closed by the end of a meal started then."""
    if not _is_dinner_stop(place, meal_roles):
        return None
    visit_min = get_visit_duration(place, pace, day_has_dinner)
    return_min = travel_minutes(calculate_distance(place, hotel)) if hotel else 0
    after_min = sum(
        MARKET_AFTER_DINNER_MINUTES + AFTER_DINNER_HOP_MINUTES for p in later_places if market_kind(p) == "evening"
    )
    latest = end_dt_bound.hour * 60 + end_dt_bound.minute - visit_min - return_min - after_min - GAP_FILLER_SLACK_MINUTES
    target = min(DINNER_LATEST_START, latest)
    if target <= MEAL_DINNER_WINDOW[0]:
        return None
    last_minute_at_table = end_dt_bound.replace(hour=target // 60, minute=target % 60) + timedelta(minutes=visit_min - 1)
    if not check_is_open(place, last_minute_at_table)["is_open"]:
        return None
    return target


def meal_role_fits_window(role: str, start_time_of_day: time, end_time_of_day: time) -> bool:
    """Can a meal with this "lunch"/"dinner" role be seated inside the day's
    window at all? Same probe as the orchestrator's meal reserve
    (meal_probe_minutes). Confirmed on a real 09:00-18:00 trip: the LLM tagged
    a restaurant "dinner", which can only start at 17:30 and so never fits --
    it was dropped on every run, after the planning walk had already counted
    the afternoon as taken. Callers drop the role instead (llm_extractor)."""
    window = MEAL_WINDOWS.get(role)
    if window is None:
        return True
    start_min = start_time_of_day.hour * 60 + start_time_of_day.minute
    end_min = end_time_of_day.hour * 60 + end_time_of_day.minute
    return bool(meal_probe_minutes(start_min, end_min, window))


def day_meals(start_time_of_day: time, end_time_of_day: time, breakfast: bool = False) -> List[str]:
    """The meals a day with this window gets, in order: lunch and dinner when
    the window can seat them, and breakfast too when the traveller asked for
    it (the "อาหารเช้า" food choice) and the day starts early enough."""
    wanted = ("breakfast", "lunch", "dinner") if breakfast else ("lunch", "dinner")
    return [m for m in wanted if meal_role_fits_window(m, start_time_of_day, end_time_of_day)]


# --- "can this restaurant actually be eaten at on this trip?" -----------------
# Shared by the candidate-pool builder (orchestrator) and the meal fallback
# (llm_extractor) so both judge a restaurant the same way. A restaurant is only
# worth a candidate slot, or a day's fallback meal, if some visit of it fits
# inside the trip's daily window. Confirmed on real data: a 1-day 09:00-18:00
# trip whose restaurants all opened at 17:00 or later, so no day could ever get
# a meal. Retrieval ranks by relevance, not by whether the place is open when
# the traveller is out.
MEAL_MIN_OPEN_MINUTES = 45        # must still be open this long after arriving
MEAL_RETURN_BUFFER_MINUTES = 10   # rough drive back to the hotel at day's end
MEAL_PROBE_STEP_MINUTES = 30


def meal_probe_minutes(start_min: int, end_min: int, window: Optional[Tuple[int, int]] = None) -> List[int]:
    """Candidate arrival minutes-of-day for a meal inside [start_min, end_min],
    optionally narrowed to `window` (e.g. MEAL_LUNCH_WINDOW)."""
    lo = start_min
    hi = end_min - MEAL_MIN_OPEN_MINUTES - MEAL_RETURN_BUFFER_MINUTES
    if window:
        lo, hi = max(lo, window[0]), min(hi, window[1])
    return list(range(lo, hi + 1, MEAL_PROBE_STEP_MINUTES)) if hi >= lo else []


def open_for_meal(
    place: Place, trip_dates, start_min: int, end_min: int, window: Optional[Tuple[int, int]] = None,
) -> bool:
    """True if on at least one of `trip_dates` there is an arrival time in the
    daily window (optionally narrowed to `window`) at which the place is open
    now and still open MEAL_MIN_OPEN_MINUTES later. A place with no hours data
    counts as open (same assumption check_is_open makes)."""
    probes = meal_probe_minutes(start_min, end_min, window)
    for day in trip_dates:
        for minute in probes:
            arrival = datetime(day.year, day.month, day.day, minute // 60, minute % 60)
            if (check_is_open(place, arrival)["is_open"]
                    and check_is_open(place, arrival + timedelta(minutes=MEAL_MIN_OPEN_MINUTES))["is_open"]):
                return True
    return False


def _day_end(hotel: Optional[Place], end_loc: Optional[Place]) -> Optional[Place]:
    """Where the day's last drive goes: `end_loc` (the trip's end point, on
    its last day -- see trip_ends.py) or else back to `hotel`."""
    return end_loc if end_loc is not None else hotel


def _simulate_day_walk(
    ordered_places: List[Place], hotel: Place, day_date: date,
    start_dt: datetime, end_dt_bound: datetime, pace: str,
    meal_roles: Optional[Dict[str, str]] = None, end_loc: Optional[Place] = None,
) -> List[dict]:
    """Walk `ordered_places` in the given order starting from `hotel` at
    `start_dt`. Returns one dict per stop that's actually feasible (arrives
    before `end_dt_bound`, isn't closed, AND can still get back to `hotel`
    by `end_dt_bound` -- see the trim loop below) -- infeasible stops are
    silently skipped, same "drop rather than show a doomed visit" policy the
    old single-pass backstop used. Shared by the cheapest-insertion/Or-opt
    cost function and backfill.

    Waits exactly as materialize_day_schedule does (_gap_minutes: opening
    hours, a lunch/dinner `meal_roles` window, an evening-only place) so the
    two can't drift apart. It used to wait for opening hours only: a "dinner"
    pick was planned at 15:00, the afternoon looked full to ordering and
    backfill, then the real schedule held it to 17:30 and dropped it.

    `end_loc`, when given, is where the day ends instead of `hotel`."""
    stops = []
    end = _day_end(hotel, end_loc)
    current_loc = hotel
    current_dt = start_dt
    has_dinner = _day_has_dinner(ordered_places, meal_roles)
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

        forced_window = _forced_window(place, meal_roles, end_dt_bound, end, pace, has_dinner)
        wait_min = _gap_minutes(place, arrival_at_door, forced_window, open_info)
        start_activity_dt = arrival_at_door + timedelta(minutes=wait_min)
        if start_activity_dt >= end_dt_bound:
            continue

        visit_min = get_visit_duration(place, pace, has_dinner)
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
    while stops and end:
        last = stops[-1]
        return_travel = travel_minutes(calculate_distance(last["place"], end))
        if last["departure_dt"] + timedelta(minutes=return_travel) <= end_dt_bound:
            break
        visit = _fit_last_stop_visit(
            last["place"], pace, last["start_activity_dt"], return_travel, end_dt_bound, has_dinner,
        )
        if visit is not None:
            last["departure_dt"] = last["start_activity_dt"] + timedelta(minutes=visit)
            break
        stops.pop()
    return stops


def _route_cost(
    route: List[Place], hotel: Place, day_date: date,
    start_dt: datetime, end_dt_bound: datetime, pace: str,
    meal_roles: Dict[str, str], end_loc: Optional[Place] = None,
) -> float:
    stops = _simulate_day_walk(route, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)
    surviving_ids = {s["place"].id for s in stops}
    total = DROPPED_STOP_PENALTY * sum(1 for p in route if p.id not in surviving_ids)
    prev_category = None
    evening_markets_so_far = 0
    for index, s in enumerate(stops):
        total += s["dist"] * DISTANCE_WEIGHT
        total += s["wait_min"] * WAIT_PENALTY_PER_MIN
        if meal_roles.get(s["place"].id) == "breakfast":
            total += index * BREAKFAST_NOT_FIRST_PENALTY
        if market_kind(s["place"]) == "evening":
            evening_markets_so_far += 1
        elif _is_dinner_stop(s["place"], meal_roles):
            total += evening_markets_so_far * MARKET_BEFORE_DINNER_PENALTY
        role = meal_roles.get(s["place"].id)
        window = preferred_time_window(s["place"], role)
        if window:
            lo, hi = window
            arrival_min = s["arrival_at_door"].hour * 60 + s["arrival_at_door"].minute
            if arrival_min < lo:
                total += (lo - arrival_min) * TIME_PENALTY_PER_MIN
            elif arrival_min > hi:
                late_rate = MEAL_LATE_PENALTY_PER_MIN if role and s["place"].category in _MEAL_CATEGORIES else TIME_PENALTY_PER_MIN
                total += (arrival_min - hi) * late_rate
        category = s["place"].category
        if category in ADJACENT_PENALTY_CATEGORIES and category == prev_category:
            total += ADJACENT_SAME_CATEGORY_PENALTY
        prev_category = category
    # The leg back to the hotel counts like any other leg. Without it the
    # day's last stop was chosen with no regard for where the hotel is: on a
    # real trip a must-go restaurant 0.1 km from the hotel was used at lunch
    # while an evening-only one 6.7 km away closed the day, because the only
    # check on the way home was "does it still arrive by end_time". Only the
    # last SURVIVING stop is the one actually driven home from. With an
    # `end_loc` (the trip's end point) this same leg is what orders the last
    # day toward it.
    end = _day_end(hotel, end_loc)
    if stops and end:
        total += calculate_distance(stops[-1]["place"], end) * DISTANCE_WEIGHT
    return total


def _cheapest_insert_remaining(
    route: List[Place], remaining: List[Place], hotel: Place, day_date: date,
    start_dt: datetime, end_dt_bound: datetime, pace: str, meal_roles: Dict[str, str],
    min_insert_pos: int, orig_index: Dict[str, int], label: str = "",
    end_loc: Optional[Place] = None,
) -> List[Place]:
    """Repeatedly insert the (place, position) pair from `remaining` with
    the lowest cost into `route`, until every place in `remaining` is
    either placed or provably unfittable. See order_day_stops' docstring
    for the feasibility/tie-break rules -- this is that loop, factored out
    so order_day_stops can run it twice: once over must-go places only,
    once over everything else. Running must-go places to exhaustion first
    means a cheaper-but-optional stop can never consume the day's last bit
    of feasible daylight ahead of a place the user explicitly required."""
    remaining = list(remaining)
    while remaining:
        baseline_ids = {s["place"].id for s in _simulate_day_walk(route, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)}
        best_key = None
        best_place = None
        best_pos = None
        for place in remaining:
            natural_pos = sum(1 for r in route if orig_index.get(r.id, 0) < orig_index.get(place.id, 0))
            for pos in range(min_insert_pos, len(route) + 1):
                candidate = route[:pos] + [place] + route[pos:]
                survive_ids = {s["place"].id for s in _simulate_day_walk(candidate, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)}
                if place.id not in survive_ids or not baseline_ids.issubset(survive_ids):
                    continue  # infeasible, or would evict an already-committed stop
                cost = _route_cost(candidate, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)
                key = (round(cost, 6), abs(pos - natural_pos), orig_index.get(place.id, 0))
                if best_key is None or key < best_key:
                    best_key, best_place, best_pos = key, place, pos
        if best_place is None:
            logger.info(
                "trip planner: could not fit %d remaining %splace(s) into the day, dropping: %s",
                len(remaining), label, ", ".join(p.name for p in remaining),
            )
            break
        route = route[:best_pos] + [best_place] + route[best_pos:]
        remaining.remove(best_place)
    return route


def _anchor_chain_feasible(chain: List[Tuple[Place, Tuple[int, int]]], pace: str) -> bool:
    """Walk an anchor chain in order and confirm every anchor after the
    first can actually be reached from the previous one's departure before
    its own close_min -- pure validation, doesn't build a route or mutate
    anything. Shared by both passes of _build_anchor_skeleton so a
    candidate insertion can be checked before it's committed."""
    prev_place: Optional[Place] = None
    prev_departure_min: Optional[int] = None
    for place, (open_min, close_min) in chain:
        if prev_place is not None:
            dist = calculate_distance(prev_place, place)
            earliest_arrival_min = prev_departure_min + travel_minutes(dist)
            if earliest_arrival_min >= close_min:
                return False
            arrival_min = max(open_min, earliest_arrival_min)
        else:
            arrival_min = open_min
        prev_departure_min = arrival_min + get_visit_duration(place, pace)
        prev_place = place
    return True


def _build_anchor_skeleton(
    anchors: List[Tuple[Place, Tuple[int, int]]], pace: str, must_go_ids: set,
    priority_ids: Optional[set] = None,
) -> Tuple[List[Place], List[Place]]:
    """Build the anchor skeleton in two must-go-first passes, mirroring
    _cheapest_insert_remaining's priority-tier policy on the flexible side.
    The old single global sort-by-open_min pass let whichever anchor simply
    came earlier in the day win a timing conflict, even when the loser was
    a must-go place and the winner was only optional -- the must-go
    priority tier added for order_day_stops' flexible-insertion phase never
    covered anchors at all.

    1. Chain every must-go anchor first, open_min order, demoting a
       must-go anchor only when it conflicts with an EARLIER must-go
       anchor already committed -- optional anchors aren't in the picture
       yet, so they can never bump a must-go one out here.
    2. Insert every optional anchor into whatever gaps that must-go
       skeleton leaves, at its natural open_min-sorted position, keeping
       it only if the WHOLE resulting chain -- including every must-go
       anchor already locked in -- stays feasible. An optional anchor that
       would push any must-go anchor's arrival past its close_min is
       demoted instead of inserted.

    Returns (route, demoted_places); demoted anchors (must-go or optional)
    are handed back for the caller to fold into the flexible pool, same as
    the single-pass version's demotion path."""
    priority_ids = priority_ids or set()
    must_go_anchors = [a for a in anchors if a[0].id in must_go_ids]
    # Optional anchors are inserted one at a time and each insertion is kept
    # only if the whole chain stays feasible, so whoever goes first can never
    # be bumped by someone later -- priority (meal) anchors simply go first.
    optional_anchors = (
        [a for a in anchors if a[0].id not in must_go_ids and a[0].id in priority_ids]
        + [a for a in anchors if a[0].id not in must_go_ids and a[0].id not in priority_ids]
    )

    skeleton: List[Tuple[Place, Tuple[int, int]]] = []
    demoted: List[Place] = []

    for anchor in must_go_anchors:
        candidate = skeleton + [anchor]
        if _anchor_chain_feasible(candidate, pace):
            skeleton = candidate
        else:
            demoted.append(anchor[0])

    for anchor in optional_anchors:
        pos = 0
        while pos < len(skeleton) and skeleton[pos][1][0] < anchor[1][0]:
            pos += 1
        candidate = skeleton[:pos] + [anchor] + skeleton[pos:]
        if _anchor_chain_feasible(candidate, pace):
            skeleton = candidate
        else:
            demoted.append(anchor[0])

    return [p for p, _ in skeleton], demoted


def order_day_stops(
    day_places: List[Place], hotel: Place, day_date: date,
    start_time_of_day: time, end_time_of_day: time, pace: str,
    meal_roles: Optional[Dict[str, str]] = None, must_go_ids: Optional[set] = None,
    end_loc: Optional[Place] = None,
) -> List[Place]:
    """Order one day's places using real geography and real opening hours:
    fixed-time anchors (narrow real opening windows) are placed first as a
    skeleton in window order, then remaining stops are added one at a time
    at their cheapest-insertion position (least added travel distance +
    time-of-day-window penalty), then polished with an Or-opt pass
    (single-stop relocation -- not 2-opt, since 2-opt's segment reversal
    would flip anchors out of their required forward time order).

    Places whose id is in `must_go_ids` get priority in BOTH phases. In the
    anchor phase (see _build_anchor_skeleton), a must-go anchor can never be
    bumped out of the skeleton by an optional anchor it happens to conflict
    with -- only another, earlier-committed must-go anchor can do that. In
    the flexible-insertion phase, must-go places are inserted cheapest-first
    in their own pass BEFORE any other flexible stop is even considered --
    otherwise several cheap optional stops can consume the day's remaining
    feasible daylight ahead of a farther-but-required place, which then
    reports as "dropped" even though there was room for it before the
    optional stops crowded it out. Neither is an absolute guarantee (a
    must-go place with a real opening-hours conflict, or two must-go
    anchors that themselves conflict, are still infeasible no matter when
    considered), just first claim on whatever room the day actually has.

    Never raises on an infeasible input -- anchors that can't be reached in
    time get demoted back to flexible stops, and flexible stops that can't
    fit anywhere get dropped (final drop/keep decision belongs to
    materialize_day_schedule's real simulation, this function only decides
    order)."""
    meal_roles = meal_roles or {}
    must_go_ids = must_go_ids or set()
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

    # Second priority tier, right after must-go: a day's restaurants. A meal
    # is the one stop a day can't be without, but restaurants don't count
    # toward the pace cap, so on a full day (packed pace, 7-8 attractions)
    # cheaper optional attractions used to claim the remaining daylight first
    # and the day's only restaurant -- typically an evening-only one that has
    # to be reached last -- was dropped as "doesn't fit". Giving restaurants
    # first claim after must-go makes the attractions give way instead.
    # Restaurants are capped at MAX_RESTAURANTS_PER_DAY upstream, so this
    # can't crowd a day out with meals.
    meal_ids = {p.id for p in day_places if p.category in _MEAL_CATEGORIES} - must_go_ids

    route, demoted_anchors = _build_anchor_skeleton(anchors, pace, must_go_ids, meal_ids)
    flexible.extend(demoted_anchors)

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
    orig_index = {p.id: i for i, p in enumerate(day_places)}
    priority = [p for p in flexible if p.id in must_go_ids]
    meals = [p for p in flexible if p.id in meal_ids]
    rest = [p for p in flexible if p.id not in must_go_ids and p.id not in meal_ids]
    route = _cheapest_insert_remaining(
        route, priority, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles,
        min_insert_pos, orig_index, label="MUST-GO ", end_loc=end_loc,
    )
    route = _cheapest_insert_remaining(
        route, meals, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles,
        min_insert_pos, orig_index, label="MEAL ", end_loc=end_loc,
    )
    route = _cheapest_insert_remaining(
        route, rest, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles,
        min_insert_pos, orig_index, end_loc=end_loc,
    )

    anchor_ids = {p.id for p, _ in anchors if p in route}
    return _or_opt_polish(route, anchor_ids, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc=end_loc)


def _auto_added_ok(walk: List[dict], at: int, meal_roles: Optional[Dict[str, str]]) -> bool:
    """Is the auto-added stop at `walk[at]` (a simulated day) somewhere it is
    allowed to be? Its start time suits it (auto_add_time_ok), an evening
    market does not come ahead of the day's dinner, and a spare is alone in
    its half of the day. Shared by backfill's insertion and the polish pass
    after it -- the polish used to move a spare park from its 09:05 walk to
    13:57, between two cafes, because that was cheaper."""
    place, start = walk[at]["place"], walk[at]["start_activity_dt"]
    if not auto_add_time_ok(place, start):
        return False
    if market_kind(place) == "evening" and _day_has_dinner([s["place"] for s in walk[at + 1:]], meal_roles):
        return False
    other_spares = [s["start_activity_dt"] for i, s in enumerate(walk) if i != at and s["place"].is_spare]
    return _spare_half_free(place, start, other_spares)


def _or_opt_polish(
    route: List[Place], anchor_ids: set, hotel: Place, day_date: date,
    start_dt: datetime, end_dt_bound: datetime, pace: str,
    meal_roles: Dict[str, str], auto_added_ids: Optional[set] = None,
    end_loc: Optional[Place] = None,
) -> List[Place]:
    """Single-stop relocation local search: try moving each non-anchor stop
    to every other position, keep the move if it strictly reduces total
    route cost. Bounded to a handful of passes -- at n<=8 stops/day this
    converges almost immediately.

    `auto_added_ids` are stops backfill put in: a move is refused if it
    leaves any of them somewhere _auto_added_ok would not have let it go."""
    def keeps_auto_added_ok(candidate: List[Place]) -> bool:
        if not auto_added_ids:
            return True
        walk = _simulate_day_walk(candidate, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)
        return all(_auto_added_ok(walk, i, meal_roles) for i, s in enumerate(walk) if s["place"].id in auto_added_ids)

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
            base_cost = _route_cost(route, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)
            for pos in range(min_pos, len(without) + 1):
                if pos == i:
                    continue
                candidate = without[:pos] + [place] + without[pos:]
                cost = _route_cost(candidate, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)
                if cost < base_cost - 1e-6 and keeps_auto_added_ok(candidate):
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


def _meal_lateness(walk: List[dict], meal_roles: Optional[Dict[str, str]]) -> int:
    """Minutes the day's lunch/dinner are seated past their window, summed.
    Live 2026-10-21: two spare stops slotted in before lunch (both feasible,
    so allowed) pushed a lunch from 11:30 to 14:34."""
    late = 0
    for s in walk:
        role = (meal_roles or {}).get(s["place"].id)
        window = _forced_meal_window(s["place"], meal_roles)
        if role and window:
            start = s["start_activity_dt"].hour * 60 + s["start_activity_dt"].minute
            late += max(0, start - window[1])
    return late


def _find_best_backfill_insertion(
    route: List[Place], hotel: Place, day_date: date,
    start_dt: datetime, end_dt_bound: datetime, pace: str,
    meal_roles: Dict[str, str], backfill_pool: List[Place],
    end_loc: Optional[Place] = None,
) -> Tuple[Optional[Place], Optional[int]]:
    """Cheapest (place, position) to insert from `backfill_pool` into
    `route`, or (None, None) if nothing in the pool fits anywhere without
    becoming infeasible or evicting an already-committed stop. Shared by
    backfill_underfilled_day (saturates one day) and
    backfill_underfilled_trip (spreads insertions across days) so the two
    can't drift apart on what counts as a valid insertion."""
    baseline_walk = _simulate_day_walk(route, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)
    baseline_ids = {s["place"].id for s in baseline_walk}
    baseline_late = _meal_lateness(baseline_walk, meal_roles)
    for tier in _filler_tiers(backfill_pool):
        best_key = None
        best_place = None
        best_pos = None
        for place in tier:
            if not _category_cap_ok(route, place):
                continue  # this day already has CATEGORY_DAILY_CAP of place.category
            for pos in range(len(route) + 1):
                candidate = route[:pos] + [place] + route[pos:]
                walk = _simulate_day_walk(candidate, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)
                survive_ids = {s["place"].id for s in walk}
                if place.id not in survive_ids or not baseline_ids.issubset(survive_ids):
                    continue  # infeasible, or would evict an already-committed stop
                if _meal_lateness(walk, meal_roles) > baseline_late:
                    continue  # would push a lunch/dinner past its window
                at = next(i for i, s in enumerate(walk) if s["place"].id == place.id)
                if not _auto_added_ok(walk, at, meal_roles):
                    continue  # e.g. a market at an hour nobody goes to it
                cost = _route_cost(candidate, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)
                key = (round(cost, 6), place.id)
                if best_key is None or key < best_key:
                    best_key, best_place, best_pos = key, place, pos
        if best_place is not None:
            return best_place, best_pos
    return None, None


def backfill_underfilled_day(
    route: List[Place], meal_roles: Dict[str, str], hotel: Place,
    day_date: date, start_time_of_day: time, end_time_of_day: time, pace: str,
    backfill_pool: List[Place], end_loc: Optional[Place] = None,
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
    added_ids = set()

    while len(route) < MAX_STOPS_PER_DAY:
        stops = _simulate_day_walk(route, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, end_loc)
        if _largest_gap_minutes(stops, start_dt, end_dt_bound) < UNDERFILLED_GAP_MINUTES:
            break

        best_place, best_pos = _find_best_backfill_insertion(
            route, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, backfill_pool, end_loc,
        )
        if best_place is None:
            break  # nothing in the pool fits the remaining gap
        route = route[:best_pos] + [best_place] + route[best_pos:]
        backfill_pool.remove(best_place)
        added_ids.add(best_place.id)

    if not added_ids:
        return route
    anchor_ids = {p.id for p in route if find_anchor_window(p, day_date)}
    return _or_opt_polish(
        route, anchor_ids, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, auto_added_ids=added_ids,
        end_loc=end_loc,
    )


def backfill_underfilled_trip(
    routes: Dict[int, List[Place]], day_dates: Dict[int, date], meal_roles: Dict[str, str],
    hotel: Place, start_time_of_day: time, end_time_of_day: time, pace: str,
    backfill_pool: List[Place],
    stop_range: Optional[Tuple[int, int]] = None,
    day_windows: Optional[Dict[int, Tuple[time, time]]] = None,
    end_locs: Optional[Dict[int, Place]] = None,
    stop_ranges: Optional[Dict[int, Tuple[int, int]]] = None,
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
    usual.

    `stop_range` is pace_stop_range's (min, max) attractions per day. A day
    below the min is backfilled regardless of how small its gaps are (the
    pace's floor), and a day already at the max is never topped up, even to
    close a large gap (the pace's cap). None keeps the gap-only behavior.

    Per-day overrides, for a trip whose last day differs (trip_ends.py):
    `day_windows` (start, end) instead of start/end_time_of_day, `end_locs`
    where a day ends instead of `hotel`, `stop_ranges` instead of
    `stop_range`."""
    if not backfill_pool:
        return routes

    day_windows = day_windows or {}
    end_locs = end_locs or {}
    stop_ranges = stop_ranges or {}
    start_dts = {d: datetime.combine(day_dates[d], day_windows.get(d, (start_time_of_day, end_time_of_day))[0]) for d in routes}
    end_dts = {d: datetime.combine(day_dates[d], day_windows.get(d, (start_time_of_day, end_time_of_day))[1]) for d in routes}
    added_ids: Dict[int, set] = {}
    # Days where nothing in the pool fits anymore -- without this, a day
    # that's out of feasible insertions but still has the largest gap would
    # be picked again every round, starving progress on every other day.
    stuck_days = set()

    while True:
        best_day, best_gap, best_below_min = None, 0.0, False
        for day_num, route in routes.items():
            if day_num in stuck_days or len(route) >= MAX_STOPS_PER_DAY:
                continue
            count = attraction_count(route)
            day_range = stop_ranges.get(day_num, stop_range)
            if day_range and count >= day_range[1]:
                continue  # pace cap reached
            below_min = bool(day_range) and count < day_range[0]
            stops = _simulate_day_walk(
                route, hotel, day_dates[day_num], start_dts[day_num], end_dts[day_num], pace, meal_roles,
                end_locs.get(day_num),
            )
            gap = _largest_gap_minutes(stops, start_dts[day_num], end_dts[day_num])
            # Days under the pace floor outrank days that merely have a gap.
            if best_day is None or (below_min, gap) > (best_below_min, best_gap):
                best_day, best_gap, best_below_min = day_num, gap, below_min
        if best_day is None or (best_gap < UNDERFILLED_GAP_MINUTES and not best_below_min):
            break

        route = routes[best_day]
        day_date, start_dt, end_dt_bound = day_dates[best_day], start_dts[best_day], end_dts[best_day]
        best_place, best_pos = _find_best_backfill_insertion(
            route, hotel, day_date, start_dt, end_dt_bound, pace, meal_roles, backfill_pool, end_locs.get(best_day),
        )
        if best_place is None:
            stuck_days.add(best_day)  # this day's gap can't be closed with what's left -- try others
            continue
        routes[best_day] = route[:best_pos] + [best_place] + route[best_pos:]
        backfill_pool.remove(best_place)
        added_ids.setdefault(best_day, set()).add(best_place.id)

    for day_num, day_added in added_ids.items():
        anchor_ids = {p.id for p in routes[day_num] if find_anchor_window(p, day_dates[day_num])}
        routes[day_num] = _or_opt_polish(
            routes[day_num], anchor_ids, hotel, day_dates[day_num],
            start_dts[day_num], end_dts[day_num], pace, meal_roles, auto_added_ids=day_added,
            end_loc=end_locs.get(day_num),
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
            # A place with no hours_periods AND not closed for business has
            # nothing to check here (check_is_open would just say "Open (No
            # Data)" every day) -- but a business-closed place must still go
            # through the check below even with hours_periods=None, or it
            # would never get dropped.
            if not place.hours_periods and not _is_business_closed(place):
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


def _gap_minutes(place: Place, arrival_at_door: datetime, meal_window: Optional[Tuple[int, int]], open_info: dict) -> int:
    """How long we'd have to wait at `place`'s door before anything useful
    can start there: real opening hours ("Waiting"), the start of a forced
    window (`meal_window`: a lunch/dinner meal_role or an evening market,
    see _forced_window), or (fallback) an evening-only spot reached before
    17:00. Whichever constraint requires waiting longer
    wins -- see materialize_day_schedule's inline comment for why these
    can't be independent elif branches. Shared between the main walk and
    its post-gap-filler recheck so the two can't drift apart."""
    wait_candidates = []
    if open_info["status"] == "Waiting":
        wait_candidates.append(open_info["wait_min"])
    if meal_window and arrival_at_door.hour * 60 + arrival_at_door.minute < meal_window[0]:
        target_dt = arrival_at_door.replace(hour=meal_window[0] // 60, minute=meal_window[0] % 60, second=0, microsecond=0)
        wait_candidates.append(int((target_dt - arrival_at_door).total_seconds() / 60))
    if wait_candidates:
        return max(wait_candidates)
    if is_evening_place(place) and arrival_at_door.hour < 17:
        target_dt = arrival_at_door.replace(hour=17, minute=0, second=0)
        return int((target_dt - arrival_at_door).total_seconds() / 60)
    return 0


def _stop_visit_cost(place: Place, dist_km: float) -> float:
    fuel_cost = dist_km * 4.0  # 4 THB/km
    # The middle of Google's per-person range ("฿600-800 ต่อคน") when there
    # is one: price_level 2 alone priced a ฿800-1,000 steak house at ฿400.
    range_price = pricing.visit_price(place)
    if range_price is not None:
        place_cost = range_price
    elif place.price_level is not None:
        place_cost = PRICE_MAP.get(place.price_level, 150)
    elif place.category in ("ร้านอาหาร", "คาเฟ่"):
        place_cost = 250
    elif place.category in ("ตลาด", "ห้างสรรพสินค้า", "ร้านของฝาก"):
        place_cost = 300
    elif place.category in ("วัด", "สวนสาธารณะ", "พิพิธภัณฑ์"):
        place_cost = 0
    else:
        place_cost = 100
    return fuel_cost + place_cost


# Slack allowed, in minutes, when deciding whether a gap-filler candidate
# "fits" a gap -- the detour there-and-back-to-the-route is allowed to run
# up to this much longer than the gap itself before being rejected, so a
# genuinely nearby real place isn't thrown out over a near-miss.
GAP_FILLER_SLACK_MINUTES = 20


def _find_gap_filler(
    pool: List[Place], current_loc: Place, next_place: Place,
    current_dt: datetime, gap_minutes: int, pace: str,
    day_places_so_far: List[Place], day_has_dinner: bool = False, dinner_ahead: bool = False,
    spare_starts: Optional[List[datetime]] = None, spares_only: bool = False,
) -> Optional[dict]:
    """Best real place from `pool` (trip candidates not used anywhere else)
    to visit instead of leaving a dead "free time" stretch before
    `next_place` -- must be open when reached, fit inside the gap (there +
    visit + back onto the route) with GAP_FILLER_SLACK_MINUTES to spare, and
    not push `day_places_so_far` past CATEGORY_DAILY_CAP for its category
    (the day's already-committed route plus any gap-fillers already
    inserted earlier today -- see materialize_day_schedule). Picks the
    smallest total detour distance among everything that fits, not the
    closest match to the gap length -- a nearby quick stop beats a farther
    one that happens to eat more of the gap. Returns a stop dict shaped
    like _simulate_day_walk's (so its TimeSlot fields can be built the same
    way), or None if nothing in the pool fits."""
    for tier in _filler_tiers(pool):
        best = None
        best_detour = None
        for cand in tier:
            if not _category_cap_ok(day_places_so_far, cand):
                continue
            if dinner_ahead and market_kind(cand) == "evening":
                continue  # the market walk comes after dinner, never added ahead of it
            if spares_only and not cand.is_spare:
                continue
            dist = calculate_distance(current_loc, cand)
            travel_min = travel_minutes(dist)
            arrival = current_dt + timedelta(minutes=travel_min)
            open_info = check_is_open(cand, arrival)
            if open_info["status"] in ("Closed", "Closed Today"):
                continue
            wait = open_info["wait_min"] if open_info["status"] == "Waiting" else 0
            start_activity = arrival + timedelta(minutes=wait)
            if not auto_add_time_ok(cand, start_activity):
                continue  # a market, at an hour nobody goes to it
            if spare_starts is not None and not _spare_half_free(cand, start_activity, spare_starts):
                continue
            visit_min = get_visit_duration(cand, pace, day_has_dinner)
            departure = start_activity + timedelta(minutes=visit_min)
            back_dist = calculate_distance(cand, next_place)
            back_travel = travel_minutes(back_dist)
            total_min = (departure - current_dt).total_seconds() / 60 + back_travel
            if total_min > gap_minutes + GAP_FILLER_SLACK_MINUTES:
                continue
            detour = dist + back_dist
            if best_detour is None or detour < best_detour:
                best_detour = detour
                best = {
                    "place": cand, "dist": dist, "travel_min": travel_min,
                    "arrival_at_door": arrival, "wait_min": wait,
                    "start_activity_dt": start_activity, "departure_dt": departure,
                    "open_info": open_info,
                }
        if best is not None:
            return best
    return None


# --- longer stays instead of dead time ----------------------------------------
# Once fillers and spares have had their turn, whatever idle time is left in a
# day (a placeholder block, a wait at a door, an early return to the hotel) is
# spent at the stops the day already has: a cafe booked for 45 minutes becomes
# an hour and a quarter while the dinner it precedes is still hours away.
# Nothing is added to the trip and nothing that was fixed moves -- only idle
# minutes are used, so every stop after a wait keeps its start time.
#
# Extra minutes a stop may be given on top of get_visit_duration, at relaxed
# pace. Judgment calls, not measurements: lingering in a cafe is normal, an
# hour at a small wat is already long.
STRETCH_EXTRA_MINUTES = {
    "คาเฟ่": 45, "ร้านอาหาร": 30, "วัด": 15, "สวนสาธารณะ": 30, "พิพิธภัณฑ์": 30,
    "สถานที่ท่องเที่ยว": 30, "ตลาด": 30, "ห้างสรรพสินค้า": 30, "ร้านของฝาก": 15,
    "อุทยานแห่งชาติ": 30,
}
# Share of that extra each pace gets. A packed trip asked for more stops, not
# longer ones, so its idle time stays visible.
STRETCH_PACE_FACTOR = {"relaxed": 1.0, "standard": 2 / 3, "packed": 0.0}
STRETCH_STEP_MINUTES = 5
# materialize_day_schedule shows a wait as a placeholder block only above this.
FREE_BLOCK_OVER_MINUTES = 45


def _stretch_room(place: Place, pace: str, day_has_dinner: bool = False) -> int:
    """Minutes `place`'s visit may be lengthened by at `pace`, to the nearest
    five. None for a buffet, which already sits at two hours, or for the
    evening market walked after dinner: that one is short on purpose
    (MARKET_AFTER_DINNER_MINUTES)."""
    if any(kw in place.name.lower() for kw in BUFFET_KEYWORDS):
        return 0
    if day_has_dinner and market_kind(place) == "evening":
        return 0
    factor = STRETCH_PACE_FACTOR.get(pace, STRETCH_PACE_FACTOR["standard"])
    return round(STRETCH_EXTRA_MINUTES.get(place.category, 0) * factor / 5) * 5


def _stretch_stays(
    schedule: List[TimeSlot], meta: List[dict], pace: str,
    hotel: Optional[Place], end_dt_bound: datetime, day_has_dinner: bool = False,
) -> None:
    """Spend the day's idle minutes on longer visits (see above). `schedule`
    and `meta` are materialize_day_schedule's parallel lists, before the
    return leg is added; both are updated in place.

    The day is cut into runs of stops that follow each other without waiting.
    A run ends at idle time: a placeholder block, a stop that waits at its
    door, or the end of the day. Lengthening a stop pushes the rest of its run
    later and eats into that idle time, never past it. A pushed stop must
    still be open for its whole visit, a stop only allowed at certain hours
    (auto_add_time_ok) stays in them, and a meal is never pushed at all.
    Minutes are handed out a few at a time from the end of the run backwards,
    so the stops that push nothing are lengthened first."""
    room = [0 if m["kind"] == "free" else _stretch_room(m["place"], pace, day_has_dinner) for m in meta]
    if not any(room):
        return

    def minutes(delta: timedelta) -> int:
        return int(delta.total_seconds() // 60)

    def open_at(place: Place, at: datetime) -> bool:
        return check_is_open(place, at)["is_open"]

    def may_leave_at(m: dict, new_depart: datetime) -> bool:
        # Open until the last minute of the longer visit -- unless hours data
        # already had the visit running past closing, which is not made worse.
        last_minute = timedelta(minutes=1)
        return open_at(m["place"], new_depart - last_minute) or not open_at(m["place"], m["depart"] - last_minute)

    def may_shift(m: dict, by: timedelta) -> bool:
        place, new_start = m["place"], m["start"] + by
        if place.category in _MEAL_CATEGORIES:
            # In replays a day's only restaurant, already late at 15:38, slid
            # to 16:33 behind four longer sightseeing stops.
            return False
        if not open_at(place, new_start) or not may_leave_at(m, m["depart"] + by):
            return False
        return auto_add_time_ok(place, new_start) or not auto_add_time_ok(place, m["start"])

    def absorb(lo: int, hi: int, idle: int) -> int:
        """Lengthen the stops of the run meta[lo:hi] by up to `idle` minutes
        in total. Returns the minutes used."""
        left = idle
        progress = True
        while left > 0 and progress:
            progress = False
            for j in range(hi - 1, lo - 1, -1):
                step = min(STRETCH_STEP_MINUTES, left, room[j])
                if step <= 0:
                    continue
                by = timedelta(minutes=step)
                if not may_leave_at(meta[j], meta[j]["depart"] + by):
                    continue
                if not all(may_shift(meta[k], by) for k in range(j + 1, hi)):
                    continue
                meta[j]["depart"] += by
                for k in range(j + 1, hi):
                    for key in ("arrive", "start", "depart"):
                        meta[k][key] += by
                room[j] -= step
                left -= step
                progress = True
                if left <= 0:
                    break
        return idle - left

    run_start = 0
    i = 0
    while i < len(meta):
        m = meta[i]
        if m["kind"] == "free":
            used = absorb(run_start, i, minutes(m["depart"] - m["start"]))
            m["start"] += timedelta(minutes=used)
            m["arrive"] = m["start"]
            if used and minutes(m["depart"] - m["start"]) <= FREE_BLOCK_OVER_MINUTES and i + 1 < len(meta):
                # Too short to show as a block any more: what is left becomes
                # an ordinary wait at the stop the block was waiting for.
                meta[i + 1]["arrive"] = m["start"] + timedelta(minutes=meta[i + 1]["travel"])
                del meta[i], schedule[i], room[i]
                run_start = i
            else:
                run_start = i + 1
        else:
            wait = minutes(m["start"] - m["arrive"])
            if wait > 0:
                m["arrive"] += timedelta(minutes=absorb(run_start, i, wait))
                run_start = i
        i += 1

    if hotel and meta and meta[-1]["kind"] != "free":
        last = meta[-1]
        spare_min = minutes(end_dt_bound - last["depart"]) - travel_minutes(calculate_distance(last["place"], hotel))
        if spare_min > 0:
            absorb(run_start, len(meta), spare_min)

    for slot, m in zip(schedule, meta):
        slot.arrival_time = m["arrive"].strftime("%H:%M")
        slot.departure_time = m["depart"].strftime("%H:%M")
        if m["kind"] == "free":
            continue
        wait = minutes(m["start"] - m["arrive"])
        if wait != slot.wait_time_min:
            slot.wait_time_min = wait
            slot.status = "Waiting" if wait else check_is_open(m["place"], m["arrive"])["status"]


def materialize_day_schedule(
    route: List[Place], anchor_ids: set, meal_roles: Dict[str, str], hotel: Place,
    day_date: date, start_time_of_day: time, end_time_of_day: time, pace: str,
    gap_filler_pool: Optional[List[Place]] = None,
    max_attractions: Optional[int] = None,
    must_go_ids: Optional[set] = None,
    dropped: Optional[List[Tuple[Place, str]]] = None,
    end_loc: Optional[Place] = None,
) -> Tuple[List[TimeSlot], float, int]:
    """Walk the already-ordered `route` and build the final TimeSlot list:
    real arrival/departure/wait times, per-stop fuel + place cost, and a
    return-to-hotel leg at the end of every day -- or, when `end_loc` is
    given (the last day of a trip with a trip_end, see trip_ends.py), a leg
    to that end point instead.

    Any gap > 45min before a stop is ready (closed, or waiting on its
    lunch/dinner/evening window) is filled with a real, nearby, currently-
    open place from `gap_filler_pool` when one fits (mutated in place, same
    "shared pool consumed as we go" convention as backfill_underfilled_*)
    -- an actual detour reads as a normal part of the day, unlike a "free
    time" placeholder materializing out of nowhere. Only when nothing in
    the pool fits does this fall back to that placeholder block.

    `max_attractions` (pace_stop_range's max) stops gap-filler stops from
    pushing the day past the pace's attraction cap; the placeholder block
    is used instead.

    The planning walk (_simulate_day_walk) waits the same way this one does
    but can't see the gap-filler detours added here, so a day it judged to
    fit can still end after `end_time_of_day`. Before the return leg is
    added, the day's tail is therefore re-checked: the last stop is shortened
    if that is enough, otherwise dropped, repeatedly. Never dropped: a
    `must_go_ids` place, or the day's only restaurant (the day would be left
    without a meal) -- those keep their time and the day runs over instead.
    The same check also runs when the walk reaches a stop with the day
    already over: if it drops the stop that overran, the stops ordered behind
    it get their turn instead of being skipped unseen.

    `dropped`, when given, collects a (place, reason) pair for every `route`
    place that did not make it into the schedule, for the caller's regenerate
    feedback. Gap-filler stops are not reported: nobody picked them."""
    schedule: List[TimeSlot] = []
    # One entry per schedule slot, same order: what the tail check needs to
    # shorten or undo a slot (kind is "stop", "filler" or "free").
    meta: List[dict] = []
    must_go_ids = must_go_ids or set()
    end = _day_end(hotel, end_loc)
    current_loc = hotel
    current_dt = datetime.combine(day_date, start_time_of_day)
    end_dt_bound = datetime.combine(day_date, end_time_of_day)
    day_cost = 0.0
    day_travel = 0
    # Full composition of the day for CATEGORY_DAILY_CAP purposes: `route`
    # is fixed for the whole day, so seeding with it (rather than building
    # it up as the walk progresses) lets a gap-filler early in the day
    # correctly see categories that only appear in a later route stop.
    day_places_so_far = list(route)
    has_dinner = _day_has_dinner(route, meal_roles)
    end_label = end_time_of_day.strftime("%H:%M")

    def note_drop(place: Place, reason: str) -> None:
        if dropped is not None:
            dropped.append((place, reason))

    def trim_tail() -> bool:
        """Tail check (see docstring). True if a stop was dropped."""
        nonlocal current_loc, current_dt, day_cost, day_travel
        trimmed = dropped_stop = False
        while meta and end:
            last = meta[-1]
            return_min = travel_minutes(calculate_distance(last["place"], end))
            if last["depart"] + timedelta(minutes=return_min) <= end_dt_bound:
                break
            if last["kind"] == "free":
                schedule.pop()
                meta.pop()
                trimmed = True
                continue
            fitted = _fit_last_stop_visit(last["place"], pace, last["start"], return_min, end_dt_bound, has_dinner)
            if fitted is not None:
                last["depart"] = last["start"] + timedelta(minutes=fitted)
                schedule[-1].departure_time = last["depart"].strftime("%H:%M")
                trimmed = True
                break
            other_meals = any(m["place"].category == "ร้านอาหาร" for m in meta[:-1] if m["kind"] != "free")
            if last["place"].id in must_go_ids or (last["place"].category == "ร้านอาหาร" and not other_meals):
                logger.info("trip planner: keeping %s although the day ends after %s (must-go or only meal)",
                            last["place"].name, end_label)
                break
            logger.info("trip planner: dropping %s, the day would end after %s", last["place"].name, end_label)
            schedule.pop()
            meta.pop()
            day_cost -= last["cost"]
            day_travel -= last["travel"]
            # No longer part of the day: frees its CATEGORY_DAILY_CAP slot.
            day_places_so_far.remove(last["place"])
            if last["kind"] == "filler":
                if gap_filler_pool is not None:
                    gap_filler_pool.append(last["place"])
            else:
                note_drop(last["place"], f"the day would end after {end_label}")
            trimmed = dropped_stop = True
        if trimmed:
            # A placeholder block only exists to wait for the stop after it.
            while meta and meta[-1]["kind"] == "free":
                schedule.pop()
                meta.pop()
            if meta:
                current_loc, current_dt = meta[-1]["place"], meta[-1]["depart"]
            else:
                current_loc, current_dt = hotel, datetime.combine(day_date, start_time_of_day)
        return dropped_stop

    for idx, place in enumerate(route):
        if current_dt >= end_dt_bound:
            # Normally nothing more fits. But if the day is only over because
            # the previous stop overran and the tail check drops it, carry on
            # from the stop before it. Confirmed on a real trip: a cafe ordered
            # after a "dinner" that ended at 18:30 was skipped here, then the
            # dinner itself was dropped -- the day went home at 13:05.
            if not trim_tail() or current_dt >= end_dt_bound:
                for skipped in route[idx:]:
                    note_drop(skipped, f"no time left before {end_label}")
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
            note_drop(place, f"closed when reached at {arrival_at_door.strftime('%H:%M')}")
            continue

        meal_window = _forced_window(place, meal_roles, end_dt_bound, end, pace, has_dinner)
        # Two independent constraints can each push the start time later:
        # the place's own real opening hours (open_info "Waiting") and a
        # "lunch"/"dinner" meal_role's target window. _gap_minutes takes
        # whichever requires waiting longer -- these can't be independent
        # elif branches, or a restaurant that happens to open earlier than
        # its meal_role's window would get seated right when it opens, with
        # the meal_role tag now meaningless (a "dinner"-tagged place open
        # since 10:00 getting seated at 10:19 because the 19-minute
        # "Waiting" for it to open took priority over the still-unmet
        # dinner window entirely).
        gap_minutes = _gap_minutes(place, arrival_at_door, meal_window, open_info)
        # Before the day's dinner, fillers may use more than the wait itself:
        # everything up to the latest start that still ends the day on time
        # (see _dinner_fill_until). The dinner never waits for that moment --
        # with nothing to fill it, it is seated as early as before -- and the
        # time past the real wait only ever goes to spare places.
        fill_until = _dinner_fill_until(place, meal_roles, route[idx + 1:], end_dt_bound, end, pace, has_dinner)

        def fill_minutes() -> int:
            if fill_until is None:
                return gap_minutes
            return max(gap_minutes, fill_until - (arrival_at_door.hour * 60 + arrival_at_door.minute))

        wait_min = 0
        if fill_minutes() > 45:
            place_dropped = False
            # Chain as many real gap-filler stops as fit -- a single quick
            # cafe rarely absorbs a 3+ hour wait for dinner on its own, and
            # bailing out to the placeholder after just one attempt would
            # still leave most of a long gap looking unaccounted for.
            # Naturally bounded: each iteration removes its pick from
            # gap_filler_pool, so this can't loop more than the pool's size.
            while (
                fill_minutes() > 45 and gap_filler_pool
                and (max_attractions is None or attraction_count(day_places_so_far) < max_attractions)
            ):
                filler = _find_gap_filler(
                    gap_filler_pool, current_loc, place, current_dt, fill_minutes(), pace, day_places_so_far, has_dinner,
                    dinner_ahead=_day_has_dinner(route[idx:], meal_roles),
                    # Spares still ahead in the route have no time yet; they
                    # can only land later than now, so count them as now.
                    spare_starts=[m["start"] for m in meta if m["kind"] != "free" and m["place"].is_spare]
                    + [current_dt for p in route[idx:] if p.is_spare],
                    # Once the real wait is covered, what is left is only the
                    # longer evening: that is spent on spares alone. The
                    # shared pool stays for real gaps -- in replays day 1
                    # took a park for a later dinner and day 2, which had
                    # used it to close a wait, got a 129-minute hole instead.
                    spares_only=gap_minutes <= 45,
                )
                if not filler:
                    break
                f_place = filler["place"]
                schedule.append(TimeSlot(
                    place=f_place, arrival_time=filler["arrival_at_door"].strftime("%H:%M"),
                    departure_time=filler["departure_dt"].strftime("%H:%M"),
                    travel_time_min=filler["travel_min"], distance_km=round(filler["dist"], 2),
                    status=filler["open_info"]["status"] if filler["wait_min"] == 0 else "Waiting",
                    wait_time_min=filler["wait_min"],
                ))
                filler_cost = _stop_visit_cost(f_place, filler["dist"])
                meta.append({
                    "kind": "filler", "place": f_place, "cost": filler_cost, "travel": filler["travel_min"],
                    "arrive": filler["arrival_at_door"],
                    "start": filler["start_activity_dt"], "depart": filler["departure_dt"],
                })
                day_cost += filler_cost
                day_travel += filler["travel_min"]
                gap_filler_pool.remove(f_place)
                day_places_so_far.append(f_place)
                current_loc = f_place
                current_dt = filler["departure_dt"]

                # Re-derive everything for `place` from the new
                # current_dt/current_loc -- each filler absorbs some or
                # all of what remains of the original wait.
                dist = calculate_distance(current_loc, place)
                travel_min = travel_minutes(dist)
                arrival_at_door = current_dt + timedelta(minutes=travel_min)
                open_info = check_is_open(place, arrival_at_door)
                if open_info["status"] in ("Closed", "Closed Today"):
                    logger.info("trip planner: dropping %s, %s at %s", place.name, open_info["status"], arrival_at_door)
                    note_drop(place, f"closed when reached at {arrival_at_door.strftime('%H:%M')}")
                    place_dropped = True
                    break
                gap_minutes = _gap_minutes(place, arrival_at_door, meal_window, open_info)

            if place_dropped:
                continue

            if gap_minutes > 45 and not meta:
                # Nothing done yet today: leave the accommodation later
                # instead of opening the day with a long rest block (live
                # 2026-10-22: a relaxed day began "☕ พักผ่อน 07:00-10:25").
                current_dt += timedelta(minutes=gap_minutes)
                arrival_at_door = current_dt + timedelta(minutes=travel_min)
                open_info = check_is_open(place, arrival_at_door)
                wait_min = open_info["wait_min"] if open_info["status"] == "Waiting" else 0
            elif gap_minutes > 45:
                # Nothing in the pool fit (or there was no pool) -- fall
                # back to a placeholder block rather than leave the gap
                # entirely unaccounted for.
                dummy_loc = Place(
                    id=f"free_time_dummy_{current_dt.strftime('%Y%m%dT%H%M')}",
                    name="☕ พักผ่อนตามอัธยาศัย / แวะเดินเล่นชิลๆ",
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
                meta.append({"kind": "free", "place": dummy_loc, "cost": 0.0, "travel": 0,
                             "arrive": current_dt, "start": current_dt, "depart": free_departure})
                current_dt = free_departure
                arrival_at_door = current_dt + timedelta(minutes=travel_min)
                open_info = check_is_open(place, arrival_at_door)
                wait_min = open_info["wait_min"] if open_info["status"] == "Waiting" else 0
            else:
                wait_min = gap_minutes
        else:
            wait_min = gap_minutes

        start_activity_dt = arrival_at_door + timedelta(minutes=wait_min)
        visit_min = get_visit_duration(place, pace, has_dinner)
        if end and place is route[-1]:
            # Same end-of-day rule as _simulate_day_walk's trim loop. Only
            # ever shortens (a stop that doesn't fit even shortened keeps its
            # normal duration, as before this rule existed).
            fitted = _fit_last_stop_visit(
                place, pace, start_activity_dt, travel_minutes(calculate_distance(place, end)), end_dt_bound,
                has_dinner,
            )
            if fitted is not None:
                visit_min = fitted
        departure_dt = start_activity_dt + timedelta(minutes=visit_min)

        schedule.append(TimeSlot(
            place=place, arrival_time=arrival_at_door.strftime("%H:%M"),
            departure_time=departure_dt.strftime("%H:%M"), travel_time_min=travel_min,
            distance_km=round(dist, 2), status=open_info["status"] if wait_min == 0 else "Waiting",
            wait_time_min=wait_min, is_anchor=place.id in anchor_ids,
            meal_role=meal_roles.get(place.id),
        ))

        stop_cost = _stop_visit_cost(place, dist)
        meta.append({"kind": "stop", "place": place, "cost": stop_cost, "travel": travel_min,
                     "arrive": arrival_at_door, "start": start_activity_dt, "depart": departure_dt})
        day_cost += stop_cost
        day_travel += travel_min
        current_loc = place
        current_dt = departure_dt

    # Tail check (see docstring): gap-filler detours pushed the day later
    # than the planning walk assumed.
    trim_tail()

    # Whatever idle time is left goes into longer stays (see _stretch_stays).
    _stretch_stays(schedule, meta, pace, end, end_dt_bound, has_dinner)
    if meta:
        current_dt = meta[-1]["depart"]

    if current_loc and end:
        dist = calculate_distance(current_loc, end)
        travel_min = travel_minutes(dist)
        arrival_at_end = current_dt + timedelta(minutes=travel_min)
        schedule.append(TimeSlot(
            place=end, arrival_time=arrival_at_end.strftime("%H:%M"),
            departure_time=arrival_at_end.strftime("%H:%M"),
            travel_time_min=travel_min, distance_km=round(dist, 2),
            status=TRIP_END_STATUS if end_loc is not None else "End of Day (Return to Hotel)", wait_time_min=0,
        ))
        day_cost += dist * 4.0
        day_travel += travel_min

    return schedule, round(day_cost, 2), day_travel


def build_day_itinerary(
    day_num: int, day_date: date, day_places: List[Place], hotel: Place,
    start_time_of_day: time, end_time_of_day: time, pace: str,
    meal_roles: Optional[Dict[str, str]] = None,
    backfill_pool: Optional[List[Place]] = None,
    must_go_ids: Optional[set] = None,
    end_loc: Optional[Place] = None,
) -> DailyItinerary:
    meal_roles = meal_roles or {}
    route = order_day_stops(
        day_places, hotel, day_date, start_time_of_day, end_time_of_day, pace, meal_roles,
        must_go_ids=must_go_ids, end_loc=end_loc,
    )
    if backfill_pool:
        route = backfill_underfilled_day(
            route, meal_roles, hotel, day_date, start_time_of_day, end_time_of_day, pace, backfill_pool,
            end_loc=end_loc,
        )
    anchor_ids = {p.id for p in route if find_anchor_window(p, day_date)}
    schedule, day_cost, day_travel = materialize_day_schedule(
        route, anchor_ids, meal_roles, hotel, day_date, start_time_of_day, end_time_of_day, pace,
        gap_filler_pool=backfill_pool, must_go_ids=must_go_ids, end_loc=end_loc,
    )
    return DailyItinerary(
        day=day_num, date=day_date.strftime("%Y-%m-%d"), schedule=schedule,
        day_cost_estimate=day_cost, day_travel_time_total=day_travel,
    )
