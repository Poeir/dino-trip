import logging
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Tuple


from src.core.llm_client import complete_json
from src.core.config import MODEL_NAME
from . import pricing, route_scheduler, trip_ends
from src.core.usage import UsageTracker
from .judge import TripItineraryJudge
from .models import BREAKFAST_PREFERENCE, DailyItinerary, JudgeVerdict, Place, TripInput, meal_food_kinds

logger = logging.getLogger(__name__)

# Max generation rounds. Every round is judged; the first one accepted is
# returned, else the best of them (fewest major issues, then no dropped
# picks, then score). Kept small and NOT an env var (application-logic
# tunable, not a deployment secret) -- together with the per-call timeouts
# below it is what bounds worst-case latency: nothing else in this stack
# (Caddy, the browser's fetch) times a trip request out.
MAX_JUDGE_ATTEMPTS = 2

# Per-call limits for the generation call. Without them the OpenAI SDK's own
# defaults applied (600s per attempt, 2 silent retries), so one stalled
# gateway call could hold a request -- and the traveller on the loading page --
# for half an hour. Generous on purpose: a multi-day prompt on the pro-tier
# model is slow when healthy. No SDK retries: _generate_itinerary_data already
# retries once itself.
GENERATE_TIMEOUT_S = 120
LLM_MAX_RETRIES = 0

# STRICT RULE 6 in generate_prompt() already frames restaurant picks around
# a lunch/dinner pair -- this is that assumption enforced deterministically,
# since the prompt alone doesn't stop the LLM from assigning a 3rd, and
# nothing previously stopped reassign_infeasible_days from doubling a day up
# either. See _enforce_restaurant_cap_and_roles.
MAX_RESTAURANTS_PER_DAY = 2

# Nothing previously capped "คาเฟ่" per day at all -- confirmed live on a
# real itinerary where the LLM (and, since travel_minutes underestimated
# short in-town hops, the scheduler happily agreed) stacked cafes
# back-to-back in one afternoon. Same relocate-or-drop enforcement as
# restaurants, via _enforce_category_cap -- but that only constrains the
# LLM's own picks. Sourced from route_scheduler.CATEGORY_DAILY_CAP (not
# redefined here) since backfill_underfilled_day/_trip and
# materialize_day_schedule's gap-filler there enforce the same number
# independently, on places this cap never saw (see CATEGORY_DAILY_CAP's
# docstring) -- one number, not two that can drift apart.
MAX_CAFES_PER_DAY = route_scheduler.CATEGORY_DAILY_CAP["คาเฟ่"]

# A day's lunch is eaten near that day's other places, and dinner near them
# or near the hotel. Farther than this (the scheduler's in-town/intercity
# boundary) and the restaurant can't serve that meal: a live Phu Wiang day
# (~60 km out) had its only restaurant back in the city, eaten at 16:56.
MEAL_MAX_KM = route_scheduler.INTERCITY_THRESHOLD_KM
_MEAL_WINDOWS = route_scheduler.MEAL_WINDOWS

# Shape of the generator's reply. Enforced on Claude (structured outputs);
# on the Gemini providers it's only described by the prompt's example, so
# _build_itinerary_from_llm_days keeps validating what it reads either way.
# place_id is deliberately not an enum of the candidate ids: a schema that
# changes every request would pay Claude's schema-compile cost every time.
ITINERARY_SCHEMA = {
    "type": "object",
    "properties": {
        "itinerary": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "day": {"type": "integer"},
                    "places": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "place_id": {"type": "string"},
                                "meal_role": {"type": "string", "enum": ["breakfast", "lunch", "dinner"]},
                            },
                            "required": ["place_id"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["day", "places"],
                "additionalProperties": False,
            },
        },
        "rationale": {"type": "string"},
    },
    "required": ["itinerary", "rationale"],
    "additionalProperties": False,
}

# Thai weekday names as they start each line of places.hours (Google's
# weekday_text in Thai), indexed by Python's weekday() (0 = Monday).
_THAI_WEEKDAYS = ("วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์", "วันอาทิตย์")


def _format_minutes(minutes: int) -> str:
    hours, rest = divmod(minutes, 60)
    if not hours:
        return f"{rest}m"
    return f"{hours}h{rest:02d}m" if rest else f"{hours}h"


def hours_for_trip(hours: Optional[str], weekdays: Set[int]) -> str:
    """places.hours cut down to the trip's weekdays, on one line. The full
    week for every candidate was most of the prompt on short trips. Text that
    isn't one line per Thai weekday ("ทุกวัน 8:30–0:00", English) is kept
    whole, just joined onto one line."""
    if not hours:
        return "unknown"
    lines = [line.strip() for line in hours.split("\n") if line.strip()]
    wanted = tuple(_THAI_WEEKDAYS[w] for w in sorted(weekdays))
    kept = [line for line in lines if line.startswith(wanted)]
    return "; ".join(kept or lines)


