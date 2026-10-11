"""Run the trip-planner prompt experiment.

    cd chatbot-service
    venv/Scripts/python -m evals.trip_prompt.run_eval --run exp1 --reps 3
    venv/Scripts/python -m evals.trip_prompt.report --run exp1

Costs real LLM calls: (#variants x #cases x reps) generations + the same
number of judge calls. Start with --cases c01_city_culture_relaxed --reps 1
as a smoke test.

Design notes:
- Candidate lists are retrieved ONCE per case and cached to cache/, so every
  variant and every rep sees the identical pool (and the DB/embedding model
  isn't on the hot path).
- Default mode "single": one generation, no in-loop judge/regenerate. The
  regenerate loop and the deterministic post-processing (caps, backfill,
  gap-filler) both repair weak LLM output, which would hide the difference
  between prompts. --mode loop runs the full production solve_route_with_llm
  instead, to confirm a winner still wins end-to-end.
- Results are appended to runs/<run>/results.jsonl one line per
  (variant, case, rep); re-running the same command resumes and skips what
  is already there.
"""
import argparse
import json
import logging
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

from src.services.trip_planner import llm_extractor, route_scheduler
from src.services.trip_planner.json_utils import clean_json_string
from src.services.trip_planner.llm_extractor import LLMTripPlanner, MAX_CAFES_PER_DAY, MAX_RESTAURANTS_PER_DAY
from src.services.trip_planner.models import Place, TripInput

from .cases import CASES
from .eval_judge import EvalJudge
from .prompts import VARIANTS

HERE = Path(__file__).parent
CACHE_DIR = HERE / "cache"
RUNS_DIR = HERE / "runs"

logger = logging.getLogger("trip_prompt_eval")


class Budget:
    """Token caps for the two providers (gemini generator, claude judge).
    Checked before each job starts, so with N workers the overshoot is at
    most N in-flight jobs -- set the caps with that margin."""

    def __init__(self, max_gen, max_judge):
        self.max_gen, self.max_judge = max_gen, max_judge
        self.gen = self.judge = 0
        self.lock = threading.Lock()

    def exhausted(self):
        with self.lock:
            return (self.max_gen and self.gen >= self.max_gen) or (self.max_judge and self.judge >= self.max_judge)

    def add(self, rec):
        with self.lock:
            self.gen += sum((c.get("prompt_tokens") or 0) + (c.get("completion_tokens") or 0) for c in rec.get("gen_calls", []))
            self.judge += rec.get("judge", {}).get("tokens", 0)


# ---------- candidate cache ----------

def _dump(p: Place) -> dict:
    return p.model_dump()


def load_case_context(case, refresh=False, cache_tag=""):
    """(user_input, hotel, candidates, must_go_ids, missing_must_go, pace_inst, budget_inst)."""
    from src.services.trip_planner.orchestrator import TripBuilderService

    CACHE_DIR.mkdir(exist_ok=True)
    path = CACHE_DIR / f"{case['id']}{cache_tag}.json"
    user_input = TripInput(**case["input"])
    if path.exists() and not refresh:
        raw = json.loads(path.read_text(encoding="utf-8"))
    else:
        svc = load_case_context.svc = getattr(load_case_context, "svc", None) or TripBuilderService()
        hotel, candidates, missing, must_go_ids = svc.build_candidate_list(user_input)
        pace_inst, budget_inst = svc.get_dynamic_instructions(user_input)
        raw = {
            "hotel": _dump(hotel), "candidates": [_dump(c) for c in candidates],
            "must_go_ids": sorted(must_go_ids), "missing_must_go": missing,
            "pace_instruction": pace_inst, "budget_instruction": budget_inst,
            "retrieved_at": datetime.now().isoformat(timespec="seconds"),
        }
        path.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")
    return (
        user_input, Place(**raw["hotel"]), [Place(**c) for c in raw["candidates"]],
        set(raw["must_go_ids"]), raw["missing_must_go"], raw["pace_instruction"], raw["budget_instruction"],
    )


# ---------- instrumented planner ----------

