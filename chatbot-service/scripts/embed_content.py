"""Embeds every `places` and `knowledge_base` row and writes the vector into
each table's `embedding` column, for pgvector similarity search.

Python equivalent of the (now removed) Node backend/scripts/embed-content.js
-- ports the same composed-text strategy for consistency, but runs the model
natively via sentence-transformers instead of the ONNX/transformers.js build,
so results are computed once, uniformly, by whatever process owns embedding
going forward (this service), rather than split across two runtimes.

Run whenever places/knowledge_base rows are added or edited:
    cd chatbot-service && python scripts/embed_content.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sentence_transformers import SentenceTransformer
from src.core.config import EMBEDDING_MODEL_NAME
from src.core.db import supabase


def place_text(p: dict) -> str:
    """Kept tightly focused on what a search query is actually about -- name,
    category, interest tags, description, amenities. Mixing in rating/hours/
    address (like the original setup_vector_db.py did) was tested against
    this dataset and badly diluted retrieval quality (buffet/park/cafe
    queries all returned irrelevant top results); dropping them fixed it."""
    parts = [p.get("name"), p.get("category"), *(p.get("tags") or []), p.get("description"), *(p.get("amenities") or [])]
    return " - ".join(x for x in parts if x)


def knowledge_base_text(k: dict) -> str:
    return f"หัวข้อ: {k.get('title', '')}\nหมวดหมู่: {k.get('category') or 'ไม่ระบุ'}\nเนื้อหา: {k.get('content', '')}"


def embed_all(model, table: str, rows: list[dict], text_fn):
    print(f"Embedding {len(rows)} rows in {table}...")
    for row in rows:
        vector = model.encode(text_fn(row), normalize_embeddings=True).tolist()
        res = supabase.table(table).update({"embedding": vector}).eq("id", row["id"]).execute()
        if not res.data:
            print(f"  Warning: no row updated for {table} id={row['id']}")
    print(f"Done embedding {table}.")


def main():
    print(f"Loading embedding model ({EMBEDDING_MODEL_NAME})...")
    model = SentenceTransformer(EMBEDDING_MODEL_NAME)

    places = supabase.table("places").select("id, name, category, description, tags, amenities").execute().data
    kb_entries = supabase.table("knowledge_base").select("id, title, category, content").execute().data

    embed_all(model, "places", places, place_text)
    embed_all(model, "knowledge_base", kb_entries, knowledge_base_text)


if __name__ == "__main__":
    main()