class LLMTripPlanner:
    def __init__(
        self, candidates: List[Place], start_point: Place = None, must_go_ids: Optional[Set[str]] = None,
        spare_places: Optional[List[Place]] = None, meal_pool: Optional[List[Place]] = None,
        end_point: Optional[Place] = None, budget_level: Optional[str] = None,
    ):
        self.candidates = candidates
        # Ranks the restaurants _pick_fallback_restaurant brings in for a
        # meal (pricing.budget_rank): a หรูหรา day's meal goes to the
        # priciest restaurant that is open and near enough.
        self.budget_level = budget_level
        # trip_ends.resolve_trip_end: where the last day ends instead of the
        # accommodation (start_point). None = it ends there like every day.
        self.end_point = end_point
        # orchestrator.build_meal_pool: every usable restaurant beyond the
        # candidates, never shown to the LLM -- _ensure_meals draws a day's
        # lunch/dinner from it when the day's own picks can't serve that meal.
        self.meal_pool = meal_pool or []
        # orchestrator.build_spare_pool: never shown to the LLM (not in the
        # prompt, not in location_map), only appended to the backfill pool.
        self.spare_places = spare_places or []
        self.start_point = start_point
        # ids from user_input.must_go that were actually found in the DB
        # (see orchestrator.build_candidate_list) -- everything downstream
        # that could otherwise drop a place for being merely cost-
        # inconvenient (order_day_stops' insertion, the restaurant cap)
        # gives these first priority instead of treating them like any
        # other optional candidate. A real infeasibility (closed every day
        # of the trip, etc.) can still drop one -- see last_dropped_must_go.
        self.must_go_ids = must_go_ids or set()
        self.location_map = {loc.id: loc for loc in candidates}
        self.default_model = MODEL_NAME
        self.judge = TripItineraryJudge()
        # One tracker for the whole trip (every generate + judge call, retries
        # included); the route attaches metadata and calls finish().
        self.usage = UsageTracker("trip")
        self.judge.usage = self.usage
        # Populated by _build_itinerary_from_llm_days on every call (most
        # recently by whichever judge round's result solve_route_with_llm
        # ultimately returned) -- must-go places that never made it into
        # the final schedule despite the priority above, for the caller to
        # surface to the user instead of failing silently.
        self.last_dropped_must_go: List[Place] = []
        # Also set by _build_itinerary_from_llm_days, see there.
        self.last_dropped_places: List[Tuple[int, Place]] = []
        self.last_drops_need_regen = False

    def generate_prompt(self, user_input: TripInput, pace_instruction: str, budget_instruction: str, feedback_block: str = "") -> str:
        # No lat/lng here, deliberately -- geographic ordering is entirely
        # the deterministic route_scheduler's job (see
        # _build_itinerary_from_llm_days below). The LLM only curates which
        # places fit the trip and which day they belong on; giving it
        # coordinates would just invite it back into distance/time
        # arithmetic it's structurally unreliable at.
        trip_start_date = datetime.strptime(user_input.start_date, "%Y-%m-%d")
        trip_weekdays = {(trip_start_date + timedelta(days=i)).weekday() for i in range(user_input.trip_duration_days)}
        # Visit length per place, so the picks for a day can actually fit it:
        # without it the LLM put four Phu Wiang sites (two national parks at
        # 2 h each, plus ~1 h of driving each way) on one 09:00-18:00 day and
        # the scheduler had to drop two of them, round after round.
        places_str = "".join(
            f"- ID: {loc.id}, Name: {loc.name}, Category: {loc.category}, Rating: {loc.rating}, "
            f"{f'Type: {loc.subcategory}, ' if loc.subcategory else ''}"
            f"{f'Price: {loc.price}, ' if loc.price and loc.category in pricing.PRICED_CATEGORIES else ''}"
            f"District: {loc.district or 'unknown'}, Visit: ~{_format_minutes(route_scheduler.get_visit_duration(loc, user_input.trip_pace))}, "
            f"Hours: {hours_for_trip(loc.hours, trip_weekdays)}\n"
            for loc in self.candidates
        )

        day_dates_str = ", ".join(
            f"Day {i + 1} = {(trip_start_date + timedelta(days=i)).strftime('%Y-%m-%d (%A)')}"
            for i in range(user_input.trip_duration_days)
        )
        # Which meals the daily window can hold -- the LLM used to tag a
        # "dinner" on days ending 18:00 (dinner starts 17:30), which the
        # scheduler then had to throw away, leaving the day without lunch.
        start_t = datetime.strptime(user_input.start_time, "%H:%M").time()
        end_t = datetime.strptime(user_input.end_time, "%H:%M").time()
        meals = route_scheduler.day_meals(start_t, end_t, breakfast=BREAKFAST_PREFERENCE in user_input.food_preferences)
        if meals:
            meals_str = (
                f"each day has exactly {' and '.join(meals)} -- pick one \"ร้านอาหาร\" per meal, with that meal_role, "
                f"open at that time on that day and in or near the District of that day's other places"
            )
            if "breakfast" in meals:
                meals_str += " (breakfast: a restaurant of Type อาหารเช้า near the accommodation, open in the morning)"
        else:
            meals_str = "the daily window holds no full meal -- at most one \"ร้านอาหาร\" per day, without a meal_role"
        trip_end_str = trip_ends.describe_for_prompt(user_input, self.end_point)
        if trip_end_str:
            last = user_input.trip_duration_days
            last_start, last_end = trip_ends.day_window(user_input, last)
            last_meals = route_scheduler.day_meals(
                last_start, last_end, breakfast=BREAKFAST_PREFERENCE in user_input.food_preferences,
            )
            if not trip_ends.is_travel_only_day(last_start, last_end) and last_meals != meals:
                trip_end_str += f" Day {last}'s meals: {' and '.join(last_meals) if last_meals else 'none'}."
            trip_end_str = f"\n        - Last day: {trip_end_str}"

        # Appended at the very end, deliberately: models weight the tail of a
        # long prompt more heavily as "the final word".
        feedback_section = ""
        if feedback_block:
            feedback_section = f"""

        [FEEDBACK - FIX THESE ISSUES FROM THE PREVIOUS ATTEMPT]
        {feedback_block}
        Generate a corrected itinerary that resolves the above issues while still obeying every [STRICT RULE] above.
        """

        return f"""
        You are a proficient travel planner. Based on the provided candidate locations and the user query, select which places belong in this trip and which day each one goes on. Do NOT decide arrival/departure times or the visiting order within a day -- a separate system handles geographic routing and scheduling deterministically once you've picked the places.

        [USER QUERY]
        - Duration: {user_input.trip_duration_days} days
        - Pace: {user_input.trip_pace}
        - Budget: {user_input.budget_level}
        - Interests: {', '.join(user_input.interests)}
        - Food preferences: {', '.join(user_input.food_preferences) or '(none)'}
        - Must Go: {', '.join(user_input.must_go)}
        - Start: {user_input.start_time}, End: {user_input.end_time}
        - Calendar dates per day: {day_dates_str}
        - Meals: {meals_str}{trip_end_str}

        [DYNAMIC CONSTRAINTS]
        {pace_instruction}
        {budget_instruction}

        [PROVIDED DATA - CANDIDATE LOCATIONS]
        {places_str}

        [STRICT RULES]
        1. All the information in your plan (especially place_id) MUST be derived ONLY from the PROVIDED DATA above. Do not invent places.
        2. Output STRICTLY in JSON format. Do not write any other text.
        3. Align with commonsense: Do not put heavy restaurants back-to-back. Mix attractions, cafes, and restaurants logically across each day.
        4. Do not include "Accommodation/Hotels" in the plan! Only include tourist attractions, cafes, and restaurants. The system will order each day's stops, assign times, and add the return trip to your accommodation automatically.
        5. Each place_id may appear AT MOST ONCE across the entire itinerary -- never assign the same place to two days, or twice on the same day.
        6. Restaurants follow the "Meals" line above: one "ร้านอาหาร" per listed meal per day, its "meal_role" set to that meal ("lunch" or "dinner"), and no extra restaurants. When there are Food preferences, meals' restaurants should have a "Type" from them (rotate through them across meals and days when there are several), but never the same Type for lunch and dinner on one day: when a day has more meals than there are preferences, the extra meal is a different Type. A "เบเกอรี่/ของหวาน" preference means cafes of that Type; "อาหารเช้า" means the breakfast. Never put "meal_role" on non-restaurant places. Fill the rest of each day's hours with attractions/cafes suited to the time of day -- not only evening places on a day that starts in the morning.
        7. Each day's picks must fit its window ({user_input.start_time}-{user_input.end_time}): add up their "Visit" times, about 1 hour per meal, ~10 minutes between places in the same District, and about 1 hour each way between the city and an outlying District. Prefer grouping places from the same or nearby District together within a single day. Spreading far-apart Districts across one day risks the scheduler being unable to fit every pick in time -- when the candidate list offers a same-day alternative in a closer District, prefer it.
        8. Vary each day: at most {MAX_CAFES_PER_DAY} "คาเฟ่" (cafe) places, and at most {route_scheduler.DEFAULT_CATEGORY_DAILY_CAP} places of any other single Category (e.g. "สวนสาธารณะ"), on the same day. Mix categories within a day and spread a big category across days.
        9. "rationale": 1-2 short sentences in Thai, written to the traveller, explaining why these places and this grouping by day suit their request (interests, pace, budget, nearby districts together). Talk only about the trip itself: never mention times, scores, IDs, these rules, the candidate list, places that are missing or could not be included, or how the plan was produced.

        [EXAMPLE JSON OUTPUT FORMAT]
        {{
            "itinerary": [
                {{
                    "day": 1,
                    "places": [
                        {{"place_id": "ID_FROM_LIST", "meal_role": "lunch"}},
                        {{"place_id": "ID_FROM_LIST"}}
                    ]
                }}
            ],
            "rationale": "เน้นวัดและพิพิธภัณฑ์ตามที่สนใจ โดยจัดสถานที่ในอำเภอเดียวกันไว้วันเดียวกันเพื่อลดการเดินทาง"
        }}
        {feedback_section}
        """

    def _call_llm_for_itinerary(self, prompt: str) -> dict:
        # Low temperature (Gemini only; Claude takes none): a structured-output
        # task, not a creative one -- 0.7 carried over from the old project's
        # chat settings made malformed JSON more likely than it needed to be.
        return complete_json(
            system="You are a helpful travel assistant. Output JSON only.",
            user=prompt,
            schema=ITINERARY_SCHEMA,
            timeout=GENERATE_TIMEOUT_S,
            max_retries=LLM_MAX_RETRIES,
            temperature=0.2,
            usage=self.usage,
            label="generate",
            model=self.default_model,
        )

    def _generate_itinerary_data(self, prompt: str) -> dict:
        t0 = time.time()
        data = None
        last_err = None
        for attempt in (1, 2):
            try:
                data = self._call_llm_for_itinerary(prompt)
                break
            except Exception as e:
                last_err = e
                logger.warning("trip planner LLM call/parse failed (attempt %d/2): %s", attempt, e)
        if data is None:
            logger.error("trip planner LLM failed after retry, giving up: %s", last_err)
            raise last_err
        logger.info("trip planner LLM responded in %.2fs", time.time() - t0)
        return data

    def _build_feedback_block(self, verdict: JudgeVerdict) -> str:
        # Not cumulative across rounds -- only the latest verdict's feedback
        # is used, avoiding piling up contradictory feedback if the cap is
        # ever raised later.
        # verdict.feedback already pairs each issue (majors first) with its fix.
        return verdict.feedback or "\n".join(f"- {issue}" for issue in verdict.issues)

    def _build_drop_feedback(self, dropped_by_day: Dict[int, List[Tuple[Place, str]]]) -> str:
        # Deterministic counterpart to _build_feedback_block: the judge is
        # explicitly told NOT to evaluate geographic feasibility (see
        # judge.py's generate_judge_prompt -- that's route_scheduler's job
        # entirely), so a day that order_day_stops couldn't fully fit would
        # otherwise never surface back into the regenerate loop at all --
        # confirmed as a real gap, not just theoretical: nothing else in this
        # loop looks at what got silently dropped, whether by order_day_stops
        # (distance/hours) or _enforce_restaurant_cap_and_roles (too many
        # restaurants that day). Each dropped place carries its own reason
        # string since the two sources drop for unrelated causes.
        if not dropped_by_day:
            return ""
        lines = [
            "[SCHEDULING NOTE - PLACES THAT DID NOT MAKE IT INTO THE FINAL ITINERARY]",
            "The deterministic scheduler could not keep the following picks on the day you assigned them to:",
        ]
        for day_num in sorted(dropped_by_day):
            parts = ", ".join(f"{p.name} ({p.district or 'unknown district'}) -- {reason}" for p, reason in dropped_by_day[day_num])
            lines.append(f"- Day {day_num}: {parts}")
        lines.append("Prefer clustering each day's picks by District (see rule 7), and keep at most "
                      f"{MAX_RESTAURANTS_PER_DAY} \"ร้านอาหาร\" (see rule 6), {MAX_CAFES_PER_DAY} \"คาเฟ่\" and "
                      f"{route_scheduler.DEFAULT_CATEGORY_DAILY_CAP} of any other Category (see rule 8) per day, "
                      "so fewer picks are dropped like this.")
        return "\n".join(lines)

    def _build_post_schedule_feedback(
        self, final_itinerary: List[DailyItinerary], skip_days: Set[int] = frozenset(),
    ) -> str:
        """Checks the itinerary route_scheduler actually materialized, not
        just what got dropped along the way (_build_drop_feedback only sees
        explicit drops): a day with nothing real to visit, and a day still
        without any "ร้านอาหาร". Feeds the same regenerate loop.

        "Real stop" excludes the "Free Time" placeholder (category None) and
        the return-to-hotel leg (category "ที่พัก"): materialize_day_schedule
        always appends that leg, even for a completely empty route, so
        day.schedule is never actually empty.

        The missing-restaurant note is only raised when the candidate pool
        has a restaurant a regenerate round could pick -- a pool with none
        is an orchestrator/retrieval sizing problem the LLM can't fix.

        `skip_days` are days meant to be empty: a departure day too short to
        plan anything in (trip_ends.is_travel_only_day)."""
        has_restaurant_candidate = any(loc.category == "ร้านอาหาร" for loc in self.candidates)
        lines = []
        for day in final_itinerary:
            if day.day in skip_days:
                continue
            real = [s for s in day.schedule if s.place.category not in trip_ends.NON_VISIT_CATEGORIES]
            if not real:
                lines.append(
                    f"- Day {day.day}: completely empty -- none of that day's picks could be scheduled. "
                    "Pick places that are open and geographically close together for this day."
                )
            elif has_restaurant_candidate and not any(s.place.category == "ร้านอาหาร" for s in real):
                lines.append(
                    f"- Day {day.day}: has no \"ร้านอาหาร\" (restaurant) scheduled. Include at least one restaurant."
                )
        if not lines:
            return ""
        return "\n".join(["[SCHEDULING NOTE - DAYS THAT NEED FIXING]", *lines])

    def _enforce_category_cap(
        self, day_assignments: Dict[int, List[Place]], category: str, max_per_day: int,
        used_ids: Set[str], trip_start_date, trip_duration_days: int,
    ) -> List[Tuple[int, Place]]:
        """Trims each day's count of `category` down to `max_per_day`,
        relocating the excess to another day with room (that isn't closed
        that day, per check_is_open) before ever dropping one -- shared
        relocate-or-drop policy behind both _enforce_restaurant_cap_and_roles
        (MAX_RESTAURANTS_PER_DAY) and the คาเฟ่ cap (MAX_CAFES_PER_DAY),
        generalized to whichever single category the caller is enforcing.

        Must-go picks of `category` are kept within the cap first --
        trimming falls on optional picks before ever touching one the user
        explicitly asked for. Stable sort, so within each priority tier the
        original LLM-given order still decides who's first."""
        dropped: List[Tuple[int, Place]] = []

        for day_num in range(1, trip_duration_days + 1):
            places = day_assignments.get(day_num, [])
            matches = [p for p in places if p.category == category]
            if len(matches) <= max_per_day:
                continue
            matches = sorted(matches, key=lambda p: p.id not in self.must_go_ids)
            for place in matches[max_per_day:]:
                day_assignments[day_num].remove(place)
                relocated = False
                for other_day in range(1, trip_duration_days + 1):
                    if other_day == day_num:
                        continue
                    other_places = day_assignments.setdefault(other_day, [])
                    if sum(1 for p in other_places if p.category == category) >= max_per_day:
                        continue
                    other_date = trip_start_date + timedelta(days=other_day - 1)
                    noon = datetime(other_date.year, other_date.month, other_date.day, 12, 0)
                    # Always call check_is_open -- a temporarily/permanently
                    # closed place (business_status) must still be rejected
                    # here even with hours_periods=None, which an
                    # "place.hours_periods and ..." guard would skip
                    # entirely (see check_is_open's business_status check).
                    if route_scheduler.check_is_open(place, noon)["status"] == "Closed Today":
                        continue
                    other_places.append(place)
                    relocated = True
                    logger.info(
                        "trip planner: relocated %s from day %d to day %d (%s cap)",
                        place.name, day_num, other_day, category,
                    )
                    break
                if not relocated:
                    used_ids.discard(place.id)
                    dropped.append((day_num, place))
                    logger.info(
                        "trip planner: dropping %s, every day already has %d %s scheduled",
                        place.name, max_per_day, category,
                    )
        return dropped

    def _enforce_pace_cap(
        self, day_assignments: Dict[int, List[Place]], max_per_day: int,
        used_ids: Set[str], trip_start_date, trip_duration_days: int,
        day_caps: Optional[Dict[int, int]] = None,
    ) -> List[Tuple[int, Place]]:
        """Trims each day's attractions (everything but "ร้านอาหาร", see
        route_scheduler.attraction_count) down to `max_per_day`, the pace's
        cap from pace_stop_range -- the prompt's pace text alone doesn't stop
        the LLM from over-assigning. Same relocate-or-drop policy as
        _enforce_category_cap: an excess pick moves to another day that's
        under the cap and not closed, and is only dropped (returned to the
        unused pool for backfill) when no day has room. Lowest-rated optional
        picks go first; must-go picks are never trimmed, even if they alone
        exceed the cap. `day_caps` overrides the cap for some days (a short
        last day, see trip_ends.py)."""
        dropped: List[Tuple[int, Place]] = []
        day_caps = day_caps or {}

        def cap(day_num: int) -> int:
            return day_caps.get(day_num, max_per_day)

        for day_num in range(1, trip_duration_days + 1):
            places = day_assignments.get(day_num, [])
            excess = route_scheduler.attraction_count(places) - cap(day_num)
            if excess <= 0:
                continue
            trimmable = sorted(
                (p for p in places if p.category != "ร้านอาหาร" and p.id not in self.must_go_ids),
                key=lambda p: p.rating or 0.0,
            )
            for place in trimmable[:excess]:
                day_assignments[day_num].remove(place)
                relocated = False
                for other_day in range(1, trip_duration_days + 1):
                    if other_day == day_num:
                        continue
                    other_places = day_assignments.setdefault(other_day, [])
                    if route_scheduler.attraction_count(other_places) >= cap(other_day):
                        continue
                    other_date = trip_start_date + timedelta(days=other_day - 1)
                    noon = datetime(other_date.year, other_date.month, other_date.day, 12, 0)
                    if route_scheduler.check_is_open(place, noon)["status"] == "Closed Today":
                        continue
                    if not route_scheduler._category_cap_ok(other_places, place):
                        continue
                    other_places.append(place)
                    relocated = True
                    logger.info(
                        "trip planner: relocated %s from day %d to day %d (pace cap)",
                        place.name, day_num, other_day,
                    )
                    break
                if not relocated:
                    used_ids.discard(place.id)
                    dropped.append((day_num, place))
                    logger.info(
                        "trip planner: dropping %s, day %d is over the pace cap of %d attractions",
                        place.name, day_num, cap(day_num),
                    )
        return dropped

    def _enforce_restaurant_cap_and_roles(
        self, day_assignments: Dict[int, List[Place]], meal_roles: Dict[str, str],
        used_ids: Set[str], trip_start_date, trip_duration_days: int, max_per_day: int = MAX_RESTAURANTS_PER_DAY,
    ) -> List[Tuple[int, Place]]:
        """Deterministic backstop for two related gaps STRICT RULE 6 alone
        can't guarantee:
        1. Nothing caps restaurant count per day -- the LLM can (and does)
           sometimes assign 3+, leaving anything past the first two
           role-less (see preferred_time_window's broad fallback window),
           free to land adjacent to another meal.
        2. reassign_infeasible_days (run just before this) can move a
           restaurant into a day that already has one, producing a
           role-less pair even when the day-of-week fix itself was correct
           -- meal_roles is never recomputed after that move.

        Trims each day to MAX_RESTAURANTS_PER_DAY via _enforce_category_cap,
        then re-derives lunch/dinner roles for every day left with exactly 2
        restaurants and an incomplete {lunch, dinner} pairing, regardless of
        how that pair came to be. Returns the (day_num, place) pairs that had
        nowhere to go, for the caller to fold into the same drop-feedback
        loop as order_day_stops-level drops (see _build_drop_feedback)."""
        # `max_per_day` is 3 on trips with a planned breakfast.
        dropped = self._enforce_category_cap(
            day_assignments, "ร้านอาหาร", max_per_day,
            used_ids, trip_start_date, trip_duration_days,
        )

        # Re-derive roles for every day that ends up with exactly 2
        # restaurants and an incomplete {lunch, dinner} pairing -- covers
        # both days trimmed above and days reassign_infeasible_days doubled
        # up before this ever ran. Order within the day's own list decides
        # which gets which (first = lunch, second = dinner), same
        # given-order tie-break convention order_day_stops uses elsewhere.
        for places in day_assignments.values():
            restaurants = [p for p in places if p.category == "ร้านอาหาร"]
            if len(restaurants) != 2:
                continue
            roles = {meal_roles.get(p.id) for p in restaurants}
            if roles == {"lunch", "dinner"} or "breakfast" in roles:
                continue  # complete, or a breakfast pair that _ensure_meals sorts out
            meal_roles[restaurants[0].id] = "lunch"
            meal_roles[restaurants[1].id] = "dinner"

        return dropped

    def _resolve_unfittable_meal_roles(
        self, day_assignments: Dict[int, List[Place]], meal_roles: Dict[str, str],
        start_time_of_day, end_time_of_day, day_windows: Optional[Dict[int, Tuple]] = None,
    ) -> None:
        """A lunch/dinner role is a hard start-time floor in route_scheduler
        (11:00 / 17:30), whoever set it -- the LLM (rule 6) or
        _enforce_restaurant_cap_and_roles. When the day's window can't hold
        that meal at all (a "dinner" on a day ending 18:00) the restaurant can
        never be scheduled. Confirmed on a real trip: it was dropped at the
        very end, after ordering and backfill had treated the afternoon as
        taken, and the day went home at 13:05.

        Such a restaurant is taken off its day here, before ordering, so the
        freed time is planned for -- the day keeps the same meals it ended up
        with before. Not reported as a drop: a regenerate round could only
        "fix" it by not picking a dinner, which is this same result.
        The role alone is removed instead (scheduled by its real opening
        hours) when the place is a must-go or the day's only restaurant.
        Tried and rejected: always just removing the role. In replays the
        freed restaurant became a second anytime meal that landed right after
        lunch (12:18, then 13:23).

        `day_windows` overrides the window for some days (a short last day)."""
        day_windows = day_windows or {}
        for day_num, places in day_assignments.items():
            day_start, day_end = day_windows.get(day_num, (start_time_of_day, end_time_of_day))
            for place in [p for p in places if p.category == "ร้านอาหาร"]:
                role = meal_roles.get(place.id)
                if not role or route_scheduler.meal_role_fits_window(role, day_start, day_end):
                    continue
                del meal_roles[place.id]
                other_meal = any(p.category == "ร้านอาหาร" and p is not place for p in places)
                if place.id in self.must_go_ids or not other_meal:
                    logger.info("trip planner: ignoring meal_role %s on %s, it cannot fit in this day's time window", role, place.name)
                    continue
                places.remove(place)
                logger.info("trip planner: dropping %s, a %s cannot fit in this day's time window", place.name, role)

    def solve_route_with_llm(self, user_input: TripInput, pace_instruction: str, budget_instruction: str) -> Tuple[List[DailyItinerary], str]:
        feedback_block = ""
        # Best round so far: (sort key, itinerary, rationale, dropped picks). A
        # regenerated plan isn't always better than the one it replaces, so
        # every round is judged and the best one is returned, not the last.
        best = None

        for judge_round in range(1, MAX_JUDGE_ATTEMPTS + 1):
            prompt = self.generate_prompt(user_input, pace_instruction, budget_instruction, feedback_block)
            data = self._generate_itinerary_data(prompt)
            final_itinerary, drop_feedback = self._build_itinerary_from_llm_days(data, user_input)
            dropped_must_go = self.last_dropped_must_go
            # The generator's own user-facing explanation (prompt rule 9).
            # The judge writes one too, after seeing the real schedule, and
            # that one wins when the judge ran.
            gen_rationale = str(data.get("rationale") or "").strip()

            scheduled_ids = {slot.place.id for day in final_itinerary for slot in day.schedule}
            didnt_fit = self.last_dropped_places
            didnt_fit_ids = {p.id for _, p in didnt_fit}
            unused = [p for p in self.candidates if p.id not in scheduled_ids and p.id not in didnt_fit_ids]
            verdict = self.judge.evaluate(user_input, final_itinerary, unused=unused, dropped=didnt_fit)
            rationale = verdict.rationale or gen_rationale
            drops_need_regen = self.last_drops_need_regen
            accepted = verdict.passed and not drops_need_regen
            key = (verdict.major_issues, drops_need_regen, -verdict.score)
            if best is None or key < best[0]:
                best = (key, final_itinerary, rationale, dropped_must_go)

            if judge_round == MAX_JUDGE_ATTEMPTS and not accepted:
                _, best_itinerary, best_rationale, best_dropped = best
                logger.info(
                    "trip planner: no round fully accepted in %d attempt(s); returning the best (majors=%d, dropped=%s, score=%.2f)",
                    MAX_JUDGE_ATTEMPTS, best[0][0], best[0][1], -best[0][2],
                )
                # last_dropped_must_go must describe the itinerary returned.
                self.last_dropped_must_go = best_dropped
                return best_itinerary, best_rationale

            # A pass is accepted unless the drops need fixing on their own
            # (a must-go missing, a day empty or without a restaurant; see
            # last_drops_need_regen). An optional pick that didn't fit is not
            # worth another round once the judge is happy with the result.
            if accepted:
                if verdict.judge_call_failed:
                    # Not a genuine evaluation -- see JudgeVerdict.judge_call_failed.
                    # Still returned as-is (fail-open is deliberate, see judge.py),
                    # but logged as a warning, not the same info-level "passed" line
                    # a real pass gets, so this is distinguishable in logs/metrics.
                    logger.warning(
                        "trip planner: judge call failed on round %d/%d -- accepting itinerary unevaluated (fail-open, not a genuine pass)",
                        judge_round, MAX_JUDGE_ATTEMPTS,
                    )
                else:
                    logger.info("trip planner: judge passed on round %d/%d (score=%.2f)", judge_round, MAX_JUDGE_ATTEMPTS, verdict.score)
                return final_itinerary, rationale

            logger.info(
                "trip planner: round %d/%d not accepted (judge passed=%s majors=%d score=%.2f, drops_need_regen=%s) - regenerating",
                judge_round, MAX_JUDGE_ATTEMPTS, verdict.passed, verdict.major_issues, verdict.score, drops_need_regen,
            )
            feedback_parts = []
            if not verdict.passed:
                feedback_parts.append(self._build_feedback_block(verdict))
            if drop_feedback:
                feedback_parts.append(drop_feedback)
            feedback_block = "\n".join(feedback_parts).strip()

        raise AssertionError("unreachable: the last round always returns")

    def _day_anchor(self, day_places: List[Place]) -> Optional[Place]:
        """Centre of a day's non-restaurant places, or the hotel when it has none."""
        located = [p for p in day_places if p.category != "ร้านอาหาร" and p.lat is not None and p.lng is not None]
        if not located:
            return self.start_point
        return Place(
            id="day_centroid", name="day_centroid",
            lat=sum(p.lat for p in located) / len(located), lng=sum(p.lng for p in located) / len(located),
        )

    def _meal_distance(self, loc: Place, anchor: Optional[Place], meal: Optional[str]) -> float:
        """How far `loc` is from where that meal is eaten: the day's places,
        or for breakfast/dinner also the hotel (the day starts/ends there)."""
        if loc.lat is None or loc.lng is None:
            return 0.0
        dists = [route_scheduler.calculate_distance(anchor, loc)] if anchor else []
        if meal in ("breakfast", "dinner") and self.start_point:
            dists.append(route_scheduler.calculate_distance(self.start_point, loc))
        return min(dists) if dists else 0.0

    def _serves_meal(self, loc: Place, meal: str, day_date, start_min: int, end_min: int, anchor: Optional[Place]) -> bool:
        """Open for `meal` on that day, within the day's window, and near enough."""
        return (
            route_scheduler.open_for_meal(loc, [day_date], start_min, end_min, _MEAL_WINDOWS[meal])
            and self._meal_distance(loc, anchor, meal) <= MEAL_MAX_KM
        )

    def _pick_fallback_restaurant(
        self, day_places: List[Place], day_date, start_time_of_day, end_time_of_day, used_ids: Set[str],
        meal: Optional[str] = None, kinds: Optional[List[str]] = None, avoid: Set[str] = frozenset(),
    ) -> Optional[Place]:
        """Restaurant to serve a day's `meal` ("lunch"/"dinner"; None = any
        meal the window has), from the unused candidates and the meal pool.
        `kinds` (subcategories, most wanted first) limits it to restaurants of
        those kinds, ranked in that order after the open/near checks; kinds
        in `avoid` (already eaten that day) go after the rest.
        Used to be "the first unused restaurant in candidate order", which
        ignored when it opens and where it is: a 09:00-18:00 day got an
        evening-only restaurant and a Phu Wiang day an in-town one.
        Order of preference: open at the meal time, then at least visitable
        in the window, then within MEAL_MAX_KM, then a candidate (the LLM's
        interest-matched pool) over the meal pool, then closest (2 km steps),
        then best rated. Ties keep candidate order."""
        pool = [loc for loc in self.candidates if loc.id not in used_ids and loc.category == "ร้านอาหาร"]
        candidate_ids = {loc.id for loc in pool}
        pool += [loc for loc in self.meal_pool if loc.id not in used_ids and loc.id not in candidate_ids]
        kind_rank = {k: i for i, k in enumerate(kinds or [])}
        if kinds:
            pool = [loc for loc in pool if loc.subcategory in kind_rank]
        if not pool:
            return None

        start_min = start_time_of_day.hour * 60 + start_time_of_day.minute
        end_min = end_time_of_day.hour * 60 + end_time_of_day.minute
        if meal == "breakfast":
            meal_min = 8 * 60 + 30
        elif meal == "lunch" or (meal is None and start_min <= 12 * 60 + 30 and end_min >= 13 * 60 + 30):
            meal_min = 12 * 60 + 15
        elif meal == "dinner" or (meal is None and start_min <= 18 * 60 + 30 and end_min >= 19 * 60 + 30):
            meal_min = 18 * 60 + 30
        else:
            meal_min = (start_min + end_min) // 2
        meal_min = min(max(meal_min, start_min), end_min - route_scheduler.MEAL_MIN_OPEN_MINUTES)
        meal_dt = datetime(day_date.year, day_date.month, day_date.day, meal_min // 60, meal_min % 60)
        anchor = self._day_anchor(day_places)
        window = _MEAL_WINDOWS.get(meal)

        def key(loc: Place):
            is_open = route_scheduler.check_is_open(loc, meal_dt)["is_open"]
            # Not open at the ideal meal time, but still visitable somewhere in
            # the window (the meal's own window when there is one), beats a
            # place that can never be visited -- scheduling that one drops it.
            visitable = is_open or route_scheduler.open_for_meal(loc, [day_date], start_min, end_min, window)
            dist = self._meal_distance(loc, anchor, meal)
            return (
                not is_open, not visitable, dist > MEAL_MAX_KM, loc.subcategory in avoid, kind_rank.get(loc.subcategory, 0),
                pricing.budget_sort_key(loc, self.budget_level) if self.budget_level and meal != "breakfast" else (0, 0, 0),
                loc.id not in candidate_ids, int(dist // 2), -(loc.rating or 0.0),
            )

        return min(pool, key=key)

    def _ensure_meals(
        self, day_assignments: Dict[int, List[Place]], meal_roles: Dict[str, str], used_ids: Set[str],
        trip_start_date, trip_duration_days: int, start_time_of_day, end_time_of_day,
        food_kinds: Optional[List[str]] = None, breakfast: bool = False,
        day_windows: Optional[Dict[int, Tuple]] = None,
    ) -> Set[str]:
        """Every day gets one restaurant per meal its window can hold (lunch,
        dinner), each open at that meal and near that day's places, and no
        restaurant that isn't one of those meals. Returns the ids added here,
        which ordering then treats as priority stops.

        `food_kinds` (the traveller's food preferences, as restaurant
        subcategories) come first: a meal goes to the LLM's restaurant of a
        wanted kind, else one of a wanted kind is brought in, and only then
        to any restaurant. Meal after meal the kinds rotate, so "อีสาน +
        ก๋วยเตี๋ยว" alternates rather than one kind winning every meal.

        Per day and meal: keep a restaurant already holding that role, else
        give the role to a role-less one, if it serves the meal (_serves_meal);
        otherwise bring one in from the candidates/meal pool
        (_pick_fallback_restaurant). Restaurants left without a meal are taken
        off the day -- a role-less restaurant used to be placed anywhere from
        11:00 to 20:00, which put days' only meal at 14:55 or 17:07 -- unless
        it's a must-go, or no restaurant could be found for a meal at all
        (then the best leftover still feeds the traveller, role-less).

        `day_windows` overrides the window for some days (a short last day,
        which may hold fewer meals)."""
        day_windows = day_windows or {}
        added: Set[str] = set()
        food_kinds = list(food_kinds or [])
        meal_no = 0  # meals served so far, for rotating food_kinds

        def kinds_now() -> List[str]:
            k = meal_no % len(food_kinds)
            return food_kinds[k:] + food_kinds[:k]

        for day_num in range(1, trip_duration_days + 1):
            day_start, day_end = day_windows.get(day_num, (start_time_of_day, end_time_of_day))
            start_min = day_start.hour * 60 + day_start.minute
            end_min = day_end.hour * 60 + day_end.minute
            meals = route_scheduler.day_meals(day_start, day_end, breakfast=breakfast)
            if not meals:
                continue  # a window with no mealtime (e.g. 14:00-17:00): restaurants stay as picked
            places = day_assignments.setdefault(day_num, [])
            day_date = trip_start_date + timedelta(days=day_num - 1)
            anchor = self._day_anchor(places)
            restaurants = [p for p in places if p.category == "ร้านอาหาร"]
            served: Dict[str, Place] = {}
            # An evening market is where a Thai evening's food is: it serves
            # dinner (and keeps its full evening visit) without a restaurant.
            if "dinner" in meals:
                market = next((p for p in places if route_scheduler.market_kind(p) == "evening"), None)
                if market and not any(meal_roles.get(p.id) == "dinner" for p in restaurants):
                    served["dinner"] = market

            # Lunch/dinner kinds already eaten today: a kind is served at most
            # once a day while another will do (live: one "ปิ้งย่าง/ชาบู"
            # choice gave shabu at all four meals of a two-day trip).
            day_kinds: Set[str] = set()

            def take_llm_pick(meal, kinds=None, avoid=frozenset()) -> bool:
                # Already holding this role first, then role-less, then LLM
                # order -- a role that doesn't fit the window was already
                # stripped by _resolve_unfittable_meal_roles. With `kinds`,
                # only those, the earlier kind first; never a kind in `avoid`.
                rank = {k: i for i, k in enumerate(kinds or [])}
                options = sorted(
                    (p for p in restaurants if p not in served.values() and meal_roles.get(p.id) in (meal, None)
                     and (not kinds or p.subcategory in rank) and p.subcategory not in avoid),
                    key=lambda p: (rank.get(p.subcategory, 0), meal_roles.get(p.id) != meal),
                )
                for p in options:
                    if self._serves_meal(p, meal, day_date, start_min, end_min, anchor):
                        served[meal] = p
                        meal_roles[p.id] = meal
                        return True
                return False

            def bring_in(meal, kinds=None, avoid=frozenset()) -> bool:
                pick = self._pick_fallback_restaurant(places, day_date, day_start, day_end, used_ids, meal, kinds, avoid)
                if not pick or pick.subcategory in avoid or not self._serves_meal(pick, meal, day_date, start_min, end_min, anchor):
                    return False
                places.append(pick)
                used_ids.add(pick.id)
                meal_roles[pick.id] = meal
                served[meal] = pick
                added.add(pick.id)
                logger.info("trip planner: day %d %s -> %s", day_num, meal, pick.name)
                return True

            for meal in meals:
                if meal in served:
                    continue
                if meal == "breakfast":
                    # A breakfast shop first; any restaurant open then, after.
                    # Not part of food_kinds' rotation (that's lunch/dinner).
                    _ = take_llm_pick(meal, ["อาหารเช้า"]) or bring_in(meal, ["อาหารเช้า"]) or take_llm_pick(meal) or bring_in(meal)
                    continue
                # A wanted kind not eaten yet today; once every wanted kind
                # has had its meal today, this meal is free -- any kind,
                # preferring one not eaten today either.
                # A kind already eaten today is avoided outright first (the
                # LLM often picks the same kind for both meals), and only
                # accepted when no other restaurant can serve the meal.
                # Breakfast shops are avoided at lunch/dinner the same way
                # (live: one open late was the LLM's dinner pick).
                kinds = [k for k in kinds_now() if k not in day_kinds] if food_kinds else []
                avoid = day_kinds | {"อาหารเช้า"}
                if kinds and (take_llm_pick(meal, kinds) or bring_in(meal, kinds)):
                    meal_no += 1
                elif not (take_llm_pick(meal, avoid=avoid) or bring_in(meal, avoid=avoid)
                          or take_llm_pick(meal) or bring_in(meal)):
                    continue
                if served[meal].subcategory:
                    day_kinds.add(served[meal].subcategory)

            unserved = [m for m in meals if m not in served]
            for p in restaurants:
                if p in served.values():
                    continue
                if p.id in self.must_go_ids:
                    if meal_roles.get(p.id) not in meals:
                        meal_roles.pop(p.id, None)
                    continue
                if unserved:
                    # Nothing better exists for that meal: keep this one, role-less.
                    unserved.pop(0)
                    meal_roles.pop(p.id, None)
                    continue
                places.remove(p)
                used_ids.discard(p.id)
                meal_roles.pop(p.id, None)
                logger.info("trip planner: day %d drops %s, not one of the day's meals", day_num, p.name)
        return added

    def _build_itinerary_from_llm_days(self, data: dict, user_input: TripInput) -> Tuple[List[DailyItinerary], str]:
        """Turns the LLM's day-assignment output into a real itinerary:
        real ordering, real arrival/departure times, real opening-hours
        enforcement -- all owned by route_scheduler, none of it trusted
        from the LLM. See generate_prompt() for what the LLM is and isn't
        asked to decide.

        Also returns a drop-feedback string (empty if nothing was dropped)
        for solve_route_with_llm to feed into the next regenerate round --
        see _build_drop_feedback. Sets self.last_dropped_must_go as a side
        effect (not part of the return tuple, to avoid rippling a signature
        change through every existing caller/test of this and
        solve_route_with_llm) -- a final schedule-vs-must_go_ids diff,
        which catches every way a must-go place can still fail to appear
        (LLM never picked it, order_day_stops couldn't fit it, restaurant
        cap, or a real opening-hours conflict at materialize time), not
        just the ones this function explicitly tracks in dropped_by_day."""
        trip_start_date = datetime.strptime(user_input.start_date, "%Y-%m-%d").date()
        start_time_of_day = datetime.strptime(user_input.start_time, "%H:%M").time()
        end_time_of_day = datetime.strptime(user_input.end_time, "%H:%M").time()

        day_assignments: Dict[int, List[Place]] = {}
        meal_roles: Dict[str, str] = {}
        used_ids: Set[str] = set()

        for day_data in data.get("itinerary", []):
            day_num = day_data["day"]
            places_for_day = []
            for entry in day_data.get("places", []):
                loc_id = entry.get("place_id")
                if loc_id is None or loc_id not in self.location_map:
                    continue
                if loc_id in used_ids:
                    # STRICT RULE #5 asked the LLM not to repeat a place_id,
                    # but isn't always reliable about it -- deterministic
                    # backstop, keep only the first occurrence.
                    logger.info("trip planner: dropping duplicate place_id %s from day %d", loc_id, day_num)
                    continue
                used_ids.add(loc_id)
                places_for_day.append(self.location_map[loc_id])
                role = entry.get("meal_role")
                if role in route_scheduler.MEAL_WINDOWS:
                    meal_roles[loc_id] = role
            day_assignments[day_num] = places_for_day

        # Per-day windows and end points (trip_ends.py): only the last day can
        # differ, when the trip ends somewhere other than the accommodation.
        # A last day too short for any stop (an early flight) is not planned
        # at all: whatever the LLM put on it goes back to the unused pool, and
        # every step below works on the days before it (`plan_days`).
        num_days = user_input.trip_duration_days
        day_windows = {
            d: trip_ends.day_window(user_input, d) if self.end_point is not None else (start_time_of_day, end_time_of_day)
            for d in range(1, num_days + 1)
        }
        end_locs = {num_days: self.end_point} if self.end_point is not None else {}
        travel_only_days = (
            {num_days} if self.end_point is not None and trip_ends.is_travel_only_day(*day_windows[num_days]) else set()
        )
        plan_days = num_days - (1 if num_days in travel_only_days else 0)
        if travel_only_days and self.start_point is not None:
            # Leave the accommodation in time for the departure, not at start_time.
            to_end = route_scheduler.travel_minutes(route_scheduler.calculate_distance(self.start_point, self.end_point))
            day_windows[num_days] = trip_ends.departure_day_window(user_input, to_end)
        for p in day_assignments.pop(num_days, []) if num_days in travel_only_days else []:
            used_ids.discard(p.id)
            meal_roles.pop(p.id, None)
            logger.info("trip planner: day %d is the departure day, not planning %s on it", num_days, p.name)
        llm_pick_ids = set(used_ids)  # for TimeSlot.source

        # The "Must Go" list in generate_prompt() is only a hint -- STRICT
        # RULE 1 doesn't force the LLM to actually include every must-go id
        # in its output, and it sometimes just doesn't. Inject anything
        # missing here, onto whichever day currently has the fewest picks,
        # before reassign_infeasible_days/ordering run -- so it gets the
        # same day-of-week feasibility check as an LLM-picked place, and so
        # order_day_stops' must-go priority tier (below) gets a chance to
        # actually fit it in rather than the place never being considered
        # at all.
        for must_go_id in self.must_go_ids:
            if must_go_id in used_ids or must_go_id not in self.location_map or plan_days < 1:
                continue
            target_day = min(
                range(1, plan_days + 1),
                key=lambda d: len(day_assignments.get(d, [])),
            )
            day_assignments.setdefault(target_day, []).append(self.location_map[must_go_id])
            used_ids.add(must_go_id)
            logger.info(
                "trip planner: LLM did not pick must-go place %s -- injecting into day %d",
                self.location_map[must_go_id].name, target_day,
            )

        day_assignments = route_scheduler.reassign_infeasible_days(
            day_assignments, trip_start_date, plan_days,
        )

        wants_breakfast = BREAKFAST_PREFERENCE in user_input.food_preferences
        trip_meals = route_scheduler.day_meals(start_time_of_day, end_time_of_day, breakfast=wants_breakfast)
        restaurant_cap_drops = self._enforce_restaurant_cap_and_roles(
            day_assignments, meal_roles, used_ids, trip_start_date, plan_days,
            max_per_day=max(MAX_RESTAURANTS_PER_DAY, len(trip_meals)),
        )
        self._resolve_unfittable_meal_roles(
            day_assignments, meal_roles, start_time_of_day, end_time_of_day, day_windows=day_windows,
        )
        cafe_cap_drops = self._enforce_category_cap(
            day_assignments, "คาเฟ่", MAX_CAFES_PER_DAY,
            used_ids, trip_start_date, plan_days,
        )
        # Same relocate-or-drop for every other category, at
        # route_scheduler.category_daily_cap (3) -- the "family + nature"
        # trips' 4-5 parks a day were the LLM's own picks.
        other_categories = sorted({
            p.category for places in day_assignments.values() for p in places
            if p.category not in ("คาเฟ่", None) and route_scheduler.category_daily_cap(p.category)
        })
        for category in other_categories:
            for day_num, place in self._enforce_category_cap(
                day_assignments, category, route_scheduler.category_daily_cap(category),
                used_ids, trip_start_date, plan_days,
            ):
                cafe_cap_drops.append((day_num, place))
        stop_min, stop_max = route_scheduler.pace_stop_range(
            user_input.trip_pace, start_time_of_day, end_time_of_day, breakfast=wants_breakfast,
        )
        # A shorter last day gets its own (smaller) range; a departure-only
        # day gets none, so backfill never puts anything on it.
        stop_ranges = {
            d: (0, 0) if d in travel_only_days
            else route_scheduler.pace_stop_range(user_input.trip_pace, s, e, breakfast=wants_breakfast)
            for d, (s, e) in day_windows.items()
        }
        pace_cap_drops = self._enforce_pace_cap(
            day_assignments, stop_max, used_ids, trip_start_date, plan_days,
            day_caps={d: r[1] for d, r in stop_ranges.items()},
        )
        dropped_by_day: Dict[int, List[Tuple[Place, str]]] = {}
        for day_num, place in pace_cap_drops:
            dropped_by_day.setdefault(day_num, []).append((
                place,
                f"day already had {stop_ranges[day_num][1]} attractions, the max for {user_input.trip_pace} pace in this time window",
            ))
        for day_num, place in restaurant_cap_drops:
            reason = f"day already had {MAX_RESTAURANTS_PER_DAY} \"ร้านอาหาร\" scheduled"
            if place.id in self.must_go_ids:
                reason = "MUST-GO PLACE -- " + reason
            dropped_by_day.setdefault(day_num, []).append((place, reason))
        for day_num, place in cafe_cap_drops:
            cap = route_scheduler.category_daily_cap(place.category)
            reason = f"every day already had {cap} \"{place.category}\" scheduled"
            if place.id in self.must_go_ids:
                reason = "MUST-GO PLACE -- " + reason
            dropped_by_day.setdefault(day_num, []).append((place, reason))

        # A day with zero "ร้านอาหาร" picks is not a reasonable itinerary
        # regardless of stated interests -- top each such day up with one
        # unused restaurant candidate (see orchestrator.py's meal reserve,
        # which keeps a small supply of these available even when nothing
        # else surfaced any). Left role-less (single restaurant that day):
        # STRICT RULE #6 in the prompt above only assigns lunch/dinner when
        # a day has two, which still applies correctly since the LLM's own
        # picks are untouched here.
        # Tracked separately from self.must_go_ids (not merged into it, or
        # last_dropped_must_go would report an auto-injected restaurant to
        # the user as something they asked for) and unioned into
        # order_day_stops' priority tier below, so the injected restaurant
        # isn't silently dropped like any other optional pick.
        meal_fallback_ids = self._ensure_meals(
            day_assignments, meal_roles, used_ids, trip_start_date, plan_days,
            start_time_of_day, end_time_of_day,
            food_kinds=meal_food_kinds(user_input.food_preferences), breakfast=wants_breakfast,
            day_windows=day_windows,
        )
        # A window with no mealtime still gets one restaurant on a day that
        # has none (the old rule), placed by its opening hours.
        for day_num in range(1, plan_days + 1):
            day_places = day_assignments.setdefault(day_num, [])
            if any(p.category == "ร้านอาหาร" for p in day_places):
                continue
            restaurant = self._pick_fallback_restaurant(
                day_places, trip_start_date + timedelta(days=day_num - 1),
                *day_windows[day_num], used_ids,
            )
            if restaurant:
                day_places.append(restaurant)
                used_ids.add(restaurant.id)
                meal_fallback_ids.add(restaurant.id)

        # Candidates the LLM had access to but didn't pick for any day --
        # available for backfill_underfilled_trip (below) to top up a day
        # that ends up egregiously under-filled, and, after that, for
        # materialize_day_schedule's gap_filler_pool to replace individual
        # "free time" placeholder blocks with a real nearby stop wherever
        # one fits. Restaurants are excluded: neither backfill nor the gap
        # filler assigns a meal_role, and an unplanned extra meal is a
        # worse outcome than a day that's merely short. Shared (same list)
        # across every day and mutated as days consume from it, so no place
        # can end up used twice.
        backfill_pool = [
            loc for loc in self.candidates
            if loc.id not in used_ids and loc.category != "ร้านอาหาร"
        ] + self.spare_places

        # Order every day's stops first (geography/time-of-day only, no
        # backfill yet) so the cross-day pass below can see every day's real
        # gaps before deciding where to spend the shared, limited pool --
        # backfilling day-by-day in day-number order (i.e. calling
        # build_day_itinerary, which backfills a single day to completion,
        # once per day in this same loop) let an early day exhaust the pool
        # before later days got a turn, confirmed live on a 3-day request
        # where day 1 alone consumed it down to nothing.
        # Diffed against each day's pre-ordering assignment so backfill_pool
        # additions below (which are new picks, not drops) never get counted
        # here -- see _build_drop_feedback for why this needs to reach the
        # regenerate loop instead of staying a silent route_scheduler log line.
        # dropped_by_day already carries restaurant-cap drops from above;
        # this loop adds geography/hours drops onto the same dict.
        routes = {}
        day_dates = {}
        for day_num in range(1, user_input.trip_duration_days + 1):
            day_date = trip_start_date + timedelta(days=day_num - 1)
            day_dates[day_num] = day_date
            day_places = day_assignments.get(day_num, [])
            ordered = route_scheduler.order_day_stops(
                day_places, self.start_point, day_date,
                *day_windows[day_num], user_input.trip_pace, meal_roles,
                must_go_ids=self.must_go_ids | meal_fallback_ids, end_loc=end_locs.get(day_num),
            )
            routes[day_num] = ordered
            ordered_ids = {p.id for p in ordered}
            missing = [p for p in day_places if p.id not in ordered_ids]
            for p in missing:
                reason = "too far from / opening-hours conflict with the rest of that day's picks"
                if p.id in self.must_go_ids:
                    reason = "MUST-GO PLACE -- " + reason
                dropped_by_day.setdefault(day_num, []).append((p, reason))

        before_backfill = {d: {p.id for p in r} for d, r in routes.items()}
        routes = route_scheduler.backfill_underfilled_trip(
            routes, day_dates, meal_roles, self.start_point,
            start_time_of_day, end_time_of_day, user_input.trip_pace, backfill_pool,
            stop_range=(stop_min, stop_max),
            day_windows=day_windows, end_locs=end_locs, stop_ranges=stop_ranges,
        )

        def source_of(place: Place, day_num: int) -> Optional[str]:
            if place.category in trip_ends.NON_VISIT_CATEGORIES:
                return None
            if place.is_spare:
                return "spare"
            if place.id in meal_fallback_ids:
                return "meal"
            if place.id in llm_pick_ids:
                return "llm"
            if place.id in self.must_go_ids:
                return "must_go"
            if place.id in {p.id for p in routes[day_num]} - before_backfill.get(day_num, set()):
                return "backfill"
            return "gap_filler"

        final_itinerary = []
        for day_num in range(1, user_input.trip_duration_days + 1):
            route = routes[day_num]
            day_date = day_dates[day_num]
            anchor_ids = {p.id for p in route if route_scheduler.find_anchor_window(p, day_date)}
            late_drops: List[Tuple[Place, str]] = []
            schedule, day_cost, day_travel = route_scheduler.materialize_day_schedule(
                route, anchor_ids, meal_roles, self.start_point,
                day_date, *day_windows[day_num], user_input.trip_pace,
                gap_filler_pool=backfill_pool, max_attractions=stop_ranges[day_num][1],
                must_go_ids=self.must_go_ids | meal_fallback_ids,
                dropped=late_drops, end_loc=end_locs.get(day_num),
            )
            for slot in schedule:
                slot.source = source_of(slot.place, day_num)
            final_itinerary.append(DailyItinerary(
                day=day_num, date=day_date.strftime("%Y-%m-%d"), schedule=schedule,
                day_cost_estimate=day_cost, day_travel_time_total=day_travel,
            ))
            # Picks that survived ordering but not the real schedule used to
            # vanish with only a log line, so the regenerate loop never heard
            # of them. Backfill additions are not the LLM's picks -- skipped.
            assigned_ids = {p.id for p in day_assignments.get(day_num, [])}
            for p, reason in late_drops:
                if p.id not in assigned_ids:
                    continue
                if p.id in self.must_go_ids:
                    reason = "MUST-GO PLACE -- " + reason
                dropped_by_day.setdefault(day_num, []).append((p, reason))

        drop_feedback = self._build_drop_feedback(dropped_by_day)
        post_schedule_feedback = self._build_post_schedule_feedback(final_itinerary, skip_days=travel_only_days)
        if post_schedule_feedback:
            drop_feedback = f"{drop_feedback}\n{post_schedule_feedback}" if drop_feedback else post_schedule_feedback

        scheduled_ids = {slot.place.id for day in final_itinerary for slot in day.schedule}
        self.last_dropped_must_go = [
            self.location_map[mid] for mid in self.must_go_ids
            if mid not in scheduled_ids and mid in self.location_map
        ]
        # Picks that didn't make it into the schedule, per day -- the judge is
        # told not to suggest them again (live: it asked to add back a park
        # the scheduler had just dropped for not fitting the day).
        self.last_dropped_places = [
            (day_num, p) for day_num, items in sorted(dropped_by_day.items())
            for p, _ in items if p.id not in scheduled_ids
        ]
        # Worth a regenerate round on their own: a must-go that didn't make
        # it, or a day left empty / without a restaurant. An optional pick
        # dropped for not fitting is not -- live, the next round dropped the
        # same park again, 26 s later, with the judge already happy.
        self.last_drops_need_regen = bool(post_schedule_feedback) or bool(self.last_dropped_must_go)
        return final_itinerary, drop_feedback
