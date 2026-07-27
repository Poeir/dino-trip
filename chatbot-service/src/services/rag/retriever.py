from sentence_transformers import SentenceTransformer
from src.core.config import EMBEDDING_MODEL_NAME
from src.core.db import supabase
from src.services.rag.synonyms import expand_query

# Replaces the old project's Chroma-query-then-Mongo-$in-fetch two-step --
# match_places()/match_knowledge_base() (backend/supabase/migrations) do the
# whole "embed -> nearest neighbours -> full row" job in one Postgres call.
print("[*] Loading embedding model (once)...")
_model = SentenceTransformer(EMBEDDING_MODEL_NAME)


def embed(text: str) -> list[float]:
    return _model.encode(text, normalize_embeddings=True).tolist()


class PlaceRetriever:
    def search_and_expand(self, query: str, limit: int = 5):
        """Hybrid search over `places`: pgvector cosine similarity plus
        pg_trgm keyword matching on name/tags, full rows already included.
        Vector search alone missed rows that genuinely answered a query but
        sat just outside the embedding model's notion of "close enough"
        (confirmed by testing on cuisine-specific queries)."""
        query = expand_query(query)
        vec = embed(query)
        res = supabase.rpc(
            "match_places_hybrid", {"query_embedding": vec, "query_text": query, "match_count": limit}
        ).execute()
        return res.data or []

    def search_knowledge_base(self, query: str, limit: int = 3):
        query = expand_query(query)
        vec = embed(query)
        res = supabase.rpc(
            "match_knowledge_base_hybrid", {"query_embedding": vec, "query_text": query, "match_count": limit}
        ).execute()
        return res.data or []
