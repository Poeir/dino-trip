"""Computes and stores the pgvector embeddings for `places`, `knowledge_base`
and `events` rows. Shared by the manual full-reindex CLI
(scripts/embed_content.py) and the on-demand admin endpoint
(src/api/routes_admin.py) so the "what text gets embedded" logic never
drifts between the two.

A row is "pending" when its `embedding` column is NULL -- the Node backend
(backend/src/lib/crudRouter.js, via `invalidateColumns: ['embedding']` on
the places/knowledge_base/events routers) nulls it out on every create/edit,
so pending == "needs (re)computing", not "was never computed".

Events are additionally date-bounded: one whose date range has already
passed is never "pending" (no point embedding a festival that's over), and
`expire_events()` clears the embedding of any that already have one, so a
finished event drops out of chatbot search on the next reindex instead of
lingering until an admin notices and deletes it.
"""
import logging
import threading
from datetime import date, datetime, timezone

from sentence_transformers import SentenceTransformer

from src.core.config import EMBEDDING_MODEL_NAME
from src.core.db import supabase

logger = logging.getLogger(__name__)

_model = None
_model_lock = threading.Lock()


def get_model() -> SentenceTransformer:
    """Loads the model once and keeps it in memory -- loading it fresh on
    every button press would make even a 1-row reindex take several seconds."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                logger.info("Loading embedding model (%s)...", EMBEDDING_MODEL_NAME)
                _model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _model


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


def event_text(e: dict) -> str:
    parts = [e.get("name"), e.get("category"), e.get("venue_name"), *(e.get("suitable_for") or []), e.get("description")]
    return " - ".join(x for x in parts if x)


PLACE_SELECT = "id, name, category, description, tags, amenities"
KB_SELECT = "id, title, category, content"
EVENT_SELECT = "id, name, category, venue_name, organizer, suitable_for, description, event_start_date, event_end_date"


def pending_places():
    return supabase.table("places").select(PLACE_SELECT).is_("embedding", "null").execute().data


def pending_knowledge_base():
    return supabase.table("knowledge_base").select(KB_SELECT).is_("embedding", "null").execute().data


def all_places():
    return supabase.table("places").select(PLACE_SELECT).execute().data


def all_knowledge_base():
    return supabase.table("knowledge_base").select(KB_SELECT).execute().data


def _event_is_expired(e: dict, today: str) -> bool:
    """An event with neither date set (legacy free-text-only rows, or one an
    admin never filled in) is never considered expired -- there's nothing to
    compare, so it stays embeddable/embedded until someone sets a status of
    'cancelled' or deletes it outright."""
    end = e.get("event_end_date") or e.get("event_start_date")
    return bool(end) and end < today


def pending_events():
    today = date.today().isoformat()
    rows = supabase.table("events").select(EVENT_SELECT).is_("embedding", "null").execute().data
    return [e for e in rows if not _event_is_expired(e, today)]


def all_events():
    today = date.today().isoformat()
    rows = supabase.table("events").select(EVENT_SELECT).execute().data
    return [e for e in rows if not _event_is_expired(e, today)]


def expire_events() -> int:
    """Clears the embedding of every already-embedded event whose date range
    is in the past. Returns how many were cleared."""
    today = date.today().isoformat()
    rows = supabase.table("events").select("id, event_start_date, event_end_date").not_.is_("embedding", "null").execute().data
    expired_ids = [e["id"] for e in rows if _event_is_expired(e, today)]
    for event_id in expired_ids:
        supabase.table("events").update({"embedding": None}).eq("id", event_id).execute()
    return len(expired_ids)


def get_pending_counts() -> dict:
    places = supabase.table("places").select("id", count="exact").is_("embedding", "null").execute()
    kb = supabase.table("knowledge_base").select("id", count="exact").is_("embedding", "null").execute()
    return {"places": places.count or 0, "knowledgeBase": kb.count or 0, "events": len(pending_events())}


def embed_rows(table: str, rows: list[dict], text_fn) -> int:
    """Encodes and writes `rows` back to `table`. Returns how many succeeded."""
    if not rows:
        return 0
    model = get_model()
    done = 0
    for row in rows:
        text = text_fn(row)
        if not text:
            logger.warning("  Skipping %s id=%s: nothing to embed", table, row["id"])
            continue
        vector = model.encode(text, normalize_embeddings=True).tolist()
        res = supabase.table(table).update({"embedding": vector}).eq("id", row["id"]).execute()
        if res.data:
            done += 1
        else:
            logger.warning("  Warning: no row updated for %s id=%s", table, row["id"])
    return done


# --- Background job state, for the admin dashboard's "run embedding" button.
# A single in-process lock/status is enough here: this is an internal admin
# tool with one FastAPI worker, not a multi-worker production job queue.
_job_lock = threading.Lock()
_status = {
    "state": "idle",  # idle | running | done | error
    "startedAt": None,
    "finishedAt": None,
    "embeddedCount": 0,
    "expiredCount": 0,
    "error": None,
}


def get_status() -> dict:
    return {**_status, "pending": get_pending_counts()}


def start_reindex(only_pending: bool = True) -> bool:
    """Kicks off a reindex run on a background thread. Returns False (and
    starts nothing) if a run is already in progress -- the caller should
    treat that as "already running", not an error."""
    if not _job_lock.acquire(blocking=False):
        return False
    thread = threading.Thread(target=_run_reindex, args=(only_pending,), daemon=True)
    thread.start()
    return True


def _run_reindex(only_pending: bool):
    _status.update(state="running", startedAt=datetime.now(timezone.utc).isoformat(), finishedAt=None, embeddedCount=0, expiredCount=0, error=None)
    try:
        expired = expire_events()
        places = pending_places() if only_pending else all_places()
        kb = pending_knowledge_base() if only_pending else all_knowledge_base()
        events = pending_events() if only_pending else all_events()
        logger.info("Reindex: embedding %d places, %d knowledge_base rows, %d events (expired %d)...", len(places), len(kb), len(events), expired)
        count = embed_rows("places", places, place_text) + embed_rows("knowledge_base", kb, knowledge_base_text) + embed_rows("events", events, event_text)
        _status.update(state="done", embeddedCount=count, expiredCount=expired)
    except Exception as e:
        logger.exception("Reindex failed")
        _status.update(state="error", error=str(e))
    finally:
        _status.update(finishedAt=datetime.now(timezone.utc).isoformat())
        _job_lock.release()
