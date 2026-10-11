"""Summarise runs/<run>/results.jsonl into runs/<run>/report.md.

    venv/Scripts/python -m evals.trip_prompt.report --run exp2

Built for SMALL experiments (8 cases, 3 reps), so the primary comparison is
case-level win/tie/loss. A paired bootstrap interval and a minimum detectable
effect are reported next to it so the reader can see how wide the uncertainty
really is; the interval only labels an adoption "confirmed" or "tentative",
it is not an extra gate (the rule is locked in PROTOCOL.md).

Rules that keep the comparison honest:
- Only cases where EVERY variant has at least one good run are compared.
- Reps of one (variant, case) are averaged first; the case is the unit.
- Infrastructure failures (quota/401/network) are listed but never count
  against a variant. A variant's own failures (bad JSON after retry) do.
- A difference smaller than the noise floor (baseline's own rep-to-rep spread,
  at least 0.15 judge points) counts as a tie.
"""
import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path

from .eval_judge import CRITERIA
from .metrics import final_compliance, pick_quality
from .stats import BOOT_N, BOOT_SEED, min_detectable_effect, paired_bootstrap, spearman

HERE = Path(__file__).parent
RUNS_DIR = HERE / "runs"
CACHE_DIR = HERE / "cache"
BASELINE = "v0_baseline"
ALIASES = ("v0_after",)    # same prompt as the baseline; in a frozen-pool run its rows are an A/A check, not a candidate
MIN_NOISE_FLOOR = 0.15
MAX_CASE_LOSS = 0.4        # a variant that loses any case by more than this is not adopted
HARD_VIOLATION_SLACK = 0.25

INFRA_MARKERS = ("401", "daily limit", "429", "rate limit", "timeout", "timed out", "connection", "503", "502")


def is_infra_error(msg):
    return bool(msg) and any(m in msg.lower() for m in INFRA_MARKERS)


def fmt(x, nd=2):
    return "-" if x is None or x != x else f"{x:.{nd}f}"


