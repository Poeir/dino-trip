"""Live Google Places results for a thin "แถว X" chat answer.

retriever.search_chat_places calls top_up() when the DB has fewer than `limit`
places in the asked area (or doesn't know the area at all). The Google places
come back in the same row shape the chat prompt reads, tagged `source: "google"`
and described as unverified, so the answer can say so and the chat card can
link to Google Maps instead of a place page we don't have.

Cost guards: no key or a cap of 0 = off; one paid search per (query) per
CACHE_TTL_S; at most GOOGLE_FALLBACK_DAILY_CAP searches a day (atomic, in the DB
via claim_google_fallback_call, in memory if that migration isn't applied);
a slow or failed Google call returns [] and the chat answers from the DB alone.

Every place shown is recorded (record_place_candidates, in the background) so
admins can import the ones users keep asking about.
"""
import datetime
import logging
import math
import threading
import time

import httpx

from src.core.clock import BANGKOK_TZ, now_bangkok
from src.core.config import GOOGLE_FALLBACK_DAILY_CAP, GOOGLE_FALLBACK_TIMEOUT_S, GOOGLE_PLACES_API_KEY

logger = logging.getLogger(__name__)

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
# Hours, open-now, price, summary, reviews, phone, site, Maps link: Text Search
# Enterprise + Atmosphere SKU (~$40/1000, vs ~$32 for name/address/rating only).
# Tried both live: the bare one gave answers of a name and a rating, this one
# answers like a DB place for ~฿0.3 more.
FIELD_MASK = ",".join([
    "places.id", "places.displayName", "places.formattedAddress", "places.types",
    "places.primaryTypeDisplayName", "places.businessStatus", "places.rating", "places.userRatingCount",
    "places.googleMapsUri", "places.regularOpeningHours.weekdayDescriptions", "places.currentOpeningHours",
    "places.priceRange", "places.editorialSummary", "places.reviews", "places.nationalPhoneNumber", "places.websiteUri",
])
KHON_KAEN = {"latitude": 16.4322, "longitude": 102.8236}

MIN_RATING = 4.0
MIN_REVIEWS = 10
MAX_REVIEWS_IN_CONTEXT = 4
CACHE_TTL_S = 3600
# Kinds of place the chatbot recommends. A whitelist: the first blacklist let a
# building contractor and a planned flyover through in testing.
WANTED_TYPES = {
    "restaurant", "cafe", "coffee_shop", "bakery", "tea_house", "tourist_attraction", "park", "museum",
    "buddhist_temple", "place_of_worship", "market", "shopping_mall", "zoo", "national_park", "hiking_area",
    "art_gallery", "botanical_garden", "water_park", "amusement_park", "historical_landmark", "cultural_landmark",
}
# Chains and petrol-station branches: findable anywhere, not worth recommending.
CHAIN_WORDS = ("Café Amazon", "คาเฟ่ อเมซอน", "7-Eleven", "เซเว่น", "พันธุ์ไทย", "Pun Thai", "อินทนิล", "Inthanin", "KFC", "ปตท", "PTT")
UNVERIFIED_TAG = "ข้อมูลจาก Google ยังไม่ผ่านการตรวจสอบของทีมงาน"
# Shown in the chat while this search runs (agent.py streams it as a status).
STATUS_TEXT = "กำลังค้นเพิ่มจาก Google..."

_cache: dict[str, tuple[float, list[dict]]] = {}
_cache_lock = threading.Lock()
_mem_usage = {"day": None, "calls": 0}
_usage_lock = threading.Lock()


def enabled() -> bool:
    return bool(GOOGLE_PLACES_API_KEY) and GOOGLE_FALLBACK_DAILY_CAP > 0


def _rpc(name: str, params: dict):
    # Lazy: retriever imports this module.
    from src.services.rag.retriever import rpc
    return rpc(name, params)


