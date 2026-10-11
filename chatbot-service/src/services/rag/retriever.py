import time
from functools import lru_cache

from sentence_transformers import SentenceTransformer
from src.core.config import EMBEDDING_MODEL_NAME
from src.core.db import supabase
from src.services.rag.synonyms import expand_query

# Replaces the old project's Chroma-query-then-Mongo-$in-fetch two-step --
# match_places()/match_knowledge_base() (backend/supabase/migrations) do the
# whole "embed -> nearest neighbours -> full row" job in one Postgres call.
print("[*] Loading embedding model (once)...")
_model = SentenceTransformer(EMBEDDING_MODEL_NAME)


@lru_cache(maxsize=256)
def _embed_cached(text: str) -> tuple[float, ...]:
    return tuple(_model.encode(text, normalize_embeddings=True).tolist())


def embed(text: str) -> list[float]:
    # A chat turn searches places, knowledge_base and events with the same
    # query: one encode instead of three (~340ms each, about a third of
    # retrieval time). A fresh list per call so callers can't mutate the cache.
    return list(_embed_cached(text))


# Columns the trip planner needs to build a Place -- explicit (not "*") so the
# 384-float `embedding` column isn't shipped for every row.
_RESTAURANT_COLUMNS = (
    "id,name,category,rating,review_count,price,price_level,address,district,hours,hours_periods,"
    "business_status,phone,website,maps_url,lat,lng,description,amenities,tags,img"
)
_RESTAURANT_CACHE_TTL_S = 300
_restaurant_cache: tuple[float, list] | None = None


class PlaceRetriever:
    def list_restaurants(self):
        """Every "ร้านอาหาร" row, not a ranked search. The trip planner's meal
        reserve needs to pick restaurants by opening hours and by distance
        to specific places -- things a semantic query ("ร้านอาหารแนะนำ")
        can't express, so a top-N of it can be all evening-only or all in the
        wrong district. A few hundred rows; cached briefly so each trip
        request doesn't re-read the table (the chatbot service also writes
        this table, hence a TTL rather than caching forever)."""
        global _restaurant_cache
        now = time.monotonic()
        if _restaurant_cache and now - _restaurant_cache[0] < _RESTAURANT_CACHE_TTL_S:
            return _restaurant_cache[1]
        res = supabase.table("places").select(_RESTAURANT_COLUMNS).eq("category", "ร้านอาหาร").limit(2000).execute()
        rows = res.data or []
        _restaurant_cache = (now, rows)
        return rows

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

    def search_events(self, query: str, limit: int = 3):
        """Same hybrid approach as search_and_expand(), over `events` --
        match_events_hybrid already excludes cancelled events and (via
        `embedding is not null`) expired ones, since embedder.py's
        expire_events() clears an expired event's embedding on reindex."""
        query = expand_query(query)
        vec = embed(query)
        res = supabase.rpc(
            "match_events_hybrid", {"query_embedding": vec, "query_text": query, "match_count": limit}
        ).execute()
        return res.data or []
