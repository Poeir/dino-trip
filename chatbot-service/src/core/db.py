from supabase import create_client
from src.core.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

# Replaces the old project's MongoDB access layer (core/database.py) -- the
# `places`/`knowledge_base` tables in Postgres are the single source of truth
# now, populated by the Node scripts in backend/, not seeded from here.
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def find_place_by_name(name_query: str):
    """Case-insensitive partial match, e.g. for resolving an accommodation or
    a must-go place name typed by the user against the places table."""
    if not name_query:
        return None
    res = supabase.table("places").select("*").ilike("name", f"%{name_query}%").limit(1).execute()
    return res.data[0] if res.data else None
