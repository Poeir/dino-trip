from typing import List, Optional

from supabase import create_client
from src.core.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

# Replaces the old project's MongoDB access layer (core/database.py) -- the
# `places`/`knowledge_base` tables in Postgres are the single source of truth
# now, populated by the Node scripts in backend/, not seeded from here.
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# What trip_planner.models.Place reads. Explicit (not "*") so the 384-float
# `embedding` column isn't shipped for every row -- same list as
# rag/retriever.py's _RESTAURANT_COLUMNS plus market_time.
_PLACE_COLUMNS = (
    "id,name,category,subcategory,rating,review_count,price,price_level,address,district,hours,hours_periods,"
    "business_status,phone,website,maps_url,lat,lng,description,amenities,tags,img,market_time"
)
MIN_NAME_QUERY_CHARS = 2
_NAME_MATCH_LIMIT = 50
# Characters that are wildcards to the database: % and _ in LIKE, \ as its
# escape, and * which PostgREST rewrites to %. Each becomes _ ("any one
# character"), so "100% Coffee" still finds that name while a lone "%" no
# longer matches every row; _pick_named_place then compares the real text.
_LIKE_WILDCARDS = str.maketrans({"%": "_", "*": "_", "\\": "_"})


def _pick_named_place(rows: List[dict], query: str) -> Optional[dict]:
    """The one row `query` names, or None. A name equal to the query
    (ignoring case and surrounding spaces) wins; a partial match only counts
    when it is the only one. Confirmed on live data: "วัด" used to resolve to
    whichever of ~45 temples the database returned first, which then went
    into the trip as a place the traveller "must" visit."""
    wanted = query.strip().casefold()
    containing = [r for r in rows if wanted in (r.get("name") or "").casefold()]
    exact = [r for r in containing if (r.get("name") or "").strip().casefold() == wanted]
    if exact:
        return exact[0]
    return containing[0] if len(containing) == 1 else None


def find_place_by_name(name_query: str):
    """Resolves an accommodation or must-go name typed by the user to a
    single published place (see _pick_named_place for what counts as a
    match). Hidden places (is_active = false) are never returned: they are
    out of the public list and must not come back through a trip."""
    query = (name_query or "").strip()
    if len(query) < MIN_NAME_QUERY_CHARS:
        return None
    res = (
        supabase.table("places").select(_PLACE_COLUMNS)
        .eq("is_active", True).ilike("name", f"%{query.translate(_LIKE_WILDCARDS)}%")
        .limit(_NAME_MATCH_LIMIT).execute()
    )
    return _pick_named_place(res.data or [], query)
