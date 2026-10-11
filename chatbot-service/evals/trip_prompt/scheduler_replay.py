"""Replay the deterministic scheduler on stored LLM outputs -- zero LLM cost.

Every record in runs/*/results.jsonl keeps the LLM's raw picks (`llm_output`).
Feeding those back through LLMTripPlanner._build_itinerary_from_llm_days
re-runs ONLY the deterministic side (caps, ordering, backfill, gap filler), so
a scheduler/pool change can be measured before/after on identical LLM input.

    venv/Scripts/python -m evals.trip_prompt.scheduler_replay --save before
    (edit the scheduler)
    venv/Scripts/python -m evals.trip_prompt.scheduler_replay --compare before

Caveat: this replays the FIRST generation only. Production may regenerate
(up to MAX_JUDGE_ATTEMPTS) using the scheduler's drop feedback, so absolute
rates here are an upper bound on what users see; the before/after DIFFERENCE
is what this tool measures.
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

from src.services.trip_planner import route_scheduler

from .cases import CASES
from .prompts import v0_baseline
from .run_eval import EvalPlanner, load_case_context

HERE = Path(__file__).parent
SNAP_DIR = HERE / "replays"


def load_records(runs):
    seen = {}
    for run in runs:
        path = HERE / "runs" / run / "results.jsonl"
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            if "llm_output" not in r or "error" in r or "error" in r.get("judge", {}):
                continue
            # same (variant, case, rep) may exist in several runs (exp2 seeds exp1's baseline) -- keep one
            seen[(r["variant"], r["case"], r["rep"])] = r
    return list(seen.values())


def _minutes(a, b):
    return (int(b[:2]) * 60 + int(b[3:])) - (int(a[:2]) * 60 + int(a[3:]))


def replay_one(rec, ctx):
    ui, hotel, cands, mg, _, _, _ = ctx
    planner = EvalPlanner(cands, start_point=hotel, must_go_ids=mg, prompt_fn=v0_baseline)
    itinerary, drop_feedback = planner._build_itinerary_from_llm_days(rec["llm_output"], ui)
    days, no_meal, stops, free = [], 0, 0, 0
    free_min = lunch_eligible = lunch_served = short_meals = 0
    # Same eligibility rule as route_scheduler.pace_stop_range's lunch break:
    # the window must start by 12:00 and end after 13:00.
    covers_lunch = ui.start_time <= "12:00" and ui.end_time >= "13:00"
    for d in itinerary:
        real = [s for s in d.schedule if s.place.category not in (None, "ที่พัก")]
        meals = [s for s in real if s.place.category == "ร้านอาหาร"]
        no_meal += not meals
        stops += len(real)
        free += sum(1 for s in d.schedule if s.place.category is None)
        free_min += sum(_minutes(s.arrival_time, s.departure_time) for s in d.schedule if s.place.category is None)
        if covers_lunch:
            lunch_eligible += 1
            lunch_served += any("11:00" <= m.arrival_time <= "14:00" for m in meals)
        short_meals += sum(
            1 for m in meals
            if _minutes(m.arrival_time, m.departure_time) - m.wait_time_min < route_scheduler.get_visit_duration(m.place, ui.trip_pace)
        )
        days.append([f"{s.arrival_time} {s.place.name} [{s.place.category}]" for s in d.schedule])
    return {
        "variant": rec["variant"], "case": rec["case"], "rep": rec["rep"],
        "days": len(itinerary), "no_meal_days": no_meal, "stops": stops, "free_slots": free,
        "free_minutes": free_min, "lunch_eligible_days": lunch_eligible, "lunch_served_days": lunch_served,
        "short_meals": short_meals,
        "must_go_missing": sorted(p.name for p in planner.last_dropped_must_go),
        "had_drop_feedback": bool(drop_feedback), "itinerary": days,
    }


def run_all(runs, pool_tag=""):
    ctxs, out = {}, []
    for rec in sorted(load_records(runs), key=lambda r: (r["case"], r["variant"], r["rep"])):
        if rec["case"] not in ctxs:
            case = next(c for c in CASES if c["id"] == rec["case"])
            ctxs[rec["case"]] = load_case_context(case, cache_tag=pool_tag)
        out.append(replay_one(rec, ctxs[rec["case"]]))
    return out


def summarise(results):
    keys = ("runs", "days", "no_meal_days", "stops", "free_slots", "must_go_missing",
            "free_minutes", "lunch_eligible_days", "lunch_served_days", "short_meals")
    by_case = defaultdict(lambda: {k: 0 for k in keys})
    for r in results:
        a = by_case[r["case"]]
        a["runs"] += 1
        a["days"] += r["days"]
        a["no_meal_days"] += r["no_meal_days"]
        a["stops"] += r["stops"]
        a["free_slots"] += r["free_slots"]
        a["must_go_missing"] += len(r["must_go_missing"])
        for k in ("free_minutes", "lunch_eligible_days", "lunch_served_days", "short_meals"):
            a[k] += r.get(k, 0)  # old snapshots predate these fields
    return dict(by_case)


def print_summary(title, s):
    print(f"\n{title}")
    print(f"{'case':26} {'runs':>4} {'days':>4} {'no-meal':>8} {'lunch served':>13} {'free min/day':>12} {'short meals':>11} {'stops/day':>9} {'must-go miss':>12}")
    tot = defaultdict(int)
    for case, a in sorted(s.items()):
        lunch = f"{a['lunch_served_days']}/{a['lunch_eligible_days']}" if a["lunch_eligible_days"] else "n/a"
        print(f"{case:26} {a['runs']:>4} {a['days']:>4} {a['no_meal_days']:>8} {lunch:>13} {a['free_minutes']/a['days']:>12.0f} "
              f"{a['short_meals']:>11} {a['stops']/a['days']:>9.1f} {a['must_go_missing']:>12}")
        for k, v in a.items():
            tot[k] += v
    lunch = f"{tot['lunch_served_days']}/{tot['lunch_eligible_days']}" if tot["lunch_eligible_days"] else "n/a"
    print(f"{'TOTAL':26} {tot['runs']:>4} {tot['days']:>4} {tot['no_meal_days']:>8} {lunch:>13} {tot['free_minutes']/tot['days']:>12.0f} "
          f"{tot['short_meals']:>11} {tot['stops']/tot['days']:>9.1f} {tot['must_go_missing']:>12}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="*", default=["exp1", "exp2"])
    ap.add_argument("--pool-tag", default="", help="use candidate pools cached with this tag (e.g. _a = pools built by the new orchestrator)")
    ap.add_argument("--save", help="snapshot name to write")
    ap.add_argument("--compare", help="snapshot name to diff the current scheduler against")
    args = ap.parse_args()

    results = run_all(args.runs, args.pool_tag)
    SNAP_DIR.mkdir(exist_ok=True)
    if args.save:
        (SNAP_DIR / f"{args.save}.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"saved {len(results)} replays -> replays/{args.save}.json")
    print_summary("CURRENT scheduler", summarise(results))

    if args.compare:
        before = json.loads((SNAP_DIR / f"{args.compare}.json").read_text(encoding="utf-8"))
        print_summary(f"SNAPSHOT '{args.compare}'", summarise(before))
        key = lambda r: (r["variant"], r["case"], r["rep"])
        bmap = {key(r): r for r in before}
        worse, better = [], []
        for r in results:
            b = bmap.get(key(r))
            if not b:
                continue
            # a run is "worse" if it loses a must-go, gains a meal-less day, or loses stops
            d_meal = r["no_meal_days"] - b["no_meal_days"]
            d_mg = len(r["must_go_missing"]) - len(b["must_go_missing"])
            d_stops = r["stops"] - b["stops"]
            if d_mg > 0 or d_meal > 0:
                worse.append((key(r), d_meal, d_mg, d_stops))
            elif d_mg < 0 or d_meal < 0:
                better.append((key(r), d_meal, d_mg, d_stops))
        print(f"\nruns improved (fewer no-meal days / must-go missing): {len(better)}")
        print(f"runs REGRESSED (more no-meal days or must-go missing): {len(worse)}")
        for k, dm, dg, ds in worse:
            print(f"   REGRESSION {k}: no_meal {dm:+d}, must_go {dg:+d}, stops {ds:+d}")


if __name__ == "__main__":
    main()
