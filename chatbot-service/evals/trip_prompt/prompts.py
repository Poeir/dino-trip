"""Prompt variants under test.

Every challenger is the PRODUCTION prompt (LLMTripPlanner.generate_prompt,
called as-is) with exactly ONE kind of change patched into its text, so a
difference in results can be attributed to that change:

  v0_baseline     production prompt, untouched
  v1_rules        + 3 extra rules production doesn't state (rules only)
  v2_context      + richer per-place data: review count, tags, short
                    description, [MUST-GO] marker (data only, no new rules)
  v3_plan_first   + a short "plan before you pick" step written into an
                    `analysis` key of the JSON (structure only)

Patches are exact-substring replacements guarded by asserts: if someone edits
the production prompt so an anchor no longer matches, the experiment fails
loudly instead of silently testing something else.

Output contract is unchanged ({"itinerary": [{"day", "places": [...]}]}):
_build_itinerary_from_llm_days ignores extra keys, which is what lets v3 add
`analysis`.
"""
import re

from src.services.trip_planner.llm_extractor import LLMTripPlanner

DESC_CHARS = 90  # per-place description budget for v2 (~25-30 tokens)


def _replace_once(text, old, new, what):
    assert text.count(old) == 1, f"patch anchor for {what!r} matched {text.count(old)} times; production prompt changed?"
    return text.replace(old, new)


def v0_baseline(planner, user_input, pace_instruction, budget_instruction, feedback_block=""):
    return LLMTripPlanner.generate_prompt(planner, user_input, pace_instruction, budget_instruction, feedback_block)


# ---------- v1: rules only ----------

EXTRA_RULES = """\
        9. Every place named under "Must Go" in the USER QUERY must appear in the plan exactly once.
        10. Each day must include at least 1 and at most 2 "ร้านอาหาร" (restaurant) places.
        11. Check each place's Hours against the weekday of the day you assign it to (see "Calendar dates per day"); do not assign a place to a day it is closed.

"""


def v1_rules(planner, user_input, pace_instruction, budget_instruction, feedback_block=""):
    p = v0_baseline(planner, user_input, pace_instruction, budget_instruction, feedback_block)
    return _replace_once(p, "        [EXAMPLE JSON OUTPUT FORMAT]", EXTRA_RULES + "        [EXAMPLE JSON OUTPUT FORMAT]", "extra rules")


# ---------- v2: richer place data only ----------

_LOCATION_LEAD = re.compile(r"^\s*(?:ตั้งอยู่(?:ใน|ที่)\S*(?:\s\S+){0,2}?\s*จังหวัดขอนแก่น)\s*")


def _short(text, n, name=""):
    """Descriptions open with '<name> ตั้งอยู่ในอำเภอX จังหวัดขอนแก่น ...', which
    just repeats the Name/District fields -- strip that lead so the budget
    goes to what the place actually is."""
    text = " ".join((text or "").split())
    if name and text.startswith(name):
        text = text[len(name):]
    if "จากผู้ใช้ Google Maps" in text:
        return ""  # templated fallback ("<type> คะแนนรีวิว X ดาว จากผู้ใช้ Google Maps N คน"): no info beyond rating/review count
    text = _LOCATION_LEAD.sub("", text).strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def v2_context(planner, user_input, pace_instruction, budget_instruction, feedback_block=""):
    p = v0_baseline(planner, user_input, pace_instruction, budget_instruction, feedback_block)
    for loc in planner.candidates:
        old = (
            f"- ID: {loc.id}, Name: {loc.name}, Category: {loc.category}, Rating: {loc.rating}, "
            f"District: {loc.district or 'unknown'}, Hours: {loc.hours or 'unknown'}\n"
        )
        marker = " [MUST-GO]" if loc.id in planner.must_go_ids else ""
        tags = "/".join(loc.tags[:5])
        desc = _short(loc.description, DESC_CHARS, loc.name)
        new = (
            f"- ID: {loc.id}{marker}, Name: {loc.name}, Category: {loc.category}, "
            f"Rating: {loc.rating} ({loc.review_count or 0} reviews), "
            f"District: {loc.district or 'unknown'}"
            f"{', Tags: ' + tags if tags else ''}"
            f"{', About: ' + desc if desc else ''}, "
            f"Hours: {loc.hours or 'unknown'}\n"
        )
        p = _replace_once(p, old, new, f"place line {loc.id}")
    return p


# ---------- v3: plan first ----------

PLAN_STEP = """\
        [PLANNING STEP - DO THIS FIRST]
        Before the itinerary, fill the "analysis" object (keep it short, IDs not descriptions):
        - "districts": group the places you intend to use by District, so each day can stay within one District or neighbouring ones.
        - "interest_picks": for each stated interest, the 2-4 best-matching place IDs.
        - "day_themes": one short line per day naming that day's main District and focus.
        Then write "itinerary" so it follows those themes.

"""


def v3_plan_first(planner, user_input, pace_instruction, budget_instruction, feedback_block=""):
    p = v0_baseline(planner, user_input, pace_instruction, budget_instruction, feedback_block)
    p = _replace_once(p, "        [EXAMPLE JSON OUTPUT FORMAT]", PLAN_STEP + "        [EXAMPLE JSON OUTPUT FORMAT]", "plan step")
    p = _replace_once(
        p, '"itinerary": [',
        '"analysis": {\n'
        '                "districts": {"DISTRICT": ["ID_FROM_LIST"]},\n'
        '                "interest_picks": {"INTEREST": ["ID_FROM_LIST"]},\n'
        '                "day_themes": ["Day 1: ..."]\n'
        '            },\n'
        '            "itinerary": [',
        "analysis in example",
    )
    return p


VARIANTS = {
    "v0_baseline": v0_baseline,
    "v1_rules": v1_rules,
    "v2_context": v2_context,
    "v3_plan_first": v3_plan_first,
    # Same prompt as v0_baseline, run AFTER the scheduler/pool changes (B, C, A).
    # A separate name so one report can show before (v0_baseline, old runs) vs
    # after (v0_after) side by side.
    "v0_after": v0_baseline,
}
