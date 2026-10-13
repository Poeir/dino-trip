"""Embeds every `places`, `knowledge_base` and (non-expired) `events` row and
writes the vector into each table's `embedding` column, for pgvector
similarity search.

For a full, unconditional re-embed of every row (e.g. after changing
EMBEDDING_MODEL_NAME, or place_text()/knowledge_base_text() themselves) --
day-to-day, new/edited rows are picked up incrementally by the admin
dashboard's "reindex" button instead (see src/api/routes_admin.py,
src/services/rag/embedder.py), no need to run this manually for those.

Run:
    cd chatbot-service && python scripts/embed_content.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.services.rag import embedder


def main():
    expired = embedder.expire_events()
    print(f"Cleared embeddings for {expired} expired events.")

    places = embedder.all_places()
    kb_entries = embedder.all_knowledge_base()
    events = embedder.all_events()

    print(f"Embedding {len(places)} rows in places...")
    embedder.embed_rows("places", places, embedder.place_text)
    print("Done embedding places.")

    print(f"Embedding {len(kb_entries)} rows in knowledge_base...")
    embedder.embed_rows("knowledge_base", kb_entries, embedder.knowledge_base_text)
    print("Done embedding knowledge_base.")

    print(f"Embedding {len(events)} rows in events...")
    embedder.embed_rows("events", events, embedder.event_text)
    print("Done embedding events.")


if __name__ == "__main__":
    main()
