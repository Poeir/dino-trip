"""retriever._match_places: uses match_places_ranked, and falls back to
match_places_hybrid (minus the heavy columns) on a database where migration
20261021000002 hasn't been applied yet."""
import pytest

from src.services.rag import retriever


@pytest.fixture(autouse=True)
def reset_flag(monkeypatch):
    monkeypatch.setattr(retriever, "_ranked_search_available", True)


def test_uses_the_ranked_function(monkeypatch):
    calls = []

    def fake_rpc_many(batch):
        calls.extend(name for name, _ in batch)
        return [[{"id": "a", "match_score": 1.0}] for _ in batch]

    monkeypatch.setattr(retriever, "rpc_many", fake_rpc_many)
    assert retriever._match_places([([0.0], "x"), ([0.0], "y")], 5) == [[{"id": "a", "match_score": 1.0}]] * 2
    assert calls == ["match_places_ranked", "match_places_ranked"]


def test_falls_back_when_the_function_is_missing(monkeypatch):
    def fake_rpc_many(batch):
        if batch[0][0] == "match_places_ranked":
            raise Exception("{'code': 'PGRST202', 'message': 'Could not find the function public.match_places_ranked'}")
        return [[{"id": "a", "raw_data": {"big": 1}, "embedding": "[0.1]", "reviews": [], "images": [], "name": "A"}]]

    monkeypatch.setattr(retriever, "rpc_many", fake_rpc_many)
    assert retriever._match_places([([0.0], "x")], 5) == [[{"id": "a", "name": "A"}]]
    assert retriever._ranked_search_available is False


def test_other_errors_are_not_swallowed(monkeypatch):
    def fake_rpc_many(batch):
        raise RuntimeError("network down")

    monkeypatch.setattr(retriever, "rpc_many", fake_rpc_many)
    with pytest.raises(RuntimeError):
        retriever._match_places([([0.0], "x")], 5)