def _claim_call() -> bool:
    """One paid search, if today's count is under the cap."""
    try:
        return bool(_rpc("claim_google_fallback_call", {"p_cap": GOOGLE_FALLBACK_DAILY_CAP}))
    except Exception as e:
        # Migration 20261022000001 not applied (or DB hiccup): count in memory.
        logger.warning("google fallback: usage counter RPC failed, counting in memory: %s", e)
    today = now_bangkok().date()
    with _usage_lock:
        if _mem_usage["day"] != today:
            _mem_usage.update(day=today, calls=0)
        if _mem_usage["calls"] >= GOOGLE_FALLBACK_DAILY_CAP:
            return False
        _mem_usage["calls"] += 1
        return True


def wanted(types: list[str]) -> bool:
    return any(t in WANTED_TYPES or t.endswith("_restaurant") for t in types)


def _compact(text: str) -> str:
    return "".join(text.split())


def in_area(address: str, where: str) -> bool:
    """The address names the asked area: drops a city cafe for "แถวพระยืน" and a
    temple on ถนนศรีจันทร์ for "แถวท่าพระ" (both seen live). Google writes
    "อำเภอ พระยืน" with a space, so spaces are ignored on both sides."""
    return _compact(where) in _compact(address)


def keep(g: dict, where: str, known_names: set[str]) -> bool:
    address = g.get("formattedAddress") or ""
    name = (g.get("displayName") or {}).get("text") or ""
    return (
        bool(name)
        and ("ขอนแก่น" in address or "Khon Kaen" in address)
        and in_area(address, where)
        and g.get("businessStatus") in (None, "OPERATIONAL")
        and wanted(g.get("types") or [])
        and (g.get("rating") or 0) >= MIN_RATING
        and (g.get("userRatingCount") or 0) >= MIN_REVIEWS
        and name.strip().lower() not in known_names
        and not any(c.lower() in name.lower() for c in CHAIN_WORDS)
    )


def score(g: dict) -> float:
    """Rating weighted by how many reviews back it: ⭐4.8 from 100 beats ⭐5.0 from 3."""
    return (g.get("rating") or 0) * math.log10((g.get("userRatingCount") or 0) + 1)


def _clock(dt: datetime.datetime) -> str:
    return f"{dt.hour}:{dt.minute:02d} น."


def open_note(g: dict, now: datetime.datetime) -> str | None:
    """Open-now, worked out here rather than by the LLM (it miscounted "minutes
    until closing" in testing). Google gives openNow and the next change."""
    current = g.get("currentOpeningHours") or {}
    if "openNow" not in current:
        return None

    def parse(key):
        raw = current.get(key)
        if not raw:
            return None
        try:
            return datetime.datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(BANGKOK_TZ)
        except ValueError:
            return None

    if current["openNow"]:
        closes = parse("nextCloseTime")
        return "ตอนนี้เปิดอยู่ (ตาม Google)" + (f" ปิด {_clock(closes)}" if closes and closes.date() == now.date() else "")
    opens = parse("nextOpenTime")
    if not opens:
        return "ตอนนี้ปิดอยู่ (ตาม Google)"
    when = "วันนี้" if opens.date() == now.date() else "พรุ่งนี้" if opens.date() == now.date() + datetime.timedelta(days=1) else opens.strftime("%d/%m")
    return f"ตอนนี้ปิดอยู่ (ตาม Google) เปิดอีกครั้ง{when} {_clock(opens)}"