def mean(xs):
    xs = [x for x in xs if x is not None]
    return statistics.fmean(xs) if xs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--pool-tag", default=None, help="candidate-pool cache tag for pick-quality metrics (default: the run's config, else untagged)")
    args = ap.parse_args()
    run_dir = RUNS_DIR / args.run
    raw = [json.loads(l) for l in (run_dir / "results.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    latest = {}
    for r in raw:  # a resumed run may append a retry for the same key
        latest[(r["variant"], r["case"], r["rep"])] = r
    recs = list(latest.values())
    cfg_path = run_dir / "config.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
    # In a frozen-pool (final) run, alias rows repeat the baseline prompt: keep them out of the comparison.
    aa_recs = [r for r in recs if r["variant"] in ALIASES] if cfg.get("pool_frozen") else []
    recs = [r for r in recs if r not in aa_recs]

    def rec_error(r):
        return r.get("error") or r.get("judge", {}).get("error")

    ok = [r for r in recs if not rec_error(r)]
    infra = [r for r in recs if rec_error(r) and is_infra_error(rec_error(r))]
    own_fail = [r for r in recs if rec_error(r) and not is_infra_error(rec_error(r))]

    variants = [BASELINE] + sorted({r["variant"] for r in recs} - {BASELINE})
    variants = [v for v in variants if any(r["variant"] == v for r in recs)]
    by_vc = defaultdict(list)
    for r in ok:
        by_vc[(r["variant"], r["case"])].append(r)
    all_cases = sorted({r["case"] for r in recs})
    pool_tag = args.pool_tag if args.pool_tag is not None else cfg.get("pool_tag", "")
    cases = [c for c in all_cases if all(by_vc.get((v, c)) for v in variants)]
    dropped_cases = [c for c in all_cases if c not in cases]

    # offline pick-quality metrics for every record, from stored output + cached pool
    pools, interests = {}, {}
    for c in cases:
        cache = json.loads((CACHE_DIR / f"{c}{pool_tag}.json").read_text(encoding="utf-8"))
        pools[c] = cache["candidates"]
    from .cases import CASES
    case_inputs = {}
    for case in CASES:
        interests[case["id"]] = case["input"].get("interests", [])
        case_inputs[case["id"]] = case["input"]
    for r in ok:
        if r["case"] in pools:
            r["pq"] = pick_quality(r.get("llm_output"), pools[r["case"]], interests[r["case"]])
            inp = case_inputs[r["case"]]
            r["fc"] = final_compliance(r.get("itinerary"), inp.get("start_time", "09:00"), inp.get("end_time", "18:00"))

    def case_vals(v, getter):
        out = {}
        for c in cases:
            m = mean([getter(r) for r in by_vc[(v, c)]])
            if m is not None:
                out[c] = m
        return out

    judge_mean = lambda r: r["judge"]["mean"]
    lines = [f"# Trip prompt experiment: `{args.run}`", "",
             f"- generator `{cfg.get('gen_model')}` · judge `{cfg.get('judge_model')}` · mode `{cfg.get('mode')}`",
             f"- compared on {len(cases)} case(s) with complete data: {', '.join(cases) or '(none)'}"]
    if dropped_cases:
        lines.append(f"- excluded (some variant has no good run): {', '.join(dropped_cases)}")
    reps = {v: sum(len(by_vc[(v, c)]) for c in cases) for v in variants}
    lines += ["- runs used: " + ", ".join(f"`{v}` {reps[v]}" for v in variants), ""]

    if not cases:
        lines.append("**No case has data for every variant yet.**")
        (run_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")
        print("\n".join(lines))
        return

    # noise floor from the baseline's own repeat spread
    stds = [statistics.pstdev([judge_mean(r) for r in by_vc[(BASELINE, c)]]) for c in cases if len(by_vc[(BASELINE, c)]) > 1]
    noise = max(MIN_NOISE_FLOOR, statistics.fmean(stds) if stds else 0.0)
    lines += [f"Noise floor (ties are differences below this): **{noise:.2f}** judge points "
              f"(baseline rep spread {fmt(statistics.fmean(stds) if stds else None)}, minimum {MIN_NOISE_FLOOR}).", ""]

    base = case_vals(BASELINE, judge_mean)
    rep_scores = lambda v: {c: [judge_mean(r) for r in by_vc[(v, c)]] for c in cases}
    lines += ["## Headline: judge mean (1-5)", "",
              "| variant | mean | Δ vs baseline | 95% CI of Δ | W/T/L | worst case Δ | hard viol./run | own failures |", "|---|---|---|---|---|---|---|---|"]
    stats = {}
    for v in variants:
        cv = case_vals(v, judge_mean)
        viol = mean(case_vals(v, lambda r: r["raw"]["hard_violations"]).values())
        fails = sum(1 for r in own_fail if r["variant"] == v)
        if v == BASELINE:
            stats[v] = dict(mean=mean(cv.values()), viol=viol, fails=fails)
            lines.append(f"| `{v}` | {fmt(stats[v]['mean'])} | — | — | — | — | {fmt(viol)} | {fails} |")
            continue
        diffs = {c: cv[c] - base[c] for c in cases}
        w = sum(d > noise for d in diffs.values()); l = sum(d < -noise for d in diffs.values()); t = len(diffs) - w - l
        ci = paired_bootstrap(rep_scores(v), rep_scores(BASELINE))
        stats[v] = dict(mean=mean(cv.values()), delta=mean(diffs.values()), w=w, t=t, l=l,
                        worst=min(diffs.values()), viol=viol, fails=fails, ci=ci, diffs=list(diffs.values()),
                        mg=mean(case_vals(v, lambda r: r["final"]["must_go_missing_final"]).values()))
        lines.append(f"| `{v}` | {fmt(stats[v]['mean'])} | {stats[v]['delta']:+.2f} | [{ci[1]:+.2f}, {ci[2]:+.2f}] | {w}/{t}/{l} | {stats[v]['worst']:+.2f} | {fmt(viol)} | {fails} |")
    stats[BASELINE]["mg"] = mean(case_vals(BASELINE, lambda r: r["final"]["must_go_missing_final"]).values())
    lines += ["", "W/T/L = cases won / tied / lost vs baseline (beyond the noise floor).",
              f"95% CI = two-level paired bootstrap (resample cases, then reps inside each case), {BOOT_N:,} draws, seed {BOOT_SEED}. "
              f"With {len(cases)} cases the interval is wide by construction; an interval that contains 0 means 'not shown to differ', not 'no difference'.", ""]
    mdes = {v: min_detectable_effect(stats[v]["diffs"]) for v in variants if v != BASELINE}
    if any(m is not None for m in mdes.values()):
        lines += ["Minimum detectable effect (80% power, alpha=0.05, from the observed spread of case differences): "
                  + ", ".join(f"`{v}` {fmt(m)}" for v, m in mdes.items()) + " judge points. Real differences smaller than this would usually go unnoticed.", ""]

    lines += ["## Judge criteria (mean, 1-5)", "", "| variant | " + " | ".join(CRITERIA) + " |", "|---|" + "---|" * len(CRITERIA)]
    for v in variants:
        lines.append(f"| `{v}` | " + " | ".join(fmt(mean(case_vals(v, lambda r, k=k: r["judge"]["scores"][k]).values())) for k in CRITERIA) + " |")
    lines.append("")

    pq_keys = [("interest_match", "interest match (share of non-restaurant picks whose tags hit a stated interest)", 2),
               ("avg_rating_picked", "avg rating of picks", 2), ("thin_review_picks", f"picks with <20 reviews", 2)]
    lines += ["## Pick quality (computed from the LLM's own picks)", "", "| variant | " + " | ".join(k for k, _, _ in pq_keys) + " |", "|---|" + "---|" * len(pq_keys)]
    for v in variants:
        lines.append(f"| `{v}` | " + " | ".join(fmt(mean(case_vals(v, lambda r, k=k: r["pq"][k]).values())) for k, _, _ in pq_keys) + " |")
    lines += ["", "interest match is undefined for cases with no stated interests (they are skipped in that average).", ""]

    raw_keys = ["hard_violations", "must_go_missed", "days_over_pace", "days_under_pace", "days_no_restaurant", "closed_picks", "avg_districts_per_day"]
    lines += ["## Raw output compliance (before the scheduler repairs it)", "", "| variant | " + " | ".join(raw_keys) + " |", "|---|" + "---|" * len(raw_keys)]
    for v in variants:
        lines.append(f"| `{v}` | " + " | ".join(fmt(mean(case_vals(v, lambda r, k=k: r["raw"].get(k)).values())) for k in raw_keys) + " |")
    lines.append("")

    lines += ["## Final itinerary and cost", "", "| variant | must-go missing (final) | free-time slots | prompt tok | completion tok | latency s |", "|---|---|---|---|---|---|"]
    for v in variants:
        rs = [r for c in cases for r in by_vc[(v, c)]]
        pt = mean([g.get("prompt_tokens") for r in rs for g in r["gen_calls"]])
        ct = mean([g.get("completion_tokens") for r in rs for g in r["gen_calls"]])
        lat = mean([g.get("latency_s") for r in rs for g in r["gen_calls"]])
        lines.append(f"| `{v}` | {fmt(mean(case_vals(v, lambda r: r['final']['must_go_missing_final']).values()))} | "
                     f"{fmt(mean(case_vals(v, lambda r: r['final']['free_time_slots']).values()))} | {fmt(pt, 0)} | {fmt(ct, 0)} | {fmt(lat, 1)} |")
    lines.append("")

    lines += ["## Judge mean per case", "", "| case | " + " | ".join(f"`{v}`" for v in variants) + " |", "|---|" + "---|" * len(variants)]
    cv_all = {v: case_vals(v, judge_mean) for v in variants}
    for c in cases:
        lines.append(f"| {c} | " + " | ".join(fmt(cv_all[v].get(c)) for v in variants) + " |")
    lines.append("")

    # ---- A/A check: the same prompt run twice ----
    aa_ok = [r for r in aa_recs if not rec_error(r)]
    if aa_ok:
        aa_by_case = defaultdict(list)
        for r in aa_ok:
            aa_by_case[r["case"]].append(judge_mean(r))
        diffs = {c: statistics.fmean(v) - base[c] for c, v in sorted(aa_by_case.items()) if c in base}
        if diffs:
            lines += ["## A/A check (same prompt, run twice)", "",
                      "`v0_after` is the baseline prompt again. Its difference from `v0_baseline` shows how large a difference appears by chance alone "
                      "(rep noise + judge noise), without any prompt change.", "",
                      "| case | v0_after − v0_baseline |", "|---|---|"]
            lines += [f"| {c} | {d:+.2f} |" for c, d in diffs.items()]
            lines += ["", f"Mean |Δ| = **{statistics.fmean(abs(d) for d in diffs.values()):.2f}**, mean Δ = {statistics.fmean(diffs.values()):+.2f} "
                      f"over {len(diffs)} case(s); compare with the noise floor above ({noise:.2f}).", ""]

    # ---- constraint levels (Xie et al. 2024 style pass rates) ----
    def level_flags(r):
        return {
            "environment": r["raw"]["invalid_ids"] == 0 and r["raw"]["duplicate_ids"] == 0,
            "hard": r["final"]["must_go_missing_final"] == 0,
            "commonsense": r["fc"]["no_meal_days"] == 0 and r["raw"]["closed_picks"] == 0,
        }
    level_names = [("environment", "Environment"), ("hard", "Hard"), ("commonsense", "Commonsense")]
    lines += ["## Pass rate by constraint level (after Xie et al. 2024, TravelPlanner)", "",
              "| variant | " + " | ".join(n for _, n in level_names) + " | all three | lunch served | runs |",
              "|---|" + "---|" * (len(level_names) + 3)]
    for v in variants:
        rs = [r for c in cases for r in by_vc[(v, c)] if "fc" in r]
        flags = [level_flags(r) for r in rs]
        cells = [f"{100 * sum(f[k] for f in flags) / len(flags):.0f}%" if flags else "-" for k, _ in level_names]
        macro = f"{100 * sum(all(f.values()) for f in flags) / len(flags):.0f}%" if flags else "-"
        el = sum(r["fc"]["lunch_eligible_days"] for r in rs)
        sv = sum(r["fc"]["lunch_served_days"] for r in rs)
        lines.append(f"| `{v}` | " + " | ".join(cells) + f" | {macro} | {sv}/{el} | {len(rs)} |")
    lines += ["",
              "Share of runs that pass each level. Environment = every place ID is real and none repeated (LLM output as written). "
              "Hard = every must-go place is in the final plan (budget and area scope are judged by `constraint_fit`, not checked by code). "
              "Commonsense = every day has a meal in the final plan and the LLM did not pick a place closed that day. "
              "'lunch served' = days with a restaurant arriving 11:00-14:00 out of days whose window covers lunch.", ""]

    # ---- judge diagnostics ----
    lines += ["## Judge diagnostics (is the judge measuring what we think?)", ""]
    allruns = [r for c in cases for v in variants for r in by_vc[(v, c)] if "fc" in r]
    xs, ys = [], []
    for c in cases:
        grp = [r for r in allruns if r["case"] == c]
        if len(grp) < 2:
            continue
        mx = statistics.fmean(r["fc"]["itinerary_chars"] for r in grp)
        my = statistics.fmean(judge_mean(r) for r in grp)
        xs += [r["fc"]["itinerary_chars"] - mx for r in grp]
        ys += [judge_mean(r) - my for r in grp]
    rho = spearman(xs, ys)
    lines.append(f"- **Verbosity check**: Spearman rho between plan length (characters of the itinerary text) and judge mean, "
                 f"after removing each case's average = **{fmt(rho)}** over {len(xs)} runs. "
                 "Near 0 gives no sign that longer plans are scored higher just for being longer; a clearly positive value needs a closer look "
                 "(longer plans can also be genuinely fuller).")
    checks = [
        ("constraint_fit when a must-go place is missing from the final plan",
         lambda r: r["final"]["must_go_missing_final"] > 0, lambda r: r["judge"]["scores"]["constraint_fit"]),
        ("variety_flow when a day has no meal",
         lambda r: r["fc"]["no_meal_days"] > 0, lambda r: r["judge"]["scores"]["variety_flow"]),
    ]
    for label, flag, score in checks:
        yes = [score(r) for r in allruns if flag(r)]
        no = [score(r) for r in allruns if not flag(r)]
        if yes and no:
            lines.append(f"- **Agreement with a code check**: {label}: mean {statistics.fmean(yes):.2f} (n={len(yes)}) vs "
                         f"{statistics.fmean(no):.2f} (n={len(no)}) otherwise. The first should be clearly lower if the judge notices the defect.")
        else:
            lines.append(f"- **Agreement with a code check**: {label}: cannot be assessed -- "
                         f"{'every run' if yes else 'no run'} has the defect (n={len(yes) or len(no)}).")
    lines.append("")

    # ---- decision ----
    lines += ["## Decision rule", "",
              f"Adopt a variant only if ALL hold: (a) mean Δ ≥ {noise:.2f}; (b) wins more cases than it loses; (c) no case lost by more than {MAX_CASE_LOSS}; "
              f"(d) raw hard violations ≤ baseline + {HARD_VIOLATION_SLACK}; (e) must-go missing in the final plan not worse than baseline; (f) no failures of its own.", ""]
    adoptable = []
    for v in variants:
        if v == BASELINE:
            continue
        s = stats[v]
        checks = {
            f"(a) Δ {s['delta']:+.2f} ≥ {noise:.2f}": s["delta"] >= noise,
            f"(b) W{s['w']} > L{s['l']}": s["w"] > s["l"],
            f"(c) worst case {s['worst']:+.2f} ≥ -{MAX_CASE_LOSS}": s["worst"] >= -MAX_CASE_LOSS - 1e-9,
            f"(d) violations {fmt(s['viol'])} ≤ {fmt(stats[BASELINE]['viol'] + HARD_VIOLATION_SLACK)}": s["viol"] <= stats[BASELINE]["viol"] + HARD_VIOLATION_SLACK,
            f"(e) must-go missing {fmt(s['mg'])} ≤ {fmt(stats[BASELINE]['mg'])}": s["mg"] <= stats[BASELINE]["mg"],
            f"(f) own failures {s['fails']} = 0": s["fails"] == 0,
        }
        lines.append(f"- `{v}`: " + "; ".join(f"{'✅' if ok_ else '❌'} {k}" for k, ok_ in checks.items()))
        if all(checks.values()):
            adoptable.append(v)
    lines.append("")
    if adoptable:
        best = max(adoptable, key=lambda v: stats[v]["delta"])
        status = "confirmed (95% CI excludes 0)" if stats[best]["ci"][1] > 0 else "tentative (95% CI includes 0)"
        lines.append(f"**Adopt `{best}`** (largest Δ among variants that pass every check) -- {status}. With this few cases, "
                     "confirm with `--mode loop` or more reps before relying on it.")
    else:
        lines.append("**Keep `v0_baseline`** -- no variant clears every check. Read the per-criterion and pick-quality tables for "
                     "which individual change looks promising, then confirm that one with more reps.")
    lines.append("")

    if infra or own_fail or dropped_cases:
        lines += ["## Not counted", ""]
        if infra:
            lines.append(f"- {len(infra)} run(s) lost to infrastructure errors (quota/network) -- not held against any variant; re-run to fill them.")
        for r in own_fail:
            lines.append(f"- own failure: {r['variant']} {r['case']} rep{r['rep']}: {rec_error(r)}")
        lines.append("")

    out = run_dir / "report.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"\nwritten: {out}")


if __name__ == "__main__":
    main()