class EvalPlanner(LLMTripPlanner):
    """Production planner with the prompt swapped and LLM I/O recorded."""

    def __init__(self, *args, prompt_fn, gen_model=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.prompt_fn = prompt_fn
        if gen_model:
            self.default_model = gen_model
            self.judge.default_model = gen_model
        self.calls = []  # one dict per generation call: prompt_chars, usage, raw content, latency

    def generate_prompt(self, user_input, pace_instruction, budget_instruction, feedback_block=""):
        return self.prompt_fn(self, user_input, pace_instruction, budget_instruction, feedback_block)

    def _call_llm_for_itinerary(self, prompt):
        # Same parameters as LLMTripPlanner._call_llm_for_itinerary -- keep in sync.
        t0 = time.time()
        rec = {"prompt_chars": len(prompt)}
        self.calls.append(rec)
        response = self.client.chat.completions.create(
            model=self.default_model,
            messages=[
                {"role": "system", "content": "You are a helpful travel assistant. Output JSON only."},
                {"role": "user", "content": prompt},
            ],
            stream=False,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        rec["latency_s"] = round(time.time() - t0, 2)
        usage = getattr(response, "usage", None)
        if usage is not None:
            rec["prompt_tokens"] = usage.prompt_tokens
            rec["completion_tokens"] = usage.completion_tokens
        content = response.choices[0].message.content
        rec["content"] = content
        data = json.loads(clean_json_string(content))
        rec["parsed"] = True
        return data


# ---------- deterministic metrics ----------

def raw_metrics(data, planner, user_input):
    """Compliance of the LLM's own picks, before any deterministic repair."""
    start = datetime.strptime(user_input.start_date, "%Y-%m-%d").date()
    t0 = datetime.strptime(user_input.start_time, "%H:%M").time()
    t1 = datetime.strptime(user_input.end_time, "%H:%M").time()
    lo, hi = route_scheduler.pace_stop_range(user_input.trip_pace, t0, t1)

    m = dict(invalid_ids=0, duplicate_ids=0, days_over_pace=0, days_under_pace=0,
             days_over_cafe_cap=0, days_over_restaurant_cap=0, days_no_restaurant=0,
             meal_role_errors=0, closed_picks=0, missing_days=0)
    seen, districts_per_day = set(), []
    days = {d.get("day"): d for d in data.get("itinerary", []) if isinstance(d, dict)}
    for day_num in range(1, user_input.trip_duration_days + 1):
        day = days.get(day_num)
        if day is None:
            m["missing_days"] += 1
            continue
        picks, roles = [], {}
        for e in day.get("places", []):
            pid = e.get("place_id")
            if pid not in planner.location_map:
                m["invalid_ids"] += 1
                continue
            if pid in seen:
                m["duplicate_ids"] += 1
                continue
            seen.add(pid)
            picks.append(planner.location_map[pid])
            roles[pid] = e.get("meal_role")
        n_attr = route_scheduler.attraction_count(picks)
        rest = [p for p in picks if p.category == "ร้านอาหาร"]
        cafes = [p for p in picks if p.category == "คาเฟ่"]
        m["days_over_pace"] += n_attr > hi
        m["days_under_pace"] += n_attr < lo
        m["days_over_cafe_cap"] += len(cafes) > MAX_CAFES_PER_DAY
        m["days_over_restaurant_cap"] += len(rest) > MAX_RESTAURANTS_PER_DAY
        m["days_no_restaurant"] += len(rest) == 0
        if len(rest) == 2 and {roles.get(p.id) for p in rest} != {"lunch", "dinner"}:
            m["meal_role_errors"] += 1
        d = start + timedelta(days=day_num - 1)
        noon = datetime(d.year, d.month, d.day, 12, 0)
        m["closed_picks"] += sum(route_scheduler.check_is_open(p, noon)["status"] == "Closed Today" for p in picks)
        if picks:
            districts_per_day.append(len({p.district for p in picks if p.district}))
    m["must_go_missed"] = len(planner.must_go_ids - seen)
    m["n_picks"] = len(seen)
    m["avg_districts_per_day"] = round(sum(districts_per_day) / len(districts_per_day), 2) if districts_per_day else None
    m["hard_violations"] = sum(m[k] for k in (
        "invalid_ids", "duplicate_ids", "days_over_pace", "days_over_cafe_cap", "days_over_restaurant_cap",
        "meal_role_errors", "must_go_missed", "missing_days",
    ))
    m["_picked_ids"] = sorted(seen)
    return m


def final_metrics(itinerary, picked_ids, planner):
    real = [s for d in itinerary for s in d.schedule if s.place.category not in (None, "ที่พัก")]
    real_ids = {s.place.id for s in real}
    free = sum(1 for d in itinerary for s in d.schedule if s.place.category is None)
    picked = set(picked_ids)
    return {
        "final_real_stops": len(real),
        "free_time_slots": free,
        "llm_pick_retention": round(len(picked & real_ids) / len(picked), 3) if picked else 0.0,
        "llm_share_of_final": round(len(picked & real_ids) / len(real_ids), 3) if real_ids else 0.0,
        "must_go_missing_final": len(planner.last_dropped_must_go),
    }


# ---------- one job ----------

def run_one(variant, case, rep, ctx, mode, gen_model, judge, budget):
    if budget.exhausted():
        return {"variant": variant, "case": case["id"], "rep": rep, "skipped": "token budget reached"}
    user_input, hotel, candidates, must_go_ids, _, pace_inst, budget_inst = ctx
    planner = EvalPlanner(candidates, start_point=hotel, must_go_ids=must_go_ids,
                          prompt_fn=VARIANTS[variant], gen_model=gen_model)
    rec = {"variant": variant, "case": case["id"], "rep": rep, "mode": mode,
           "gen_model": planner.default_model, "n_candidates": len(candidates)}
    t0 = time.time()
    try:
        if mode == "single":
            prompt = planner.generate_prompt(user_input, pace_inst, budget_inst)
            data = planner._generate_itinerary_data(prompt)  # includes the production 1x technical retry
            itinerary, drop_feedback = planner._build_itinerary_from_llm_days(data, user_input)
            first_data = data
        else:
            verdicts = []
            orig_eval = planner.judge.evaluate
            planner.judge.evaluate = lambda ui, it: verdicts.append(orig_eval(ui, it)) or verdicts[-1]
            itinerary, _ = planner.solve_route_with_llm(user_input, pace_inst, budget_inst)
            drop_feedback = ""
            first_data = json.loads(clean_json_string(next(c["content"] for c in planner.calls if c.get("parsed"))))
            rec["loop_rounds"] = len(verdicts)
            rec["loop_judge_scores"] = [v.score for v in verdicts]
    except Exception as e:
        rec.update(error=f"{type(e).__name__}: {e}", traceback=traceback.format_exc(limit=3),
                   gen_calls=planner.calls, elapsed_s=round(time.time() - t0, 2))
        budget.add(rec)
        return rec

    rm = raw_metrics(first_data, planner, user_input)
    picked = rm.pop("_picked_ids")
    rec["raw"] = rm
    rec["final"] = final_metrics(itinerary, picked, planner)
    rec["had_drop_feedback"] = bool(drop_feedback)
    rec["json_retries"] = sum(1 for c in planner.calls if not c.get("parsed"))
    rec["gen_calls"] = [{k: v for k, v in c.items() if k != "content"} for c in planner.calls]
    rec["llm_output"] = first_data
    rec["itinerary"] = [
        {"day": d.day, "stops": [f"{s.arrival_time} {s.place.name} [{s.place.category}]" for s in d.schedule]}
        for d in itinerary
    ]
    rec["judge"] = judge.score(user_input, candidates, itinerary)
    rec["elapsed_s"] = round(time.time() - t0, 2)
    budget.add(rec)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True, help="run name -> runs/<run>/")
    # v0_after is an alias of v0_baseline (same prompt); running both only duplicates the baseline
    ap.add_argument("--variants", nargs="*", default=[v for v in VARIANTS if v != "v0_after"])
    ap.add_argument("--cases", nargs="*", default=[c["id"] for c in CASES])
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--mode", choices=["single", "loop"], default="single")
    ap.add_argument("--gen-model", default=None, help="override TRIP_PLANNER_MODEL_NAME for generation")
    ap.add_argument("--judge-model", default=None, help="override EVAL_JUDGE_MODEL")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--max-gen-tokens", type=int, default=0, help="stop starting new jobs after this many generator tokens (0 = no cap)")
    ap.add_argument("--max-judge-tokens", type=int, default=0, help="same, for the evaluation judge")
    ap.add_argument("--refresh-cache", action="store_true", help="re-retrieve candidate pools from the DB")
    ap.add_argument("--pool-tag", default="", help="use candidate pools cached under this tag (e.g. _a = built by the current orchestrator)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    logger.setLevel(logging.INFO)

    unknown = set(args.variants) - set(VARIANTS)
    if unknown:
        raise SystemExit(f"unknown variants: {unknown}")
    cases = [c for c in CASES if c["id"] in args.cases]

    from .freeze import provenance, verify
    problems = verify(args.pool_tag, [c["id"] for c in cases]) if args.pool_tag else None
    pool_frozen = problems is not None
    if pool_frozen:
        if args.refresh_cache:
            raise SystemExit(f"pool tag {args.pool_tag!r} is frozen: --refresh-cache is not allowed")
        if problems:
            raise SystemExit("frozen pools no longer match their manifest:\n  " + "\n  ".join(problems))

    out_dir = RUNS_DIR / args.run
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "results.jsonl"
    done = set()
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            if "error" not in r and "error" not in r.get("judge", {}):
                done.add((r["variant"], r["case"], r["rep"]))

    # A saved generation whose judge call failed must be re-judged (rejudge.py), not regenerated.
    needs_rejudge = set()
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            k = (r["variant"], r["case"], r["rep"])
            if "llm_output" in r and "error" not in r and r.get("judge", {}).get("error"):
                needs_rejudge.add(k)
            else:
                needs_rejudge.discard(k)
        needs_rejudge -= done
        if needs_rejudge:
            logger.warning("%d run(s) have a saved generation but no judge score -- skipped here; "
                           "run `python -m evals.trip_prompt.rejudge --run %s` (judge tokens only)", len(needs_rejudge), args.run)

    contexts = {}
    for c in cases:
        contexts[c["id"]] = load_case_context(c, refresh=args.refresh_cache, cache_tag=args.pool_tag)
        logger.info("case %s: %d candidates", c["id"], len(contexts[c["id"]][2]))

    judge = EvalJudge(args.judge_model)
    jobs = [(v, c, r) for c in cases for v in args.variants for r in range(1, args.reps + 1)
            if (v, c["id"], r) not in done and (v, c["id"], r) not in needs_rejudge]
    (out_dir / "config.json").write_text(json.dumps({
        "variants": args.variants, "cases": args.cases, "reps": args.reps, "mode": args.mode,
        "gen_model": args.gen_model or llm_extractor.TRIP_PLANNER_MODEL_NAME, "judge_model": judge.model,
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "pool_tag": args.pool_tag, "pool_frozen": pool_frozen, "provenance": provenance(),
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    logger.info("%d jobs to run (%d already done)", len(jobs), len(done))

    lock = threading.Lock()
    budget = Budget(args.max_gen_tokens, args.max_judge_tokens)
    with ThreadPoolExecutor(max_workers=args.workers) as pool, open(out_path, "a", encoding="utf-8") as f:
        futs = {pool.submit(run_one, v, c, r, contexts[c["id"]], args.mode, args.gen_model, judge, budget): (v, c["id"], r)
                for v, c, r in jobs}
        for i, fut in enumerate(as_completed(futs), 1):
            rec = fut.result()
            if "skipped" in rec:
                logger.info("[%d/%d] %s %s rep%d -> skipped (%s)", i, len(jobs), *futs[fut], rec["skipped"])
                continue
            with lock:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                f.flush()
            status = rec.get("error") or rec["judge"].get("error") or f"judge={rec['judge']['mean']:.2f} viol={rec['raw']['hard_violations']}"
            logger.info("[%d/%d] %s %s rep%d -> %s  (tokens so far: gen %d, judge %d)", i, len(jobs), *futs[fut], status, budget.gen, budget.judge)


if __name__ == "__main__":
    main()
