from sentence_transformers import SentenceTransformer
from src.core.config import EMBEDDING_MODEL_NAME
from src.core.db import supabase

# Replaces the old project's Chroma-query-then-Mongo-$in-fetch two-step --
# match_places()/match_knowledge_base() (backend/supabase/migrations) do the
# whole "embed -> nearest neighbours -> full row" job in one Postgres call.
print("[*] Loading embedding model (once)...")
_model = SentenceTransformer(EMBEDDING_MODEL_NAME)


def embed(text: str) -> list[float]:
    return _model.encode(text, normalize_embeddings=True).tolist()


class PlaceRetriever:
    def search_and_expand(self, query: str, limit: int = 5):
        """Semantic search over `places`, full rows already included."""
        vec = embed(query)
        res = supabase.rpc("match_places", {"query_embedding": vec, "match_count": limit}).execute()
        return res.data or []

    def search_knowledge_base(self, query: str, limit: int = 3):
        vec = embed(query)
        res = supabase.rpc("match_knowledge_base", {"query_embedding": vec, "match_count": limit}).execute()
        return res.data or []
