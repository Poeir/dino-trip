"""Summarizes logs/usage.jsonl (written by src/core/usage.py): average / median /
max input + output tokens and cost per chat turn and per trip.

    python scripts/usage_report.py                  # default log path
    python scripts/usage_report.py path/to/usage.jsonl --thb 36
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "logs" / "usage.jsonl"


def load(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def stats(values: list[float]) -> str:
    return f"avg {statistics.mean(values):>9,.0f}  p50 {statistics.median(values):>9,.0f}  max {max(values):>9,.0f}"


def report(title: str, rows: list[dict], thb: float) -> None:
    if not rows:
        print(f"\n== {title}: no data ==")
        return
    print(f"\n== {title}: {len(rows)} requests ==")
    print(f"  llm calls    {stats([r['llm_calls'] for r in rows])}")
    print(f"  input tok    {stats([r['input_tokens'] for r in rows])}")
    print(f"  output tok   {stats([r['output_tokens'] for r in rows])}")
    costs = [r["cost_usd"] for r in rows]
    print(f"  cost USD     avg {statistics.mean(costs):.5f}  p50 {statistics.median(costs):.5f}  max {max(costs):.5f}")
    print(f"  cost THB     avg {statistics.mean(costs) * thb:.3f}  max {max(costs) * thb:.3f}   (total {sum(costs) * thb:.2f})")
    missing = sum(r.get("missing_usage", 0) for r in rows)
    if missing:
        print(f"  ! {missing} LLM call(s) had no usage data -- totals are understated")

    labels: dict[str, list[dict]] = {}
    for r in rows:
        for label, b in r["by_label"].items():
            labels.setdefault(label, []).append(b)
    print("  per call type (avg per request):")
    for label, bs in sorted(labels.items()):
        n = len(bs)
        print(
            f"    {label:<9} calls {sum(b['calls'] for b in bs) / len(rows):>4.2f}  "
            f"in {sum(b['input'] for b in bs) / len(rows):>8,.0f}  out {sum(b['output'] for b in bs) / len(rows):>7,.0f}  "
            f"(seen in {n}/{len(rows)})"
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?", type=Path, default=DEFAULT_PATH)
    ap.add_argument("--thb", type=float, default=36.0, help="THB per USD (default 36)")
    args = ap.parse_args()
    if not args.path.exists():
        print(f"No usage log at {args.path} -- run some chats/trips first.")
        return 1
    rows = load(args.path)
    chats = [r for r in rows if r["scope"] == "chat"]
    report("chat (all turns)", chats, args.thb)
    report("chat, first turn", [r for r in chats if r.get("turn") == 1], args.thb)
    report("chat, follow-up turns", [r for r in chats if r.get("turn", 1) > 1], args.thb)
    report("trip (ok)", [r for r in rows if r["scope"] == "trip" and not r.get("failed")], args.thb)
    report("trip (failed, still billed)", [r for r in rows if r["scope"] == "trip" and r.get("failed")], args.thb)
    return 0


if __name__ == "__main__":
    sys.exit(main())
