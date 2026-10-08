"""Offline evaluation judge -- deliberately NOT the in-loop TripItineraryJudge.

Why a separate judge:
- The in-loop judge's verdict feeds back into generation, so scoring prompts
  with it would grade the system with its own feedback signal.
- It runs on the same model as the generator (self-preference bias). This
  one defaults to a different model family (EVAL_JUDGE_MODEL).
- It sees the candidate pool, so it can tell "picked weak places when
  strong matching ones were available" apart from "the pool was thin".

It is blind to which prompt variant produced the itinerary. Scores are 1-5
per criterion with anchors; reasoning is requested BEFORE scores so the
score is conditioned on the critique rather than rationalised after it.
"""
import json
import os
import re

from openai import OpenAI

from src.core.config import API_KEY, BASE_URL

DEFAULT_JUDGE_MODEL = os.environ.get("EVAL_JUDGE_MODEL", "claude-sonnet-5.5")

CRITERIA = ["interest_fit", "constraint_fit", "variety_flow", "day_coherence", "selection_quality"]

RUBRIC = """
Score each criterion 1-5 (integers). Anchors:

interest_fit -- do the non-restaurant stops reflect the stated interests?
  5 = nearly every stop clearly matches an interest, every interest is represented
  3 = about half match, or one interest is ignored
  1 = stops are mostly unrelated to the interests
  (no interests stated: judge whether these are representative, worthwhile Khon Kaen places)

constraint_fit -- must-go places present, budget level respected, area scope respected
  5 = all must-go present, budget clearly honoured (cheap/free for ประหยัด, premium for หรูหรา)
  3 = one must-go missing OR budget only loosely honoured
  1 = must-go missing and budget ignored

variety_flow -- within each day, a sensible mix of categories; meals present and spaced;
  no repetitive stacking (e.g. 3 temples or 2 cafes in a row); free-time placeholders are fine
  5 = every day feels like a well-rounded day out
  3 = one day is repetitive or a meal is missing/odd
  1 = days are monotonous or meal structure is broken

day_coherence -- does each day hang together (a theme, places in the same/nearby District)?
  Far-out districts (ภูเวียง, อุบลรัตน์, ชุมแพ, ...) mixed with city stops on the same day is a defect.
  5 = each day has a clear theme and geographic cluster
  3 = one day is scattered
  1 = days look random

selection_quality -- compared to the CANDIDATE POOL, were the strongest relevant options chosen?
  5 = picks are among the best-rated/most iconic relevant candidates
  3 = several clearly better relevant candidates were left unused
  1 = picks are mostly weak while strong relevant options were available

Do NOT judge clock times, travel minutes, or visit order within a day -- a deterministic scheduler
owns those. Judge place selection and day assignment only.
"""


def _fmt_request(user_input):
    return (
        f"- Days: {user_input.trip_duration_days} starting {user_input.start_date}, window {user_input.start_time}-{user_input.end_time}\n"
        f"- Pace: {user_input.trip_pace}\n"
        f"- Budget: {user_input.budget_level}\n"
        f"- Area scope: {user_input.area_scope}\n"
        f"- Interests: {', '.join(user_input.interests) or '(none)'}\n"
        f"- Must go: {', '.join(user_input.must_go) or '(none)'}"
    )


def _fmt_pool(candidates):
    lines = []
    for p in candidates:
        tags = "/".join(p.tags[:4]) if p.tags else ""
        price = p.price_level if p.price_level is not None else "?"
        lines.append(f"- {p.name} | {p.category} | rating {p.rating} | {p.district or '?'} | price {price} | {tags}")
    return "\n".join(lines)


def _fmt_itinerary(itinerary):
    lines = []
    for day in itinerary:
        lines.append(f"Day {day.day} ({day.date}):")
        for s in day.schedule:
            p = s.place
            if p.category is None:
                lines.append(f"  {s.arrival_time}-{s.departure_time} [free time]")
            elif p.category == "ที่พัก":
                lines.append(f"  {s.arrival_time} [return to hotel]")
            else:
                role = f", {s.meal_role}" if s.meal_role else ""
                lines.append(
                    f"  {s.arrival_time}-{s.departure_time} {p.name} ({p.category}{role}, {p.district or '?'}, rating {p.rating})"
                )
    return "\n".join(lines)


def build_prompt(user_input, candidates, itinerary):
    return f"""You are an expert, strict evaluator of travel itineraries for Khon Kaen, Thailand.

[USER REQUEST]
{_fmt_request(user_input)}

[CANDIDATE POOL the planner could choose from]
{_fmt_pool(candidates)}

[ITINERARY TO EVALUATE]
{_fmt_itinerary(itinerary)}

[RUBRIC]
{RUBRIC}

Output ONLY a JSON object, with the critique first:
{{
  "critique": "3-6 sentences: concrete strengths and defects, naming places",
  "interest_fit": 1,
  "constraint_fit": 1,
  "variety_flow": 1,
  "day_coherence": 1,
  "selection_quality": 1
}}"""


def _parse(content):
    if content is None:
        raise ValueError("empty judge response")
    m = re.search(r"\{.*\}", content, re.S)
    if not m:
        raise ValueError(f"no JSON in judge response: {content[:200]}")
    data = json.loads(m.group(0))
    scores = {}
    for c in CRITERIA:
        v = int(round(float(data[c])))
        if not 1 <= v <= 5:
            raise ValueError(f"{c} out of range: {v}")
        scores[c] = v
    return data.get("critique", ""), scores


class EvalJudge:
    def __init__(self, model=None):
        self.model = model or DEFAULT_JUDGE_MODEL
        self.client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

    def score(self, user_input, candidates, itinerary):
        prompt = build_prompt(user_input, candidates, itinerary)
        last_err = None
        spent = 0
        for _ in range(2):
            try:
                resp = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": "You are a strict travel-itinerary evaluator. Output JSON only."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.0,
                )
                usage = getattr(resp, "usage", None)
                tokens = (usage.prompt_tokens + usage.completion_tokens) if usage else 0
                spent += tokens
                critique, scores = _parse(resp.choices[0].message.content)
                return {
                    "critique": critique,
                    "scores": scores,
                    "mean": sum(scores.values()) / len(scores),
                    "judge_model": self.model,
                    "tokens": spent,
                }
            except Exception as e:  # retry once, then record the failure (never fail open here)
                last_err = e
        return {"error": str(last_err), "judge_model": self.model, "tokens": spent}
