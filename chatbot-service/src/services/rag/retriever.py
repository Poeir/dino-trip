import itertools
import time
from functools import lru_cache

from sentence_transformers import SentenceTransformer
from supabase import create_client
from src.core.config import EMBEDDING_MODEL_NAME, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from src.core.db import supabase
from src.services.rag.synonyms import alias_variants, expand_query, strip_filler

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
_category_cache: dict[tuple, tuple[float, list]] = {}

# agent.py runs these three hybrid-search RPCs concurrently (ThreadPoolExecutor)
# to overlap their network time -- but doing that against the one shared
# `supabase` client (src.core.db) raised an intermittent httpx.ReadError
# ([WinError 10035], confirmed by a 10/20-trial stress test: ~1/15 calls
# failed) because httpx's connection pool isn't safe for concurrent requests
# from multiple threads on the same client. A dedicated client per call, each
# with its own connection, removed the race entirely (0/60 calls in the same
# stress test) -- created once here and reused for every chat turn, so there's
# no extra connection-setup cost over the shared client.
_places_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
_kb_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
_events_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


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
        # is_active: a hidden restaurant must not come back as a day's meal.
        res = (
            supabase.table("places").select(_RESTAURANT_COLUMNS)
            .eq("category", "ร้านอาหาร").eq("is_active", True).limit(2000).execute()
        )
        rows = res.data or []
        _restaurant_cache = (now, rows)
        return rows

    def list_by_categories(self, categories):
        """Every active row in `categories`, not a ranked search -- the trip
        planner's spare pool picks by rating and distance, which a semantic
        query can't express (same reason as list_restaurants). Cached the
        same way."""
        key = tuple(sorted(categories))
        now = time.monotonic()
        cached = _category_cache.get(key)
        if cached and now - cached[0] < _RESTAURANT_CACHE_TTL_S:
            return cached[1]

        def fetch(columns):
            return (
                supabase.table("places").select(columns)
                .in_("category", list(key)).eq("is_active", True).limit(2000).execute()
            ).data or []

        try:
            rows = fetch(_RESTAURANT_COLUMNS + ",market_time")
        except Exception as e:
            # places.market_time comes from a migration that is applied by
            # hand (see CLAUDE.md's migration note): until it is, trips must
            # keep working without the label rather than fail outright.
            print(f"[!] places.market_time not readable, listing without it: {e}")
            rows = fetch(_RESTAURANT_COLUMNS)
        _category_cache[key] = (now, rows)
        return rows

    def search_and_expand(self, query: str, limit: int = 5):
        """Hybrid search over `places`: pgvector cosine similarity plus
        pg_trgm keyword matching on name/tags, full rows already included.
        Vector search alone missed rows that genuinely answered a query but
        sat just outside the embedding model's notion of "close enough"
        (confirmed by testing on cuisine-specific queries).

        Also searches a second, filler-stripped variant of the query (see
        strip_filler) when stripping changes anything, and round-robin-merges
        the two result sets instead of concatenating them. A straight
        concatenation would let one variant's full quota of well-scored but
        wrong matches crowd out the other variant's correct ones --
        confirmed: "ร้านก๋วยเตี๋ยวแถวท่าพระ" alone returned 5 วัด and no
        ก๋วยเตี๋ยว at all, even though its stripped form "ก๋วยเตี๋ยวท่าพระ"
        returns the right shops. Round-robin guarantees the stripped variant's
        top pick still lands in the final top-`limit` either way."""
        variants = [expand_query(query)]
        stripped = strip_filler(query)
        if stripped:
            stripped = expand_query(stripped)
            if stripped not in variants:
                variants.append(stripped)
        for alias in alias_variants(query):
            if alias not in variants:
                variants.append(alias)

        result_lists = []
        for v in variants:
            vec = embed(v)
            res = _places_client.rpc(
                "match_places_hybrid", {"query_embedding": vec, "query_text": v, "match_count": limit}
            ).execute()
            result_lists.append(res.data or [])

        if len(result_lists) == 1:
            return result_lists[0]

        merged = []
        seen_ids = set()
        for row_group in itertools.zip_longest(*result_lists):
            for row in row_group:
                if row is None or row["id"] in seen_ids:
                    continue
                seen_ids.add(row["id"])
                merged.append(row)
                if len(merged) >= limit:
                    return merged
        return merged

    def search_knowledge_base(self, query: str, limit: int = 3):
        query = expand_query(query)
        vec = embed(query)
        res = _kb_client.rpc(
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
        res = _events_client.rpc(
            "match_events_hybrid", {"query_embedding": vec, "query_text": query, "match_count": limit}
        ).execute()
        return res.data or []
