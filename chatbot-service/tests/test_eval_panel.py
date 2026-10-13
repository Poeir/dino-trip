"""Judge panel for the prompt eval (panel_report.py, add_judge.py). Pure data, no LLM."""
import json

from evals.trip_prompt import add_judge, panel_report

CRIT = ["interest_fit", "constraint_fit", "variety_flow", "day_coherence", "selection_quality"]


def _rec(variant, case, rep, mean, judge_model="claude-sonnet-5.5", missing=0):
    return {"variant": variant, "case": case, "rep": rep, "llm_output": {}, "itinerary": [],
            "final": {"must_go_missing_final": missing},
            "judge": {"mean": mean, "scores": {c: round(mean) for c in CRIT}, "judge_model": judge_model}}


def _judgement(key, variant, case, rep, mean, **extra):
    return {"judge_key": key, "variant": variant, "case": case, "rep": rep,
            "judge": {"mean": mean, "scores": {c: round(mean) for c in CRIT}, **extra}}


def _write(path, rows):
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")


CASES = ["c1", "c2", "c3", "c4"]


def _primary(delta_v1):
    recs = []
    for c in CASES:
        for rep in (1, 2):
            recs.append(_rec("v0", c, rep, 3.0 + 0.05 * rep))
            recs.append(_rec("v1", c, rep, 3.0 + 0.05 * rep + delta_v1))
    return recs


class TestLoadScores:
    def test_primary_comes_from_results_and_extras_from_judgements(self, tmp_path):
        recs = _primary(0.0)
        _write(tmp_path / "judgements.jsonl", [
            _judgement("kku:gpt-5.6-terra", "v0", "c1", 1, 4.0),
            _judgement("kku:claude-sonnet-5.5", "v0", "c1", 1, 1.0),            # primary's own key: ignored
            _judgement("kku:deepseek-v4-pro", "v0", "c1", 1, 2.0, error="boom"),  # failed call: ignored
        ])
        judges, primary = panel_report.load_scores(tmp_path, recs)
        assert primary == "kku:claude-sonnet-5.5"
        assert list(judges) == ["kku:claude-sonnet-5.5", "kku:gpt-5.6-terra"]
        assert judges["kku:claude-sonnet-5.5"][("v0", "c1", 1)]["mean"] == 3.05
        assert judges["kku:gpt-5.6-terra"][("v0", "c1", 1)]["mean"] == 4.0

    def test_no_judgements_file_means_single_judge(self, tmp_path):
        judges, _ = panel_report.load_scores(tmp_path, _primary(0.0))
        assert len(judges) == 1
        assert panel_report.panel_lines(tmp_path, _primary(0.0), CASES, ["v0", "v1"], "v0", 0.15, 0.4) == []


class TestAnalyse:
    def _scores(self, delta):
        return {(r["variant"], r["case"], r["rep"]): r["judge"] for r in _primary(delta)}

    def test_clear_win_passes_abc(self):
        a = panel_report.analyse(self._scores(0.5), ["v0", "v1"], CASES, "v0", 0.15, 0.4)
        v1 = a["variants"]["v1"]
        assert round(v1["delta"], 2) == 0.5 and (v1["w"], v1["t"], v1["l"]) == (4, 0, 0) and v1["pass_abc"]

    def test_small_difference_is_a_tie_and_fails(self):
        v1 = panel_report.analyse(self._scores(0.05), ["v0", "v1"], CASES, "v0", 0.15, 0.4)["variants"]["v1"]
        assert (v1["w"], v1["t"], v1["l"]) == (0, 4, 0) and not v1["pass_abc"]

    def test_case_missing_a_variant_is_excluded(self):
        sc = self._scores(0.5)
        for rep in (1, 2):
            del sc[("v1", "c4", rep)]
        a = panel_report.analyse(sc, ["v0", "v1"], CASES, "v0", 0.15, 0.4)
        assert a["cases"] == ["c1", "c2", "c3"]


class TestPanelLines:
    def test_reports_direction_disagreement(self, tmp_path):
        recs = _primary(0.5)                                                     # primary: v1 clearly better
        rows = []
        for c in CASES:
            for rep in (1, 2):
                rows.append(_judgement("kku:gpt-5.6-terra", "v0", c, rep, 3.0 + 0.1 * rep))
                rows.append(_judgement("kku:gpt-5.6-terra", "v1", c, rep, 2.4 + 0.1 * rep))   # extra judge: v1 worse
        _write(tmp_path / "judgements.jsonl", rows)
        text = "\n".join(panel_report.panel_lines(tmp_path, recs, CASES, ["v0", "v1"], "v0", 0.15, 0.4))
        assert "Judge panel" in text and "panel mean" in text
        assert "differs between judges" in text
        assert "Spearman" in text

    def test_code_check_row_per_judge(self, tmp_path):
        recs = _primary(0.0)
        recs[0]["final"]["must_go_missing_final"] = 1
        _write(tmp_path / "judgements.jsonl", [_judgement("kku:gpt-5.6-terra", r["variant"], r["case"], r["rep"], 3.0) for r in recs])
        text = "\n".join(panel_report.panel_lines(tmp_path, recs, CASES, ["v0", "v1"], "v0", 0.15, 0.4))
        assert "kku:gpt-5.6-terra" in text and "when missing" in text


class TestAddJudgeHelpers:
    def test_latest_runs_order_and_filters(self, tmp_path):
        rows = [
            {"variant": "v0_baseline", "case": "c2", "rep": 2, "llm_output": {}, "itinerary": []},
            {"variant": "v0_baseline", "case": "c1", "rep": 1, "llm_output": {}, "itinerary": []},
            {"variant": "v1_rules", "case": "c1", "rep": 1, "llm_output": {}, "itinerary": []},
            {"variant": "v0_after", "case": "c1", "rep": 1, "llm_output": {}, "itinerary": []},      # alias: excluded
            {"variant": "v2_context", "case": "c1", "rep": 1, "error": "bad json"},                    # no generation
            {"variant": "v3_plan_first", "case": "c1", "rep": 1, "llm_output": {}, "itinerary": []},
        ]
        _write(tmp_path / "results.jsonl", rows)
        got = [(r["rep"], r["case"], r["variant"]) for r in add_judge.latest_runs(tmp_path)]
        assert got == [(1, "c1", "v0_baseline"), (1, "c1", "v1_rules"), (1, "c1", "v3_plan_first"), (2, "c2", "v0_baseline")]

    def test_judged_keys_are_per_judge_and_skip_errors(self, tmp_path):
        p = tmp_path / "judgements.jsonl"
        _write(p, [
            _judgement("kku:gpt-5.6-terra", "v0", "c1", 1, 3.0),
            _judgement("kku:gpt-5.6-terra", "v0", "c1", 2, 3.0, error="x"),
            _judgement("kku:deepseek-v4-pro", "v0", "c1", 3, 3.0),
        ])
        assert add_judge.judged_keys(p, "kku:gpt-5.6-terra") == {("v0", "c1", 1)}
        assert add_judge.judged_keys(tmp_path / "missing.jsonl", "x") == set()
