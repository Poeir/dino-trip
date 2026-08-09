import json
import logging
import time
from typing import List

from openai import OpenAI

from src.core.config import API_KEY, BASE_URL, TRIP_PLANNER_MODEL_NAME
from .json_utils import clean_json_string
from .models import DailyItinerary, JudgeVerdict, TripInput

logger = logging.getLogger(__name__)

# Soft gate; the two hard gates (pacing_ok/intent_match_ok) below can't be
# bought off by a high score alone. Originally 0.6, lowered after live testing
# showed gemini-2.5-flash (the judge model at the time) rarely scored above
# 0.5 in practice -- even itineraries with both hard gates passing topped out
# at 0.50 across every real (non-fail-open) evaluation observed, so 0.6 was
# burning the full MAX_JUDGE_ATTEMPTS budget on nearly every request
# regardless of quality.
# NOT re-calibrated for TRIP_PLANNER_MODEL_NAME's current value -- different
# models score with different generosity, so re-run the live test battery
# before trusting this number again after a model switch.
PASS_SCORE_THRESHOLD = 0.45


class TripItineraryJudge:
    def __init__(self):
        self.client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
        self.default_model = TRIP_PLANNER_MODEL_NAME

    def _format_itinerary_for_judge(self, itinerary: List[DailyItinerary]) -> str:
        # Dummy slots ("Free Time"/"End of Day (Return to Hotel)") are
        # included deliberately -- they let the judge correctly NOT flag two
        # restaurants as back-to-back when a free-time block already
        # separates them.
        lines = []
        for day in itinerary:
            lines.append(f"Day {day.day} ({day.date}):")
            for slot in day.schedule:
                lines.append(
                    f"  {slot.arrival_time}-{slot.departure_time} {slot.place.name} "
                    f"(category: {slot.place.category or slot.status}, status: {slot.status})"
                )
        return "\n".join(lines)

    def generate_judge_prompt(self, user_input: TripInput, itinerary: List[DailyItinerary]) -> str:
        itinerary_str = self._format_itinerary_for_judge(itinerary)

        return f"""
        You are a meticulous travel-plan quality reviewer. Evaluate the CANDIDATE
        ITINERARY below against the USER REQUEST. Do NOT try to fix it yourself --
        only evaluate it.

        [USER REQUEST]
        - Pace: {user_input.trip_pace}
        - Budget: {user_input.budget_level}
        - Interests: {', '.join(user_input.interests) or '(none specified)'}
        - Must Go: {', '.join(user_input.must_go) or '(none specified)'}

        [CANDIDATE ITINERARY]
        {itinerary_str}

        [WHAT TO EVALUATE]
        1. Pacing: no back-to-back heavy meals (e.g. two full restaurant meals in a
           row with nothing in between), a logical mix of attractions/cafes/
           restaurants, and a density appropriate to the stated pace.
        2. Intent match: does the plan actually reflect the user's stated
           interests, must-go places, and budget level.
        3. Overall quality score from 0.0 (bad) to 1.0 (excellent).

        [WHAT NOT TO EVALUATE]
        Do NOT flag opening-hours violations or arrivals at/after the trip's end
        time -- those are already guaranteed by a separate deterministic step
        after generation, so re-flagging them here wastes a regeneration attempt
        on something this plan's generator cannot even fix.

        [RATIONALE - IMPORTANT]
        Separately from your evaluation, write a short (1-2 sentence), Thai,
        USER-FACING "rationale" string explaining the itinerary's logic in plain,
        positive/neutral language -- e.g. "จัดร้านอาหารให้เว้นระยะเวลาเหมาะสมและเรียง
        สถานที่ใกล้กันไว้ด้วยกันเพื่อลดการเดินทาง". Never mention scores, pass/fail,
        "issues", or that this is an evaluation -- write it as if explaining the
        plan directly to the traveler. Always produce this field, whether or not
        the plan passes your evaluation.

        [OUTPUT FORMAT]
        Output STRICTLY a single JSON object, no other text:
        {{
            "score": 0.0,
            "pacing_ok": true,
            "intent_match_ok": true,
            "issues": ["short description of each problem found, empty if none"],
            "feedback": "concise instructions for how to fix the issues, for the plan generator to act on",
            "rationale": "short Thai user-facing explanation, see above"
        }}
        """

    def _call_llm_for_verdict(self, prompt: str) -> dict:
        response = self.client.chat.completions.create(
            model=self.default_model,
            messages=[
                {"role": "system", "content": "You are a meticulous travel-plan quality reviewer. Output JSON only."},
                {"role": "user", "content": prompt},
            ],
            stream=False,
            # temperature=0.0 (not 0.2 like generation): the judge should be
            # maximally consistent run-to-run -- there's no creative-writing
            # value in judge output, only evaluation consistency.
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        return json.loads(clean_json_string(content))

    def evaluate(self, user_input: TripInput, itinerary: List[DailyItinerary]) -> JudgeVerdict:
        t0 = time.time()
        prompt = self.generate_judge_prompt(user_input, itinerary)
        try:
            data = self._call_llm_for_verdict(prompt)
        except Exception as e:
            # Fail OPEN: a judge failure is cheap by design (one logged
            # warning, nothing else) -- unlike generation, it gets no
            # technical retry, and it must never itself block a request.
            logger.warning("trip planner judge call/parse failed, failing open: %s", e)
            return JudgeVerdict(
                passed=True, score=0.0, pacing_ok=True, intent_match_ok=True,
                issues=[], feedback="", rationale="",
            )

        score = float(data.get("score", 0.0))
        pacing_ok = bool(data.get("pacing_ok", True))
        intent_match_ok = bool(data.get("intent_match_ok", True))
        issues = data.get("issues") or []
        feedback = data.get("feedback") or ""
        rationale = data.get("rationale") or ""

        # `passed` is computed here in Python, NOT trusted from the LLM's own
        # JSON -- avoids the model contradicting itself (e.g. pacing_ok=False
        # but claiming passed=True).
        passed = pacing_ok and intent_match_ok and score >= PASS_SCORE_THRESHOLD

        logger.info(
            "trip planner judge: passed=%s score=%.2f pacing_ok=%s intent_match_ok=%s (%.2fs)",
            passed, score, pacing_ok, intent_match_ok, time.time() - t0,
        )
        return JudgeVerdict(
            passed=passed, score=score, pacing_ok=pacing_ok, intent_match_ok=intent_match_ok,
            issues=issues, feedback=feedback, rationale=rationale,
        )
