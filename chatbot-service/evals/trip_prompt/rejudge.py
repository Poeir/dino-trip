"""Re-judge runs whose generation succeeded but whose judge call failed (quota).

run_eval's resume skips only fully successful runs, so after a judge outage it
would REGENERATE those plans (costing generator tokens again). In single mode
the judged itinerary is a deterministic function of the stored first generation
(`llm_output`), the frozen pool and the scheduler code, so it can be rebuilt
exactly and sent to the judge alone -- no generator call.

    venv/Scripts/python -m evals.trip_prompt.rejudge --run final --dry-run   # verify replay only, no LLM
    venv/Scripts/python -m evals.trip_prompt.rejudge --run final --pool-tag _final --max-judge-tokens 150000

Safety: the rebuilt itinerary must equal the stored one stop-for-stop, otherwise
that run is skipped (never judged on a plan the generator did not produce).
Updated records are appended to results.jsonl; report.py keeps the latest per
(variant, case, rep).
"""
import argparse
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from .cases import CASES
from .eval_judge import EvalJudge
from .freeze import verify
from .prompts import v0_baseline
from .run_eval import RUNS_DIR, EvalPlanner, load_case_context

logger = logging.getLogger("trip_prompt_rejudge")


def _stops(itinerary):
    return [{"day": d.day, "stops": [f"{s.arrival_time} {s.place.name} [{s.place.category}]" for s in d.schedule]}
            for d in itinerary]


def pending(run_dir):
    latest = {}
    for line in (run_dir / "results.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            latest[(r["variant"], r["case"], r["rep"])] = r
    return [r for r in latest.values()
            if "llm_output" in r and "error" not in r and r.get("judge", {}).get("error")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--pool-tag", default="_final")
    ap.add_argument("--judge-model", default=None)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--max-judge-tokens", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true", help="only verify that the itineraries can be rebuilt; no LLM call")
    args = ap.parse_args()
    logging.basicConfig(level=logging.WARNING)
    logger.setLevel(logging.INFO)

    problems = verify(args.pool_tag)
    if problems:
        raise SystemExit("frozen pools do not match their manifest:\n  " + "\n  ".join(problems))
    run_dir = RUNS_DIR / args.run
    todo = pending(run_dir)
    logger.info("%d run(s) have a saved generation but no judge score", len(todo))

    ctxs = {}
    cases = {c["id"]: c for c in CASES}
    prepared, mismatched = [], []
    for rec in sorted(todo, key=lambda r: (r["case"], r["variant"], r["rep"])):
        if rec["case"] not in ctxs:
            ctxs[rec["case"]] = load_case_context(cases[rec["case"]], cache_tag=args.pool_tag)
        ui, hotel, cands, mg, _, _, _ = ctxs[rec["case"]]
        planner = EvalPlanner(cands, start_point=hotel, must_go_ids=mg, prompt_fn=v0_baseline)
        itinerary, _ = planner._build_itinerary_from_llm_days(rec["llm_output"], ui)
        if _stops(itinerary) != rec["itinerary"]:
            mismatched.append((rec["variant"], rec["case"], rec["rep"]))
            continue
        prepared.append((rec, ui, cands, itinerary))
    logger.info("replay check: %d identical, %d mismatched %s", len(prepared), len(mismatched), mismatched[:5])
    if args.dry_run:
        return

    judge = EvalJudge(args.judge_model)
    spent, lock = [0], threading.Lock()

    def work(item):
        rec, ui, cands, itinerary = item
        with lock:
            if args.max_judge_tokens and spent[0] >= args.max_judge_tokens:
                return rec, None
        verdict = judge.score(ui, cands, itinerary)
        with lock:
            spent[0] += verdict.get("tokens", 0)
        return rec, verdict

    out_path = run_dir / "results.jsonl"
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool, open(out_path, "a", encoding="utf-8") as f:
        for fut in as_completed([pool.submit(work, it) for it in prepared]):
            rec, verdict = fut.result()
            key = f"{rec['variant']} {rec['case']} rep{rec['rep']}"
            if verdict is None:
                logger.info("%s -> skipped (judge token budget reached)", key)
                continue
            if verdict.get("error"):
                logger.info("%s -> %s", key, verdict["error"][:120])
                continue  # leave the old record as the latest; a later rejudge can retry
            f.write(json.dumps({**rec, "judge": verdict, "rejudged": True}, ensure_ascii=False) + "\n")
            f.flush()
            done += 1
            logger.info("%s -> judge=%.2f (judge tokens so far %d)", key, verdict["mean"], spent[0])
    logger.info("re-judged %d of %d", done, len(prepared))


if __name__ == "__main__":
    main()
