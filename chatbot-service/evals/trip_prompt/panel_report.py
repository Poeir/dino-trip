"""Judge-panel section of report.py.

The run's own judge (results.jsonl) is the PRIMARY judge and decides adoption
exactly as PROTOCOL.md section 4 says. Extra judges (judgements.jsonl, written
by add_judge.py) are a sensitivity analysis: the same case-level comparison is
repeated per judge, then on the panel average, together with how far the judges
agree. Nothing here changes the decision rule.
"""
import json
import statistics
from collections import defaultdict

from .eval_judge import CRITERIA
from .stats import paired_bootstrap, spearman


def _fmt(x, nd=2):
    return "-" if x is None or x != x else f"{x:.{nd}f}"


def load_scores(run_dir, ok_recs):
    """{judge_key: {(variant, case, rep): {"mean": float, "scores": {...}}}}, primary judge first."""
    out = {}
    primary = None
    for r in ok_recs:
        j = r["judge"]
        key = f"{j.get('judge_provider', 'kku')}:{j['judge_model']}"
        primary = primary or key
        out.setdefault(key, {})[(r["variant"], r["case"], r["rep"])] = {"mean": j["mean"], "scores": j["scores"]}
    path = run_dir / "judgements.jsonl"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            j = json.loads(line)
            if j["judge_key"] == primary or "error" in j["judge"]:
                continue  # the primary judge's own scores come from results.jsonl
            out.setdefault(j["judge_key"], {})[(j["variant"], j["case"], j["rep"])] = {
                "mean": j["judge"]["mean"], "scores": j["judge"]["scores"]}
    return out, primary


def analyse(scores, variants, cases, baseline, min_noise, max_case_loss):
    """Case-level comparison vs baseline for one score table. Mirrors report.py's rules."""
    by_vc = defaultdict(list)
    for (v, c, _), s in scores.items():
        if v in variants and c in cases:
            by_vc[(v, c)].append(s["mean"])
    cs = [c for c in cases if all(by_vc.get((v, c)) for v in variants)]
    if not cs:
        return None
    stds = [statistics.pstdev(by_vc[(baseline, c)]) for c in cs if len(by_vc[(baseline, c)]) > 1]
    noise = max(min_noise, statistics.fmean(stds) if stds else 0.0)
    case_mean = {(v, c): statistics.fmean(by_vc[(v, c)]) for v in variants for c in cs}
    res = {"cases": cs, "noise": noise, "variants": {}}
    for v in variants:
        row = {"mean": statistics.fmean(case_mean[(v, c)] for c in cs), "n": sum(len(by_vc[(v, c)]) for c in cs)}
        if v != baseline:
            d = [case_mean[(v, c)] - case_mean[(baseline, c)] for c in cs]
            row.update(delta=statistics.fmean(d), w=sum(x > noise for x in d), l=sum(x < -noise for x in d),
                       worst=min(d),
                       ci=paired_bootstrap({c: by_vc[(v, c)] for c in cs}, {c: by_vc[(baseline, c)] for c in cs}))
            row["t"] = len(d) - row["w"] - row["l"]
            row["pass_abc"] = row["delta"] >= noise and row["w"] > row["l"] and row["worst"] >= -max_case_loss - 1e-9
        res["variants"][v] = row
    return res


def _centered(scores, keys):
    """Per-run score minus the average of its case, over the given keys."""
    by_case = defaultdict(list)
    for k in keys:
        by_case[k[1]].append(scores[k]["mean"])
    avg = {c: statistics.fmean(v) for c, v in by_case.items()}
    return {k: scores[k]["mean"] - avg[k[1]] for k in keys}


