"""LLM review of a finished itinerary, after route_scheduler has placed it.

Reworked 2026-10-21 after reviewing 10 live trips on Claude. The old judge
found real problems in 9 of them but passed all but one: its gate was a score
threshold (0.45, set for Gemini, while Claude scores 0.5-0.85), it couldn't
see the day's window, the meals, which places match which interest or what
else was available, so it also flagged things nobody could fix (a 10:00-17:00
day "has no dinner", "add more craft shops" when only two exist), and it was
told to ignore idle time and early ends -- the most visible problems, and ones
the generator CAN fix by picking more or different places.

Now the judge gets those facts (trip settings, per-day idle time and end,
interest matches, prices, the unused candidates), rates each issue "major"
(a traveller would mind, and different picks from what's available could fix
it) or "minor", and a plan passes when it has no major issue. The score is
kept for logs and for choosing between two rounds.
"""
import logging
import time
from datetime import datetime
from typing import Iterable, List, Optional, Tuple

from src.core.llm_client import complete_json
from src.core.config import MODEL_NAME
from src.core.usage import UsageTracker
from . import route_scheduler, trip_ends
from .models import DailyItinerary, JudgeVerdict, Place, TripInput

logger = logging.getLogger(__name__)

# The judge fails open (see evaluate), so a slow judge should give up early
# rather than hold the finished itinerary back: without a limit the SDK
# default applied (600s per attempt, 2 silent retries).
JUDGE_TIMEOUT_S = 60
JUDGE_MAX_RETRIES = 0

# How many unused candidates the prompt lists -- enough to suggest real swaps
# without the prompt growing with the candidate pool.
MAX_UNUSED_LISTED = 40

VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["major", "minor"]},
                    "day": {"type": "integer"},
                    "problem": {"type": "string"},
                    "fix": {"type": "string"},
                },
                "required": ["severity", "day", "problem", "fix"],
                "additionalProperties": False,
            },
        },
        "score": {"type": "number"},
        "rationale": {"type": "string"},
    },
    "required": ["issues", "score", "rationale"],
    "additionalProperties": False,
}

_PRICE_SIGNS = {0: "free", 1: "฿", 2: "฿฿", 3: "฿฿฿", 4: "฿฿฿฿"}


def _minutes(hhmm: str) -> int:
    h, m = map(int, hhmm.split(":"))
    return h * 60 + m


def _interest_matches(place: Place, interests: Iterable[str]) -> List[str]:
    return [i for i in interests if i in (place.tags or [])]


def _describe_place(place: Place, interests: List[str]) -> str:
    parts = [f"{place.name} [{place.category}{' / ' + place.subcategory if place.subcategory else ''}]"]
    matches = _interest_matches(place, interests)
    if interests:
        parts.append(f"interests: {', '.join(matches) or 'none'}")
    if place.price:
        parts.append(f"price: {place.price}")
    elif place.price_level is not None:
        parts.append(f"price: {_PRICE_SIGNS.get(place.price_level, place.price_level)}")
    if place.district:
        parts.append(place.district)
    return " | ".join(parts)


