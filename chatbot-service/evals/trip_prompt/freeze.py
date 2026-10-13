"""Freeze the candidate pools for the final experiment and record provenance.

    venv/Scripts/python -m evals.trip_prompt.freeze --tag _final          # build + freeze (DB read, no LLM)
    venv/Scripts/python -m evals.trip_prompt.freeze --tag _final --verify # check nothing changed

Freezing = the pools are retrieved once into cache/<case><tag>.json, made
read-only, and their SHA-256 written to cache/manifest<tag>.json. run_eval
refuses to start with that --pool-tag if a file no longer matches its hash, or
if --refresh-cache is passed, so every variant/rep/day sees identical data.

The code is mostly uncommitted while experiments run, so a git hash alone does
not identify what produced a result; provenance() also fingerprints the files
that decide behaviour.
"""
import argparse
import hashlib
import json
import os
import stat
import subprocess
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
CACHE_DIR = HERE / "cache"
SRC = HERE.parent.parent / "src" / "services" / "trip_planner"
FINGERPRINT_FILES = [
    SRC / "route_scheduler.py", SRC / "orchestrator.py", SRC / "llm_extractor.py",
    HERE / "prompts.py", HERE / "eval_judge.py", HERE / "cases.py", HERE / "metrics.py",
]


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def manifest_path(tag):
    return CACHE_DIR / f"manifest{tag}.json"


def provenance():
    def git(*args):
        try:
            return subprocess.run(["git", *args], cwd=HERE, capture_output=True, text=True, timeout=20).stdout.strip()
        except Exception:
            return None
    protocol = HERE / "PROTOCOL.md"
    return {
        "git_commit": git("rev-parse", "--short", "HEAD"),
        "git_dirty_files": len([l for l in (git("status", "--porcelain") or "").splitlines() if l.strip()]),
        "file_sha256": {p.name: sha256(p)[:16] for p in FINGERPRINT_FILES if p.exists()},
        "protocol_sha256": sha256(protocol)[:16] if protocol.exists() else None,
    }


def verify(tag, case_ids=None):
    """Problems (list of str) between the manifest and the files on disk; [] = intact.
    Returns None when the tag has no manifest (i.e. it is not frozen)."""
    mp = manifest_path(tag)
    if not mp.exists():
        return None
    manifest = json.loads(mp.read_text(encoding="utf-8"))
    problems = []
    for cid in case_ids or manifest["cases"]:
        entry = manifest["cases"].get(cid)
        if entry is None:
            problems.append(f"{cid}: not in manifest")
            continue
        path = CACHE_DIR / entry["file"]
        if not path.exists():
            problems.append(f"{cid}: file missing")
        elif sha256(path) != entry["sha256"]:
            problems.append(f"{cid}: content changed since freeze")
    return problems


def build(tag):
    from .cases import CASES
    from .run_eval import load_case_context

    mp = manifest_path(tag)
    if mp.exists():
        raise SystemExit(f"{mp.name} already exists: tag {tag!r} is frozen. Use a new tag, or delete the manifest on purpose.")
    entries = {}
    for case in CASES:
        path = CACHE_DIR / f"{case['id']}{tag}.json"
        if path.exists():
            os.chmod(path, stat.S_IWRITE)
        ui, hotel, cands, must_go, missing, _, _ = load_case_context(case, refresh=True, cache_tag=tag)
        os.chmod(path, stat.S_IREAD)
        raw = json.loads(path.read_text(encoding="utf-8"))
        entries[case["id"]] = {
            "file": path.name, "sha256": sha256(path), "n_candidates": len(cands),
            "n_restaurants": sum(1 for c in cands if c.category == "ร้านอาหาร"),
            "n_must_go_found": len(must_go), "must_go_not_found": missing,
            "retrieved_at": raw.get("retrieved_at"),
        }
        print(f"{case['id']}: {len(cands)} candidates ({entries[case['id']]['n_restaurants']} restaurants)")
    mp.write_text(json.dumps({
        "tag": tag, "frozen_at": datetime.now().isoformat(timespec="seconds"),
        "provenance": provenance(), "cases": entries,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"frozen -> {mp}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True, help="pool tag, e.g. _final")
    ap.add_argument("--verify", action="store_true", help="only check an existing freeze")
    args = ap.parse_args()
    if args.verify:
        problems = verify(args.tag)
        if problems is None:
            raise SystemExit(f"no manifest for tag {args.tag!r}")
        print("OK: all pools match the manifest" if not problems else "\n".join(problems))
        raise SystemExit(1 if problems else 0)
    build(args.tag)


if __name__ == "__main__":
    main()
