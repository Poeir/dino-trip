"""What text goes into the embedding model, and the e5 prefixes around it.

The offline benchmark behind these choices is in embedder.PLACE_DESCRIPTION_CHARS'
comment. What matters here: amenities stay ahead of the description (the model
only reads the start of long text), the description is capped, and a model that
needs "passage: "/"query: " gets them on the right side -- stored text vs search
text -- since a mix-up silently degrades every search.
"""
import importlib
from types import SimpleNamespace

import pytest

from src.services.rag import embedder, retriever

PLACE = {
    "name": "ร้านทดสอบ", "category": "คาเฟ่", "subcategory": "กาแฟ", "tags": ["คาเฟ่", "ครอบครัว"],
    "amenities": ["ที่จอดรถ", "มีดนตรีสด"], "description": "ก" * 1000,
}


def test_place_text_puts_amenities_before_the_description_and_caps_it():
    text = embedder.place_text(PLACE)
    head, _, description = text.rpartition(" - ")
    assert head == "ร้านทดสอบ - คาเฟ่ - กาแฟ - คาเฟ่ - ครอบครัว - ที่จอดรถ - มีดนตรีสด"
    assert description == "ก" * embedder.PLACE_DESCRIPTION_CHARS


def test_place_text_tolerates_missing_fields():
    assert embedder.place_text({"name": "x", "description": None, "tags": None, "amenities": None}) == "x"


@pytest.mark.parametrize(
    "model, passage, query",
    [
        ("intfloat/multilingual-e5-small", "passage: ", "query: "),
        ("paraphrase-multilingual-MiniLM-L12-v2", "", ""),
    ],
)
def test_prefixes_follow_the_model_family(monkeypatch, model, passage, query):
    from src.core import config

    for var in ("EMBEDDING_PASSAGE_PREFIX", "EMBEDDING_QUERY_PREFIX"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("EMBEDDING_MODEL_NAME", model)
    try:
        importlib.reload(config)
        assert (config.EMBEDDING_PASSAGE_PREFIX, config.EMBEDDING_QUERY_PREFIX) == (passage, query)
    finally:
        monkeypatch.undo()
        importlib.reload(config)


def test_search_text_gets_the_query_prefix(monkeypatch):
    seen = []
    monkeypatch.setattr(retriever, "_model", SimpleNamespace(
        encode=lambda text, normalize_embeddings: seen.append(text) or SimpleNamespace(tolist=lambda: [1.0])))
    monkeypatch.setattr(retriever, "EMBEDDING_QUERY_PREFIX", "query: ")
    retriever._embed_cached.cache_clear()
    retriever.embed("คาเฟ่ริมบึง")
    assert seen == ["query: คาเฟ่ริมบึง"]
    retriever._embed_cached.cache_clear()


def test_stored_text_gets_the_passage_prefix(monkeypatch):
    seen, updates = [], []
    monkeypatch.setattr(embedder, "get_model", lambda: SimpleNamespace(
        encode=lambda text, normalize_embeddings: seen.append(text) or SimpleNamespace(tolist=lambda: [1.0])))
    monkeypatch.setattr(embedder, "EMBEDDING_PASSAGE_PREFIX", "passage: ")

    class FakeTable:
        def update(self, values):
            updates.append(values)
            return self

        def eq(self, *_):
            return self

        def execute(self):
            return SimpleNamespace(data=[{"id": 1}])

    monkeypatch.setattr(embedder, "supabase", SimpleNamespace(table=lambda _: FakeTable()))
    assert embedder.embed_rows("places", [{"id": 1, **PLACE}], embedder.place_text) == 1
    assert seen == ["passage: " + embedder.place_text(PLACE)]
    assert updates == [{"embedding": [1.0]}]
