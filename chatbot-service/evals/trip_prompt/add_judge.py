"""Score the stored generations of a run with an ADDITIONAL judge model.

The run's own judge (results.jsonl) stays untouched. Each extra judge appends to
runs/<run>/judgements.jsonl, one line per (judge, variant, case, rep), and
`report` adds a judge-panel section from it. No generator call is made: the
judged itinerary is rebuilt from the stored `llm_output` exactly as `rejudge`
does, and a run whose rebuilt plan differs from the stored one is skipped.

    venv/Scripts/python -m evals.trip_prompt.add_judge --run final --pool-tag _final \
        --judge-model kku:gpt-5.6-terra --limit 1                       # smoke test, ~1 judge call
    venv/Scripts/python -m evals.trip_prompt.add_judge --run final --pool-tag _final \
        --judge-model kku:gpt-5.6-terra --max-judge-tokens 180000       # resumes where it stopped

Runs are taken replicate-first (rep 1 of every variant/case, then rep 2, ...),
so a quota stop leaves a balanced partial panel rather than a few complete cases.
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
from .rejudge import _stops
from .report import ALIASES
from .run_eval import RUNS_DIR, EvalPlanner, load_case_context

logger = logging.getLogger("trip_prompt_add_judge")

QUOTA_MARKERS = ("daily limit", "429", "rate limit")


def latest_runs(run_dir):
    """Latest good generation per (variant, case, rep), alias rows excluded."""
    latest = {}
    for line in (run_dir / "results.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            latest[(r["variant"], r["case"], r["rep"])] = r
    return [r for k, r in sorted(latest.items(), key=lambda kv: (kv[0][2], kv[0][1], kv[0][0]))
            if "llm_output" in r and "error" not in r and r["variant"] not in ALIASES]


def judged_keys(path, judge_key):
    """Keys already scored (without error) by this judge."""
    done = set()
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            j = json.loads(line)
            if j.get("judge_key") == judge_key and "error" not in j["judge"]:
                done.add((j["variant"], j["case"], j["rep"]))
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--pool-tag", default="_final")
    ap.add_argument("--judge-model", required=True, help="'kku:<model>' or 'vertex:<model>'")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--max-judge-tokens", type=int, default=0)
    ap.add_argument("--limit", type=int, default=0, help="stop after this many judge calls (smoke test)")
    ap.add_argument("--dry-run", action="store_true", help="verify the replay only; no LLM call")
    args = ap.parse_args()
    logging.basicConfig(level=logging.WARNING)
    logger.setLevel(logging.INFO)

    problems = verify(args.pool_tag)
    if problems:
        raise SystemExit("frozen pools do not match their manifest:\n  " + "\n  ".join(problems))
    run_dir = RUNS_DIR / args.run
    out_path = run_dir / "judgements.jsonl"

    judge = EvalJudge(args.judge_model)
    judge_key = f"{judge.provider}:{judge.model}"
    done = judged_keys(out_path, judge_key)
    todo = [r for r in latest_runs(run_dir) if (r["variant"], r["case"], r["rep"]) not in done]
    logger.info("judge %s: %d already scored, %d to do", judge_key, len(done), len(todo))
    if args.limit:
        todo = todo[:args.limit]

    cases = {c["id"]: c for c in CASES}
    ctxs, prepared, mismatched = {}, [], []
    for rec in todo:
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

    spent, lock, stop = [0], threading.Lock(), threading.Event()

    def work(item):
        rec, ui, cands, itinerary = item
        with lock:
            if stop.is_set() or (args.max_judge_tokens and spent[0] >= args.max_judge_tokens):
                return rec, None
        verdict = judge.score(ui, cands, itinerary)
        with lock:
            spent[0] += verdict.get("tokens", 0)
            if verdict.get("error") and any(m in verdict["error"].lower() for m in QUOTA_MARKERS):
                stop.set()  # the quota is gone; do not keep sending requests that will fail
        return rec, verdict

    n_ok = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool, open(out_path, "a", encoding="utf-8") as f:
        for fut in as_completed([pool.submit(work, it) for it in prepared]):
            rec, verdict = fut.result()
            key = f"{rec['variant']} {rec['case']} rep{rec['rep']}"
            if verdict is None:
                logger.info("%s -> skipped (budget or quota reached)", key)
                continue
            if verdict.get("error"):
                logger.info("%s -> ERROR %s", key, verdict["error"][:160])
                continue  # not written: a later invocation retries it
            f.write(json.dumps({"judge_key": judge_key, "variant": rec["variant"], "case": rec["case"],
                                "rep": rec["rep"], "judge": verdict}, ensure_ascii=False) + "\n")
            f.flush()
            n_ok += 1
            logger.info("%s -> %.2f  (tokens this call %d, total %d)", key, verdict["mean"], verdict["tokens"], spent[0])
    logger.info("scored %d of %d with %s; judge tokens spent: %d", n_ok, len(prepared), judge_key, spent[0])


if __name__ == "__main__":
    main()