def to_row(g: dict, where: str, now: datetime.datetime) -> dict:
    """A Google place in the row shape the chat prompt and cards read."""
    price = g.get("priceRange") or {}
    lo = (price.get("startPrice") or {}).get("units")
    hi = (price.get("endPrice") or {}).get("units")
    reviews = [
        " ".join(((r.get("text") or {}).get("text") or "").split())[:250]
        for r in (g.get("reviews") or [])[:MAX_REVIEWS_IN_CONTEXT]
    ]
    summary = (g.get("editorialSummary") or {}).get("text")
    details = [f"({UNVERIFIED_TAG}, {g.get('userRatingCount')} รีวิว)", summary]
    if reviews:
        details.append("รีวิวล่าสุด: " + " | ".join(r for r in reviews if r))
    return {
        "id": "google:" + g["id"],
        "google_place_id": g["id"],
        # Not "source": imported places carry source="google" in the DB too.
        "live_google": True,
        "name": g["displayName"]["text"],
        "category": (g.get("primaryTypeDisplayName") or {}).get("text"),
        "tags": [t for t in ((g.get("primaryTypeDisplayName") or {}).get("text"), UNVERIFIED_TAG) if t],
        "rating": g.get("rating"),
        "review_count": g.get("userRatingCount"),
        "address": g.get("formattedAddress"),
        "hours": "; ".join((g.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []) or None,
        "price": f"฿{lo}-{hi} ต่อคน" if lo and hi else None,
        "description": " ".join(d for d in details if d),
        "phone": g.get("nationalPhoneNumber"),
        "website": g.get("websiteUri"),
        "maps_url": g.get("googleMapsUri"),
        "img": None,
        "area_note": f"ผลค้นจาก Google บริเวณ{where} (ยังไม่ได้ตรวจสอบ)",
        "now_note": open_note(g, now),
    }


def _search(text: str) -> list[dict]:
    res = httpx.post(
        SEARCH_URL,
        json={"textQuery": text, "languageCode": "th", "regionCode": "TH", "pageSize": 10,
              "locationBias": {"circle": {"center": KHON_KAEN, "radius": 50000}}},
        headers={"X-Goog-Api-Key": GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": FIELD_MASK},
        timeout=GOOGLE_FALLBACK_TIMEOUT_S,
    )
    res.raise_for_status()
    return res.json().get("places") or []


def search(what: str, where: str) -> list[dict]:
    """Raw Google places for "<what> แถว<where> ขอนแก่น", cached for an hour.
    [] when off, over the daily cap, or Google fails/is slow."""
    if not enabled():
        return []
    text = f"{what.strip()} แถว{where.strip()} ขอนแก่น".strip()
    with _cache_lock:
        hit = _cache.get(text)
        if hit and hit[0] > time.monotonic():
            return hit[1]
    if not _claim_call():
        logger.info("google fallback: daily cap %d reached, skipping", GOOGLE_FALLBACK_DAILY_CAP)
        return []
    t0 = time.monotonic()
    try:
        places = _search(text)
    except Exception as e:
        logger.warning("google fallback: search failed for %r: %s", text, e)
        return []
    logger.info("google fallback: %r -> %d places in %.0f ms", text, len(places), (time.monotonic() - t0) * 1000)
    with _cache_lock:
        for key in [k for k, (exp, _) in _cache.items() if exp <= time.monotonic()]:
            del _cache[key]
        _cache[text] = (time.monotonic() + CACHE_TTL_S, places)
    return places


def record_candidates(rows: list[dict], where: str) -> None:
    """Remember the Google places shown, for the admin "places users asked for"
    queue. Background thread: the user never waits on it, and a failure only
    costs a missed count."""
    items = [
        {k: r.get(k) for k in ("google_place_id", "name", "address", "category", "rating", "review_count", "maps_url")}
        for r in rows
    ]
    if not items:
        return

    def run():
        try:
            _rpc("record_place_candidates", {"p_items": items, "p_area": where})
        except Exception as e:
            logger.warning("google fallback: recording candidates failed: %s", e)

    threading.Thread(target=run, daemon=True, name="record-candidates").start()


def top_up(what: str, where: str, need: int, known_names: set[str]) -> list[dict]:
    """Up to `need` good Google places in `where`, best first, as chat rows."""
    if need <= 0:
        return []
    raw = search(what, where)
    picked = sorted((g for g in raw if keep(g, where, known_names)), key=score, reverse=True)[:need]
    now = now_bangkok()
    rows = [to_row(g, where, now) for g in picked]
    record_candidates(rows, where)
    return rows
