import itertools
import threading
import time
from functools import lru_cache

from concurrent.futures import ThreadPoolExecutor

from supabase import create_client
from src.core.config import EMBEDDING_QUERY_PREFIX, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from src.core.db import supabase
from src.services.rag.embedder import encode_lock, get_model
from src.services.rag.area import (
    area_candidates, google_area_name, is_specific, rank_in_area, resolve_area, split_area_query,
    split_bare_area_query, wanted_categories,
)
from src.services.rag.synonyms import alias_variants, expand_query, intent_amenities, intent_categories, strip_filler
from src.services.rag import google_fallback
from src.services.rag.hours import is_open_at, requested_time, strip_time_words
from src.core.clock import now_bangkok


_EVENT_COLUMNS = (
    "id,name,category,venue_name,date_range,admission,suitable_for,description,img,status,"
    "event_start_date,event_end_date"
)
GENERIC_EVENT_LIMIT = 5
_EVENT_WORDS = ("งาน", "อีเวนท์", "อีเว้นท์", "อีเวนต์", "event", "กิจกรรม", "เทศกาล")
# Everything a "what's on" question says besides asking: if nothing is left
# once these are out, it names no kind of event, so list what is coming up.
_GENERIC_EVENT_WORDS = sorted(
    ("ช่วงนี้", "ตอนนี้", "เดือนนี้", "สัปดาห์นี้", "อาทิตย์นี้", "เสาร์อาทิตย์นี้", "วีคเอนด์นี้", "เร็วๆนี้", "เร็วๆ นี้",
     "ใกล้ๆนี้", "เร็ว ๆ นี้", "มี", "อะไร", "น่าไป", "น่าสนใจ", "เด็ด", "บ้าง", "ไหม", "มั้ย", "ที่", "ใน", "จังหวัด",
     "ขอนแก่น", "แนะนำ", "หน่อย", "ครับ", "ค่ะ", "คะ", "ดีๆ", "ดี", "จัด", "เกิดขึ้น", "กำลัง", "จะ", "ไป", "เที่ยว",
     "events", *_EVENT_WORDS),
    key=len, reverse=True,
)


def is_generic_event_query(query: str) -> bool:
    lowered = query.lower()
    if not any(w in lowered for w in _EVENT_WORDS):
        return False
    for w in _GENERIC_EVENT_WORDS:
        lowered = lowered.replace(w, " ")
    return not "".join(c for c in lowered if c.isalnum())


def _with_open_note(places: list[dict], asked) -> list[dict]:
    """Tells the model the time check was done, so it doesn't redo it from
    the hours text (copies: the rows may be the cached directory's)."""
    if not asked:
        return places
    return [{**p, "open_note": f"เปิดอยู่{asked[1]} (ระบบตรวจจากเวลาเปิด-ปิดแล้ว)"} for p in places]


# Replaces the old project's Chroma-query-then-Mongo-$in-fetch two-step --
# match_places()/match_knowledge_base() (backend/supabase/migrations) do the
# whole "embed -> nearest neighbours -> full row" job in one Postgres call.
print("[*] Loading embedding model (once)...")
# The same instance the reindex job uses (embedder.get_model), not a second copy.
_model = get_model()


@lru_cache(maxsize=256)
def _embed_cached(text: str) -> tuple[float, ...]:
    return tuple(_model.encode(EMBEDDING_QUERY_PREFIX + text, normalize_embeddings=True).tolist())


_embed_lock = encode_lock


def embed(text: str) -> list[float]:
    # A chat turn searches places, knowledge_base and events with the same
    # query, from three threads at once. lru_cache alone doesn't dedupe
    # concurrent misses: all three encoded the same text in parallel (measured
    # 180 encodes for 60 turns, ~600ms per turn instead of ~130ms). Under the
    # lock the first caller encodes and the others then hit the cache. A fresh
    # list per call so callers can't mutate the cache.
    with _embed_lock:
        return list(_embed_cached(text))


# Columns the trip planner needs to build a Place -- explicit (not "*") so the
# 384-float `embedding` column isn't shipped for every row.
_RESTAURANT_COLUMNS = (
    "id,name,category,subcategory,rating,review_count,price,price_level,address,district,hours,hours_periods,"
    "business_status,phone,website,maps_url,lat,lng,description,amenities,tags,img"
)
_RESTAURANT_CACHE_TTL_S = 300
_restaurant_cache: tuple[float, list] | None = None
_category_cache: dict[tuple, tuple[float, list]] = {}
_DIRECTORY_KEY = ("__all_active__",)
# How many results the plain search hands search_chat_places to filter by
# area/category: a few dozen, so a match ranked below the province-wide top
# few still counts, without shipping hundreds of rows per question.
_AREA_SEARCH_POOL = 30

