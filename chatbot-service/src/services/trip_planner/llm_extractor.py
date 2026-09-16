import json
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, List, Set, Tuple

from openai import OpenAI

from src.core.config import API_KEY, BASE_URL, TRIP_PLANNER_MODEL_NAME
from . import route_scheduler
from .json_utils import clean_json_string
from .judge import TripItineraryJudge
from .models import DailyItinerary, JudgeVerdict, Place, TripInput

logger = logging.getLogger(__name__)

# Max "generate -> judge" cycles before giving up on quality and returning the
# last itinerary anyway. Kept small and NOT an env var (application-logic
# tunable, not a deployment secret) -- there is no request timeout anywhere in
# this stack, so this cap is the only thing bounding worst-case latency.
MAX_JUDGE_ATTEMPTS = 2

# STRICT RULE 6 in generate_prompt() already frames restaurant picks around
# a lunch/dinner pair -- this is that assumption enforced deterministically,
# since the prompt alone doesn't stop the LLM from assigning a 3rd, and
# nothing previously stopped reassign_infeasible_days from doubling a day up
# either. See _enforce_restaurant_cap_and_roles.
MAX_RESTAURANTS_PER_DAY = 2


class LLMTripPlanner:
    def __init__(self, candidates: List[Place], start_point: Place = None):
        self.candidates = candidates
        self.start_point = start_point
        self.location_map = {loc.id: loc for loc in candidates}
        self.default_model = TRIP_PLANNER_MODEL_NAME
        self.client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
        self.judge = TripItineraryJudge()

    def generate_prompt(self, user_input: TripInput, pace_instruction: str, budget_instruction: str, feedback_block: str = "") -> str:
        # No lat/lng here, deliberately -- geographic ordering is entirely
        # the deterministic route_scheduler's job (see
        # _build_itinerary_from_llm_days below). The LLM only curates which
        # places fit the trip and which day they belong on; giving it
        # coordinates would just invite it back into distance/time
        # arithmetic it's structurally unreliable at.
        places_str = "".join(
            f"- ID: {loc.id}, Name: {loc.name}, Category: {loc.category}, Rating: {loc.rating}, "
            f"District: {loc.district or 'unknown'}, Hours: {loc.hours or 'unknown'}\n"
            for loc in self.candidates
        )

        trip_start_date = datetime.strptime(user_input.start_date, "%Y-%m-%d")
        day_dates_str = ", ".join(
            f"Day {i + 1} = {(trip_start_date + timedelta(days=i)).strftime('%Y-%m-%d (%A)')}"
            for i in range(user_input.trip_duration_days)
        )

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
        - Must Go: {', '.join(user_input.must_go)}
        - Start: {user_input.start_time}, End: {user_input.end_time}
        - Calendar dates per day: {day_dates_str}

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
        6. If a day includes two "ร้านอาหาร" (restaurant) places, set "meal_role" to "lunch" on one and "dinner" on the other so each gets scheduled at the right time of day. Omit "meal_role" entirely otherwise (single restaurant that day, or non-restaurant places).
        7. Prefer grouping places from the same or nearby District together within a single day. Spreading far-apart Districts across one day risks the scheduler being unable to fit every pick in time -- when the candidate list offers a same-day alternative in a closer District, prefer it.

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
            ]
        }}
        {feedback_section}
        """

    def _call_llm_for_itinerary(self, prompt: str) -> dict:
        response = self.client.chat.completions.create(
            model=self.default_model,
            messages=[
                {"role": "system", "content": "You are a helpful travel assistant. Output JSON only."},
                {"role": "user", "content": prompt},
            ],
            stream=False,
            # Low temperature + JSON mode: this is a structured-output task, not
            # a creative one -- 0.7 was carried over from the old project's
            # free-text chat settings and made malformed JSON (which we
            # deliberately don't fall back on, see routes_tripplanner.py) more
            # likely than it needed to be.
            #
            # Tried OpenAI's stricter response_format={"type": "json_schema", ...}
            # (schema-enforced structured output) on this gateway -- it doesn't
            # error, but silently ignores the schema and returns free-form prose
            # instead of JSON at all, which is worse than plain json_object mode.
            # The KKU gateway's gemini-2.5-flash proxy doesn't genuinely support
            # it; sticking with json_object + the retry loop below.
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        return json.loads(clean_json_string(content))

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
        issues_str = "\n".join(f"- {issue}" for issue in verdict.issues) or f"- {verdict.feedback}"
        return f"{issues_str}\n{verdict.feedback}".strip()

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
                      f"{MAX_RESTAURANTS_PER_DAY} \"ร้านอาหาร\" per day (see rule 6), so fewer picks are dropped like this.")
        return "\n".join(lines)

    def _enforce_restaurant_cap_and_roles(
        self, day_assignments: Dict[int, List[Place]], meal_roles: Dict[str, str],
        used_ids: Set[str], trip_start_date, trip_duration_days: int,
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

        Trims each day to MAX_RESTAURANTS_PER_DAY (relocating excess to
        another day with room that isn't closed that day, per
        check_is_open -- dropping only when nowhere fits), then re-derives
        lunch/dinner roles for every day left with exactly 2 restaurants and
        an incomplete {lunch, dinner} pairing, regardless of how that pair
        came to be. Returns the (day_num, place) pairs that had nowhere to
        go, for the caller to fold into the same drop-feedback loop as
        order_day_stops-level drops (see _build_drop_feedback)."""
        dropped: List[Tuple[int, Place]] = []

        for day_num in range(1, trip_duration_days + 1):
            places = day_assignments.get(day_num, [])
            restaurants = [p for p in places if p.category == "ร้านอาหาร"]
            if len(restaurants) <= MAX_RESTAURANTS_PER_DAY:
                continue
            for place in restaurants[MAX_RESTAURANTS_PER_DAY:]:
                day_assignments[day_num].remove(place)
                relocated = False
                for other_day in range(1, trip_duration_days + 1):
                    if other_day == day_num:
                        continue
                    other_places = day_assignments.setdefault(other_day, [])
                    if sum(1 for p in other_places if p.category == "ร้านอาหาร") >= MAX_RESTAURANTS_PER_DAY:
                        continue
                    other_date = trip_start_date + timedelta(days=other_day - 1)
                    noon = datetime(other_date.year, other_date.month, other_date.day, 12, 0)
                    if place.hours_periods and route_scheduler.check_is_open(place, noon)["status"] == "Closed Today":
                        continue
                    other_places.append(place)
                    relocated = True
                    logger.info(
                        "trip planner: relocated %s from day %d to day %d (restaurant cap)",
                        place.name, day_num, other_day,
                    )
                    break
                if not relocated:
                    used_ids.discard(place.id)
                    dropped.append((day_num, place))
                    logger.info(
                        "trip planner: dropping %s, every day already has %d restaurant(s) scheduled",
                        place.name, MAX_RESTAURANTS_PER_DAY,
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
            if {meal_roles.get(p.id) for p in restaurants} == {"lunch", "dinner"}:
                continue
            meal_roles[restaurants[0].id] = "lunch"
            meal_roles[restaurants[1].id] = "dinner"

        return dropped

    def solve_route_with_llm(self, user_input: TripInput, pace_instruction: str, budget_instruction: str) -> Tuple[List[DailyItinerary], str]:
        feedback_block = ""
        final_itinerary = None
        verdict = None
        drop_feedback = ""

        for judge_round in range(1, MAX_JUDGE_ATTEMPTS + 1):
            prompt = self.generate_prompt(user_input, pace_instruction, budget_instruction, feedback_block)
            data = self._generate_itinerary_data(prompt)
            final_itinerary, drop_feedback = self._build_itinerary_from_llm_days(data, user_input)

            verdict = self.judge.evaluate(user_input, final_itinerary)
            is_last_round = judge_round == MAX_JUDGE_ATTEMPTS

            # Passing isn't enough on its own anymore -- the judge never
            # evaluates geographic fit (by design), so a plan that dropped
            # picks due to distance could otherwise return immediately here
            # with the drop never having been given a chance to be fixed.
            if verdict.passed and not drop_feedback:
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
                return final_itinerary, verdict.rationale

            if is_last_round:
                break  # give up on quality/fit, return the last itinerary anyway (see warning below)

            logger.info(
                "trip planner: round %d/%d not accepted (judge passed=%s score=%.2f, dropped_places=%s) - regenerating",
                judge_round, MAX_JUDGE_ATTEMPTS, verdict.passed, verdict.score, bool(drop_feedback),
            )
            feedback_parts = []
            if not verdict.passed:
                feedback_parts.append(self._build_feedback_block(verdict))
            if drop_feedback:
                feedback_parts.append(drop_feedback)
            feedback_block = "\n".join(feedback_parts).strip()

        if not verdict.passed:
            logger.warning(
                "trip planner: judge did not pass within %d attempt(s), returning last itinerary anyway (final score=%.2f, issues=%s)",
                MAX_JUDGE_ATTEMPTS, verdict.score, verdict.issues,
            )
        if drop_feedback:
            logger.warning("trip planner: still dropping places after %d attempt(s), returning last itinerary anyway:\n%s", MAX_JUDGE_ATTEMPTS, drop_feedback)
        return final_itinerary, verdict.rationale

    def _build_itinerary_from_llm_days(self, data: dict, user_input: TripInput) -> Tuple[List[DailyItinerary], str]:
        """Turns the LLM's day-assignment output into a real itinerary:
        real ordering, real arrival/departure times, real opening-hours
        enforcement -- all owned by route_scheduler, none of it trusted
        from the LLM. See generate_prompt() for what the LLM is and isn't
        asked to decide.

        Also returns a drop-feedback string (empty if nothing was dropped)
        for solve_route_with_llm to feed into the next regenerate round --
        see _build_drop_feedback."""
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
                if role in ("lunch", "dinner"):
                    meal_roles[loc_id] = role
            day_assignments[day_num] = places_for_day

        day_assignments = route_scheduler.reassign_infeasible_days(
            day_assignments, trip_start_date, user_input.trip_duration_days,
        )

        restaurant_cap_drops = self._enforce_restaurant_cap_and_roles(
            day_assignments, meal_roles, used_ids, trip_start_date, user_input.trip_duration_days,
        )
        dropped_by_day: Dict[int, List[Tuple[Place, str]]] = {}
        for day_num, place in restaurant_cap_drops:
            dropped_by_day.setdefault(day_num, []).append(
                (place, f"day already had {MAX_RESTAURANTS_PER_DAY} \"ร้านอาหาร\" scheduled")
            )

        # A day with zero "ร้านอาหาร" picks is not a reasonable itinerary
        # regardless of stated interests -- top each such day up with one
        # unused restaurant candidate (see orchestrator.py's meal reserve,
        # which keeps a small supply of these available even when nothing
        # else surfaced any). Left role-less (single restaurant that day):
        # STRICT RULE #6 in the prompt above only assigns lunch/dinner when
        # a day has two, which still applies correctly since the LLM's own
        # picks are untouched here.
        for day_num in range(1, user_input.trip_duration_days + 1):
            day_places = day_assignments.setdefault(day_num, [])
            if any(p.category == "ร้านอาหาร" for p in day_places):
                continue
            restaurant = next(
                (loc for loc in self.candidates if loc.id not in used_ids and loc.category == "ร้านอาหาร"),
                None,
            )
            if restaurant:
                day_places.append(restaurant)
                used_ids.add(restaurant.id)

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
        ]

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
                start_time_of_day, end_time_of_day, user_input.trip_pace, meal_roles,
            )
            routes[day_num] = ordered
            ordered_ids = {p.id for p in ordered}
            missing = [p for p in day_places if p.id not in ordered_ids]
            for p in missing:
                dropped_by_day.setdefault(day_num, []).append(
                    (p, "too far from / opening-hours conflict with the rest of that day's picks")
                )

        routes = route_scheduler.backfill_underfilled_trip(
            routes, day_dates, meal_roles, self.start_point,
            start_time_of_day, end_time_of_day, user_input.trip_pace, backfill_pool,
        )
        drop_feedback = self._build_drop_feedback(dropped_by_day)

        final_itinerary = []
        for day_num in range(1, user_input.trip_duration_days + 1):
            route = routes[day_num]
            day_date = day_dates[day_num]
            anchor_ids = {p.id for p in route if route_scheduler.find_anchor_window(p, day_date)}
            schedule, day_cost, day_travel = route_scheduler.materialize_day_schedule(
                route, anchor_ids, meal_roles, self.start_point,
                day_date, start_time_of_day, end_time_of_day, user_input.trip_pace,
                gap_filler_pool=backfill_pool,
            )
            final_itinerary.append(DailyItinerary(
                day=day_num, date=day_date.strftime("%Y-%m-%d"), schedule=schedule,
                day_cost_estimate=day_cost, day_travel_time_total=day_travel,
            ))
        return final_itinerary, drop_feedback
