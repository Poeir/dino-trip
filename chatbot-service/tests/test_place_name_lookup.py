"""find_place_by_name: which typed accommodation / must-go name resolves to a
place. The database call is faked; the rules live in _pick_named_place."""
from types import SimpleNamespace

from src.core import db


def rows(*names):
    return [{"id": f"p{i}", "name": n} for i, n in enumerate(names)]


class TestPickNamedPlace:
    def test_a_generic_word_that_fits_many_places_names_none_of_them(self):
        # Live data: "วัด" used to become whichever temple came back first.
        assert db._pick_named_place(rows("วัดธาตุ", "วัดหนองแวง", "วัดป่าอดุลยาราม"), "วัด") is None

    def test_an_exact_name_wins_over_longer_names_that_contain_it(self):
        found = db._pick_named_place(rows("ตลาดต้นตาล 2", "ตลาดต้นตาล ", "ร้านข้างตลาดต้นตาล"), " ตลาดต้นตาล")
        assert found["name"] == "ตลาดต้นตาล "          # spaces around either side don't matter

    def test_a_partial_name_counts_when_only_one_place_has_it(self):
        assert db._pick_named_place(rows("วัดป่าอดุลยาราม", "วัดธาตุ"), "อดุลยาราม")["name"] == "วัดป่าอดุลยาราม"

    def test_case_is_ignored(self):
        assert db._pick_named_place(rows("SIRI Gift House"), "siri gift house")["name"] == "SIRI Gift House"

    def test_rows_the_database_matched_only_through_a_wildcard_are_ignored(self):
        # "100%" is sent as "100_": the database also returns "1000 Cafe".
        assert db._pick_named_place(rows("100% Coffee", "1000 Cafe"), "100%")["name"] == "100% Coffee"


class FakeQuery:
    def __init__(self, calls, data):
        self.calls, self.data = calls, data

    def select(self, columns):
        self.calls["columns"] = columns
        return self

    def eq(self, column, value):
        self.calls.setdefault("eq", []).append((column, value))
        return self

    def ilike(self, column, pattern):
        self.calls["ilike"] = (column, pattern)
        return self

    def limit(self, n):
        return self

    def execute(self):
        return SimpleNamespace(data=self.data)


class TestFindPlaceByName:
    def _patch(self, monkeypatch, data):
        calls = {}
        monkeypatch.setattr(db, "supabase", SimpleNamespace(table=lambda name: FakeQuery(calls, data)))
        return calls

    def test_only_published_places_are_searched(self, monkeypatch):
        calls = self._patch(monkeypatch, rows("เตียฮั่วหยู"))
        assert db.find_place_by_name("เตียฮั่วหยู")["name"] == "เตียฮั่วหยู"
        assert ("is_active", True) in calls["eq"]
        assert "embedding" not in calls["columns"] and calls["columns"] != "*"

    def test_wildcards_in_the_typed_name_are_not_sent_as_wildcards(self, monkeypatch):
        calls = self._patch(monkeypatch, rows("100% Coffee"))
        db.find_place_by_name("100% C*ffee\\")
        assert calls["ilike"] == ("name", "%100_ C_ffee_%")

    def test_empty_or_one_character_names_never_reach_the_database(self, monkeypatch):
        calls = self._patch(monkeypatch, rows("anything"))
        assert db.find_place_by_name("") is None and db.find_place_by_name(" % ") is None
        assert calls == {}