# The hybrid-search RPCs run concurrently to overlap their network time -- but
# doing that against the one shared `supabase` client (src.core.db) raised an
# intermittent httpx.ReadError ([WinError 10035], confirmed by a 10/20-trial
# stress test: ~1/15 calls failed) because httpx's connection pool isn't safe
# for concurrent requests from multiple threads on the same client.
#
# So every RPC runs on a long-lived worker thread of _rpc_pool, and each worker
# keeps its own client (and connection) in thread-local storage: a client is
# only ever used by one thread at a time, whichever chat turns are in flight
# (the earlier one-client-per-search-type setup was still shared between two
# turns searching at once). Workers only ever run this leaf call and never wait
# on each other, so callers blocking on them can't deadlock.
_rpc_pool = ThreadPoolExecutor(max_workers=12, thread_name_prefix="rag-rpc")
_worker = threading.local()


def _run_rpc(name: str, params: dict) -> list:
    client = getattr(_worker, "client", None)
    if client is None:
        client = _worker.client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return client.rpc(name, params).execute().data or []


def rpc(name: str, params: dict) -> list:
    return _rpc_pool.submit(_run_rpc, name, params).result()


def rpc_many(calls: list[tuple[str, dict]]) -> list[list]:
    """The same RPCs as rpc(), all in flight at once; results in call order."""
    futures = [_rpc_pool.submit(_run_rpc, name, params) for name, params in calls]
    return [f.result() for f in futures]


# match_places_ranked (migration 20261021000002) returns rows without the
# heavy columns, ties broken by popularity. Until that migration is applied
# to a database, fall back to match_places_hybrid and drop the same columns
# here, so callers see one row shape either way.
_HEAVY_PLACE_COLUMNS = ("raw_data", "embedding", "reviews", "images")
_ranked_search_available = True


def _top_up_from_google(found: list[dict], what: str, area: dict | None, where: str, limit: int, directory: list[dict], on_status=None) -> list[dict]:
    """`found` with Google places added when fewer than `limit` of them are in
    the area proper (area_tier 0): ours in the area first, then Google's, then
    ours from the wider ring. A landmark area is left alone -- Google's
    addresses don't name landmarks, so "is it in the area" can't be checked."""
    if not google_fallback.enabled() or (area and area["kind"] == "landmark"):
        return found
    name = area["name"] if area else google_area_name(where)
    if not name:
        return found
    inside = [p for p in found if p.get("area_tier", 0) == 0]
    if len(inside) >= limit:
        return found
    known = {(p.get("name") or "").strip().lower() for p in directory or []}
    if on_status:
        on_status(google_fallback.STATUS_TEXT)
    extra = google_fallback.top_up(what, name, limit - len(inside), known)
    if not extra:
        return found
    outside = [p for p in found if p.get("area_tier", 0) != 0]
    return (inside + extra + outside)[:limit]


def _is_missing_function(err: Exception) -> bool:
    text = str(err)
    return "match_places_ranked" in text and ("PGRST202" in text or "Could not find the function" in text)