class TripItineraryJudge:
    def __init__(self):
        self.default_model = MODEL_NAME
        # Shared with LLMTripPlanner, which assigns its own tracker here so
        # generate + judge calls land in one per-trip total.
        self.usage: Optional[UsageTracker] = None

    def _format_settings(self, user_input: TripInput) -> str:
        start = datetime.strptime(user_input.start_time, "%H:%M").time()
        end = datetime.strptime(user_input.end_time, "%H:%M").time()
        breakfast = "อาหารเช้า" in user_input.food_preferences
        lo, hi = route_scheduler.pace_stop_range(user_input.trip_pace, start, end, breakfast=breakfast)
        meals = route_scheduler.day_meals(start, end, breakfast=breakfast)
        cafe_cap = route_scheduler.CATEGORY_DAILY_CAP.get("คาเฟ่")
        last_day = []
        if user_input.trip_end is not None:
            last = user_input.trip_duration_days
            last_start, last_end = trip_ends.day_window(user_input, last)
            if trip_ends.is_travel_only_day(last_start, last_end):
                last_day = [f"- Day {last} is the departure day: nothing is planned on it (expected, not an issue)"]
            else:
                last_day = [
                    f"- Day {last} ends at the trip's end point, not the accommodation, by {last_end.strftime('%H:%M')} "
                    "-- a shorter day with fewer attractions/meals is expected, not an issue"
                ]
        return "\n".join([
            f"- Days: {user_input.trip_duration_days}, daily window {user_input.start_time}-{user_input.end_time}",
            *last_day,
            f"- Pace: {user_input.trip_pace} (target {lo}-{hi} attractions a day; restaurants don't count)",
            f"- Hard limits per day the planner cannot exceed: {hi} attractions, {cafe_cap} \"คาเฟ่\", "
            f"{route_scheduler.DEFAULT_CATEGORY_DAILY_CAP} of any other category",
            f"- Meals each day: {' and '.join(meals) if meals else 'none (window holds no full meal)'}",
            f"- Budget: {user_input.budget_level}"
            + (
                " (premium restaurants/cafes and a shopping mall each day are wanted on this budget, "
                "even outside the interests -- not an issue)"
                if user_input.budget_level == "หรูหรา" else ""
            ),
            f"- Interests: {', '.join(user_input.interests) or '(none specified)'}",
            f"- Food preferences (the restaurants' / cafes' Type): {', '.join(user_input.food_preferences) or '(none specified)'}",
            f"- Must go: {', '.join(user_input.must_go) or '(none specified)'}",
            f"- Area: {user_input.area_scope}",
        ])

    def _format_itinerary(self, user_input: TripInput, itinerary: List[DailyItinerary]) -> str:
        """Each day with its facts already worked out (idle minutes, how early
        it ends), so the judge doesn't have to infer them from times. The
        accommodation's name and "no hours data" statuses are left out: the
        first is the user's, the second is noise nobody can act on."""
        lines = []
        for day in itinerary:
            # The last day may end earlier, at the trip's end point (trip_ends.py).
            _, day_end = trip_ends.day_window(user_input, day.day) if user_input.trip_end else (None, None)
            window_end = _minutes(day_end.strftime("%H:%M")) if day_end else _minutes(user_input.end_time)
            real = [s for s in day.schedule if s.place.category not in trip_ends.NON_VISIT_CATEGORIES]
            idle = sum(
                _minutes(s.departure_time) - _minutes(s.arrival_time)
                for s in day.schedule if s.status == "Free Time"
            ) + sum(s.wait_time_min for s in real)
            end_slot = next((s for s in day.schedule if s.place.category in ("ที่พัก", trip_ends.TRIP_END_CATEGORY)), None)
            back = end_slot.arrival_time if end_slot else None
            where = (
                f"arrives at the trip's end point ({end_slot.place.name})"
                if end_slot and end_slot.place.category == trip_ends.TRIP_END_CATEGORY
                else "back at the accommodation"
            )
            early = window_end - _minutes(back) if back else 0
            attractions = sum(1 for s in real if s.place.category != "ร้านอาหาร")
            weekday = datetime.strptime(day.date, "%Y-%m-%d").strftime("%A")
            km = round(sum(s.distance_km for s in day.schedule))
            lines.append(
                f"Day {day.day} ({day.date}, {weekday}): {attractions} attractions, {km} km driven, "
                f"idle {idle} min, {where} {back or '?'}"
                + (f" ({early} min before the window ends)" if early > 0 else "")
            )
            for s in day.schedule:
                if s.status == "Free Time":
                    lines.append(f"  {s.arrival_time}-{s.departure_time} (free time, nothing planned)")
                elif s.place.category in ("ที่พัก", trip_ends.TRIP_END_CATEGORY):
                    continue
                else:
                    wait = f" (waits {s.wait_time_min} min to open)" if s.wait_time_min else ""
                    meal = f" ({s.meal_role})" if s.meal_role else ""
                    lines.append(
                        f"  {s.arrival_time}-{s.departure_time} {_describe_place(s.place, user_input.interests)}{meal}{wait}"
                        f" (+{s.distance_km:g} km)"
                    )
        return "\n".join(lines)

    def _format_unused(self, user_input: TripInput, unused: List[Place]) -> str:
        if not unused:
            return "(none -- every candidate is already used)"
        # Interest matches first: those are the swaps worth suggesting.
        ranked = sorted(unused, key=lambda p: (not _interest_matches(p, user_input.interests), -(p.rating or 0)))
        lines = [f"- {_describe_place(p, user_input.interests)}" for p in ranked[:MAX_UNUSED_LISTED]]
        if len(unused) > MAX_UNUSED_LISTED:
            lines.append(f"- ... and {len(unused) - MAX_UNUSED_LISTED} more")
        return "\n".join(lines)

    def _format_dropped(self, dropped: List[Tuple[int, Place]]) -> str:
        if not dropped:
            return "(none)"
        return "\n".join(f"- Day {day}: {p.name} [{p.category}]" for day, p in dropped)

    def generate_judge_prompt(
        self, user_input: TripInput, itinerary: List[DailyItinerary], unused: Optional[List[Place]] = None,
        dropped: Optional[List[Tuple[int, Place]]] = None,
    ) -> str:
        return f"""
        You review a travel itinerary for a traveller in Khon Kaen. A planner
        chose WHICH places go on WHICH day (and which restaurant is lunch or
        dinner); a separate scheduler then set the order, the times and the
        drive between places. Find what the traveller would mind that the
        planner could fix by choosing differently.

        [TRIP SETTINGS]
        {self._format_settings(user_input)}

        [ITINERARY AS SCHEDULED]
        {self._format_itinerary(user_input, itinerary)}

        [UNUSED CANDIDATES -- what else the planner could have picked]
        {self._format_unused(user_input, unused or [])}

        [PICKED BUT DIDN'T FIT -- the scheduler had to leave these out of that day]
        {self._format_dropped(dropped or [])}

        [HOW TO REVIEW]
        Rate each issue:
        - "major": a traveller would clearly be unhappy, AND picking differently
          (an unused candidate above, or moving a place to another day) would fix it.
          Typical majors:
          * a stated interest or must-go place missing or barely present, while
            unused candidates match it;
          * a day with 90+ idle minutes, or back 2+ hours before the window ends
            (3+ hours on a relaxed pace), while suitable unused candidates exist;
          * 4 or more places of one category on a day while alternatives exist;
          * a day that mixes far-apart areas (e.g. city sights and Phu Wiang,
            ~50+ km apart, driving out and back within the day) when the
            places could be grouped by area across days instead;
          * places clearly wrong for the budget, judged by their price;
          * meals whose restaurant isn't of a stated food preference while an
            unused restaurant of that Type exists (only one per meal -- don't
            ask for extra restaurants). By design each Type is eaten at most
            once a day: with fewer preferences than a day's meals, the other
            meal is a different Type on purpose -- not an issue.
        - "minor": worth improving, but not a reason to redo the plan.
        A day built around one theme (e.g. all the dinosaur sites on the Phu
        Wiang day) is good, not repetitive, when the other interests get their
        own days -- judge interests over the whole trip, and don't raise issues
        that contradict each other.

        Do NOT raise: exact times, the visiting order within a day, or short
        in-town drives (the scheduler's job); a long drive that a single
        out-of-town day needs anyway; missing or unknown data; anything about the
        accommodation; meals that the trip settings don't include; anything no
        unused candidate could fix. A fix must stay within the hard limits per
        day, and must not add back a place from PICKED BUT DIDN'T FIT to the day
        it didn't fit. A day already at its attraction target that still ends
        early is the scheduler's to fill: at most "minor".

        "day": the day number, or 0 for the whole trip. "fix": one concrete
        instruction for the planner, in English, naming the unused candidates to
        add or swap in, or the place to move and to which day.
        "score": overall quality from 0.0 to 1.0.

        [RATIONALE]
        Also write "rationale": 1-2 short Thai sentences for the traveller
        explaining the plan's logic in positive/neutral language -- e.g.
        "จัดสถานที่ใกล้กันไว้วันเดียวกันเพื่อลดการเดินทาง และมีร้านอาหารท้องถิ่นทุกมื้อ".
        Never mention scores, issues, that this is a review, any list of
        candidates, or places that are missing or couldn't be included.

        Output STRICTLY one JSON object:
        {{"issues": [{{"severity": "major", "day": 1, "problem": "...", "fix": "..."}}], "score": 0.0, "rationale": "..."}}
        """

    def _call_llm_for_verdict(self, prompt: str) -> dict:
        # temperature=0.0 on Gemini (Claude takes none): the judge should be
        # maximally consistent run-to-run.
        return complete_json(
            system="You are a meticulous travel-plan quality reviewer. Output JSON only.",
            user=prompt,
            schema=VERDICT_SCHEMA,
            timeout=JUDGE_TIMEOUT_S,
            max_retries=JUDGE_MAX_RETRIES,
            temperature=0.0,
            usage=self.usage,
            label="judge",
            model=self.default_model,
        )

    def evaluate(
        self, user_input: TripInput, itinerary: List[DailyItinerary], unused: Optional[List[Place]] = None,
        dropped: Optional[List[Tuple[int, Place]]] = None,
    ) -> JudgeVerdict:
        t0 = time.time()
        prompt = self.generate_judge_prompt(user_input, itinerary, unused, dropped)
        try:
            data = self._call_llm_for_verdict(prompt)
        except Exception as e:
            # Fail OPEN: a judge failure must never itself block a request.
            # judge_call_failed=True marks this as an unconditional pass, not
            # a real evaluation -- see the field's docstring in models.py.
            logger.warning("trip planner judge call/parse failed, failing open: %s", e)
            return JudgeVerdict(passed=True, score=0.0, rationale="", judge_call_failed=True)

        issues = [i for i in (data.get("issues") or []) if isinstance(i, dict)]
        majors = [i for i in issues if i.get("severity") == "major"]
        # Majors first: they're what the next round has to act on.
        ordered = majors + [i for i in issues if i.get("severity") != "major"]

        def label(i):
            day = i.get("day") or 0
            return f"[{i.get('severity', 'minor')}] {'Day ' + str(day) if day else 'Trip'}: {i.get('problem', '')}".strip()

        verdict = JudgeVerdict(
            passed=not majors,
            score=float(data.get("score") or 0.0),
            major_issues=len(majors),
            issues=[label(i) for i in ordered],
            feedback="\n".join(f"- {label(i)} -> {i.get('fix', '')}" for i in ordered if i.get("fix")),
            rationale=str(data.get("rationale") or ""),
        )
        logger.info(
            "trip planner judge: passed=%s majors=%d minors=%d score=%.2f (%.2fs)%s",
            verdict.passed, len(majors), len(issues) - len(majors), verdict.score, time.time() - t0,
            "".join(f"\n  {line}" for line in verdict.feedback.splitlines()),
        )
        return verdict