def panel_lines(run_dir, ok_recs, cases, variants, baseline, min_noise, max_case_loss):
    judges, primary = load_scores(run_dir, ok_recs)
    if len(judges) < 2:
        return []
    keys = list(judges)
    lines = ["## Judge panel (sensitivity analysis -- does not change the decision rule)", "",
             f"Primary judge (decides adoption per PROTOCOL.md): `{primary}`. Extra judges: "
             + ", ".join(f"`{k}`" for k in keys if k != primary) + ".", ""]

    # ---- coverage and leniency ----
    lines += ["| judge | runs scored | mean score | " + " | ".join(CRITERIA) + " |", "|---|---|---|" + "---|" * len(CRITERIA)]
    for k in keys:
        rows = [s for (v, c, _), s in judges[k].items() if v in variants and c in cases]
        lines.append(f"| `{k}`{' (primary)' if k == primary else ''} | {len(rows)} | "
                     f"{_fmt(statistics.fmean(r['mean'] for r in rows) if rows else None)} | "
                     + " | ".join(_fmt(statistics.fmean(r['scores'][c] for r in rows) if rows else None) for c in CRITERIA) + " |")
    lines += ["", "Judges differ in how generous they are; compare each judge's variant differences, not its absolute level.", ""]

    # ---- per-judge and panel comparison vs baseline ----
    common = set.intersection(*[{k for k in judges[j] if k[0] in variants and k[1] in cases} for j in keys])
    panel = {k: {"mean": statistics.fmean(judges[j][k]["mean"] for j in keys)} for k in common}
    tables = [(f"`{k}`" + (" (primary)" if k == primary else ""), judges[k]) for k in keys]
    if panel:
        tables.append((f"**panel mean** ({len(keys)} judges, {len(common)} runs all judges scored)", panel))
    lines += ["| judge | variant | mean | Δ vs baseline | 95% CI of Δ | W/T/L | worst case Δ | noise floor | passes (a)-(c) |",
              "|---|---|---|---|---|---|---|---|---|"]
    direction = {}
    for label, sc in tables:
        a = analyse(sc, variants, cases, baseline, min_noise, max_case_loss)
        if a is None:
            lines.append(f"| {label} | (no case has every variant scored) | | | | | | | |")
            continue
        for v in variants:
            r = a["variants"][v]
            if v == baseline:
                lines.append(f"| {label} | `{v}` | {_fmt(r['mean'])} | — | — | — | — | {a['noise']:.2f} | — |")
                continue
            ci = r["ci"]
            direction.setdefault(v, {})[label] = r["delta"]
            lines.append(f"| {label} | `{v}` | {_fmt(r['mean'])} | {r['delta']:+.2f} | [{ci[1]:+.2f}, {ci[2]:+.2f}] | "
                         f"{r['w']}/{r['t']}/{r['l']} | {r['worst']:+.2f} | {a['noise']:.2f} | {'✅' if r['pass_abc'] else '❌'} |")
    lines += ["", "(a)-(c) are the score-based checks of the decision rule (Δ ≥ noise floor; wins > losses; no case lost by more than "
              f"{max_case_loss}); (d)-(f) come from code checks and are judge-independent. Noise floor is computed per judge "
              "from the baseline's own rep spread.", ""]

    # ---- agreement ----
    lines += ["**Do the judges agree?**", ""]
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            both = sorted(k for k in judges[keys[i]] if k in judges[keys[j]] and k[0] in variants and k[1] in cases)
            if len(both) < 3:
                lines.append(f"- `{keys[i]}` vs `{keys[j]}`: too few common runs ({len(both)})")
                continue
            ci_, cj_ = _centered(judges[keys[i]], both), _centered(judges[keys[j]], both)
            rho = spearman([ci_[k] for k in both], [cj_[k] for k in both])
            exact = sum(judges[keys[i]][k]["mean"] == judges[keys[j]][k]["mean"] for k in both)
            lines.append(f"- `{keys[i]}` vs `{keys[j]}`: Spearman ρ = **{_fmt(rho)}** on {len(both)} common runs "
                         f"(case average removed, so this is agreement within a case); identical mean score on {exact}.")
    for v, per in direction.items():
        signs = {label: (1 if d > 0 else -1 if d < 0 else 0) for label, d in per.items() if "panel" not in label}
        same = len(set(signs.values())) == 1
        lines.append(f"- `{v}`: direction of Δ {'is the same for all judges' if same else '**differs between judges**'} "
                     "(" + ", ".join(f"{lab.split('`')[1]} {d:+.2f}" for lab, d in per.items() if "panel" not in lab) + ").")
    lines.append("")

    # ---- code-check agreement per judge ----
    by_key = {(r["variant"], r["case"], r["rep"]): r for r in ok_recs}
    lines += ["**Does each judge notice a defect the code can see?** (constraint_fit when a must-go place is missing from the final plan)", ""]
    for k in keys:
        yes = [s["scores"]["constraint_fit"] for key, s in judges[k].items()
               if key in by_key and by_key[key]["final"]["must_go_missing_final"] > 0]
        no = [s["scores"]["constraint_fit"] for key, s in judges[k].items()
              if key in by_key and by_key[key]["final"]["must_go_missing_final"] == 0]
        if yes and no:
            lines.append(f"- `{k}`: {statistics.fmean(yes):.2f} (n={len(yes)}) when missing vs {statistics.fmean(no):.2f} (n={len(no)}) otherwise.")
        else:
            lines.append(f"- `{k}`: cannot be assessed ({'every run' if yes else 'no run'} has the defect).")
    lines.append("")
    return lines