def _match_places(queries: list[tuple[list[float], str]], limit: int) -> list[list]:
    """One search per (embedding, text) pair, all in flight at once."""
    global _ranked_search_available
    if _ranked_search_available:
        try:
            return rpc_many([
                ("match_places_ranked", {"query_embedding": vec, "query_text": text, "match_count": limit})
                for vec, text in queries
            ])
        except Exception as e:
            if not _is_missing_function(e):
                raise
            print("[!] match_places_ranked not found, using match_places_hybrid (apply migration 20261021000002)")
            _ranked_search_available = False
    results = rpc_many([
        ("match_places_hybrid", {"query_embedding": vec, "query_text": text, "match_count": limit})
        for vec, text in queries
    ])
    return [[{k: v for k, v in row.items() if k not in _HEAVY_PLACE_COLUMNS} for row in rows] for rows in results]


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

        # Encoding is serialized by the lock anyway; the network round trips
        # (the slow part) are what run side by side.
        result_lists = _match_places([(embed(v), v) for v in variants], limit)

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

    def _directory(self):
        """Every active place with what the chat prompt and area.py need --
        not the embedding. ~600 rows, cached like list_by_categories."""
        now = time.monotonic()
        cached = _category_cache.get(_DIRECTORY_KEY)
        if cached and now - cached[0] < _RESTAURANT_CACHE_TTL_S:
            return cached[1]
        rows = (
            supabase.table("places").select(_RESTAURANT_COLUMNS + ",subdistrict")
            .eq("is_active", True).limit(5000).execute()
        ).data or []
        _category_cache[_DIRECTORY_KEY] = (now, rows)
        return rows

    def search_chat_places(self, query: str, limit: int = 3, on_status=None):
        """The chatbot's place search: search_and_expand, plus two things a
        name/tag/embedding match can't do (the trip planner, which searches
        by interest tags, keeps calling search_and_expand directly):

        - "แถว X" (area.py): when X is a ตำบล/อำเภอ or a place in the
          table, only places in or around it are returned, each with an
          `area_note` saying how it relates to X.
        - A situation that implies a kind of place ("ฝนตก" -> indoor,
          "ของฝาก" -> souvenir shops; synonyms.INTENT_CATEGORIES): results
          are kept to those categories, topped up with the most-reviewed
          places in them when the search found fewer than `limit`.

        A database failure in either step falls back to the plain search."""
        try:
            directory = None
            area = None
            split = marked = split_area_query(query)
            if split:
                directory = self._directory()
                area = resolve_area(split[1], directory)
            if not area:
                # No marker, or one that names nothing: "ใกล้เคียง" in
                # "พักอยู่ที่ท่าพระ แนะนำที่เที่ยวใกล้เคียง" reads as "ใกล้ เคียง",
                # which hid the ท่าพระ the question does name.
                directory = directory or self._directory()
                split = split_bare_area_query(query, directory)
                area = resolve_area(split[1], directory) if split else None
            # Needs only a place's data answers: an amenity ("มังสวิรัติ") or
            # being open at a time ("ตีหนึ่ง", "เปิดดึก"; hours.py). Only places
            # that meet them, around the area if one is named, else the best.
            needs = intent_amenities(query)
            asked = requested_time(query, now_bangkok())
            by_id = {p["id"]: p for p in directory}

            def meets(p):
                row = by_id.get(p["id"], p)
                if not all(n in (row.get("amenities") or []) for n in needs):
                    return False
                return asked is None or is_open_at(row.get("hours_periods"), asked[0]) is True

            if area:
                what = split[0]
                if asked:
                    what = strip_time_words(what)
                pool = [p for p in directory if meets(p)] if needs or asked else directory
                candidates = area_candidates(area, pool, limit)
                ranked = None
                if is_specific(what):
                    ranked = [p["id"] for p in self.search_and_expand(query, limit=_AREA_SEARCH_POOL)]
                found = _with_open_note(rank_in_area(candidates, what, ranked, limit), asked)
                # Google can't vouch for an amenity or an asked-for time, so only plain asks.
                if needs or asked:
                    return found
                return _top_up_from_google(found, what, area, split[1], limit, directory, on_status)

            # "แถว X" where X is in none of our places (a whole อำเภอ we have no
            # data for): Google's places in X beat unrelated ones from the plain search.
            if marked and not (needs or asked):
                from_google = _top_up_from_google([], marked[0], None, marked[1], limit, directory, on_status)
                if from_google:
                    return from_google

            if needs or asked:
                cats = wanted_categories(query)
                def fits(p):
                    return meets(p) and (not cats or p.get("category") in cats)
                found = [p for p in self.search_and_expand(query, limit=_AREA_SEARCH_POOL) if fits(p)]
                popular = sorted((p for p in directory if fits(p)), key=lambda p: p.get("review_count") or 0, reverse=True)
                seen, out = set(), []
                for p in found + popular:
                    if p["id"] not in seen:
                        seen.add(p["id"])
                        out.append(p)
                return _with_open_note(out[:limit], asked)

            cats = intent_categories(query)
            if cats:
                found = [p for p in self.search_and_expand(query, limit=_AREA_SEARCH_POOL) if p.get("category") in cats]
                popular = sorted(self.list_by_categories(cats), key=lambda p: p.get("review_count") or 0, reverse=True)
                seen, out = set(), []
                for p in found + popular:
                    if p["id"] not in seen:
                        seen.add(p["id"])
                        out.append(p)
                return out[:limit]
        except Exception as e:
            print(f"[!] area/intent place search failed, using the plain search: {e}")
        return self.search_and_expand(query, limit=limit)

    def search_knowledge_base(self, query: str, limit: int = 3):
        query = expand_query(query)
        vec = embed(query)
        return rpc("match_knowledge_base_hybrid", {"query_embedding": vec, "query_text": query, "match_count": limit})

    def search_events(self, query: str, limit: int = 3):
        """Same hybrid approach as search_and_expand(), over `events` --
        match_events_hybrid already excludes cancelled events and (via
        `embedding is not null`) expired ones, since embedder.py's
        expire_events() clears an expired event's embedding on reindex."""
        if is_generic_event_query(query):
            try:
                return self.upcoming_events(GENERIC_EVENT_LIMIT)
            except Exception as e:
                print(f"[!] upcoming events listing failed, using the search: {e}")
        query = expand_query(query)
        vec = embed(query)
        return rpc("match_events_hybrid", {"query_embedding": vec, "query_text": query, "match_count": limit})

    def upcoming_events(self, limit: int):
        """Events on now or still to come, soonest first -- what "ช่วงนี้มีงาน
        อะไร" asks for. A search on those words found 1 of the 7 live events,
        and not the one running that week."""
        today = now_bangkok().date().isoformat()
        rows = (
            supabase.table("events").select(_EVENT_COLUMNS).neq("status", "cancelled").execute()
        ).data or []
        live = [e for e in rows if (e.get("event_end_date") or e.get("event_start_date") or "") >= today]
        return sorted(live, key=lambda e: e.get("event_start_date") or "9999")[:limit]
