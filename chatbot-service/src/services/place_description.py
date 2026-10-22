"""Grounded Thai description for a place: Google Maps reviews + Google Search
snippets (serper.dev) summarized by the LLM, with a deterministic template as
the last resort.

Shared by `scripts/generate_descriptions.py` (batch over the whole `places`
table) and `POST /admin/places/describe` (one place, from the admin form), so
both produce the same text from the same prompt.

Sources, in priority order:
  1. Existing Google Maps reviews (places.reviews -- capped at 5/place by
     Google itself, not by us).
  2. Google Search snippets via serper.dev -- independent write-ups/news/blog
     mentions beyond the review cap. (Google's own Custom Search JSON API is
     closed to new customers as of this writing -- existing customers only,
     until 2027-01-01 -- so serper.dev, a paid proxy in front of real Google
     Search results, stands in for it.) One plain query per place
     (name + district/ขอนแก่น, for disambiguation against same-named places
     elsewhere in Thailand) -- an earlier version biased landmark-category
     places to a Wikipedia/TAT-only query first, but that returned
     noticeably thinner results than a plain search, so it was dropped.
  3. If neither is available: a deterministic tags/amenities/category
     template (no LLM call) -- still specific to that place, not the old
     generic rating-only line.

Deliberately NOT scraping Wongnai/Facebook/TripAdvisor directly (ToS risk);
search snippets from those sites are normal search-engine indexing, not us
fetching their pages ourselves.
"""
import logging
import re
from typing import Dict, List, Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from src.core.config import LLM_PROVIDER, MODEL_NAME, SERPER_API_KEY
from src.core.llm_client import complete_json

logger = logging.getLogger(__name__)

SERPER_ENDPOINT = "https://google.serper.dev/search"

# Sites we read via their Google Search snippet only, never fetch directly.
# Two different reasons land a domain here, both handled the same way:
#   - ToS prohibits scraping (same reasoning as not scraping Wongnai/Facebook
#     directly discussed earlier: a search engine showing a snippet is normal
#     indexing, us fetching the page ourselves is not)
#   - JS-rendered pages where a plain HTTP GET only sees empty page chrome,
#     not real content -- confirmed on youtube.com in testing: the "fetched"
#     text was just nav/footer boilerplate ("เกี่ยวกับ สื่อ ลิขสิทธิ์..."),
#     worse than using the snippet since it dilutes the prompt with noise.
BLOCKED_FETCH_DOMAINS = {
    "facebook.com", "www.facebook.com", "m.facebook.com",  # ToS
    "instagram.com", "www.instagram.com",  # ToS
    "tiktok.com", "www.tiktok.com",  # ToS
    "twitter.com", "x.com",  # ToS
    "wongnai.com", "www.wongnai.com",  # ToS
    "youtube.com", "www.youtube.com", "m.youtube.com",  # JS-rendered
    "google.com", "www.google.com",  # JS-rendered (Maps place pages etc.)
}

FETCH_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; description-enrichment-bot/1.0)"}

# Matches the backend's mapDesc() fallback ("{category}ในขอนแก่น
# คะแนนรีวิว X ดาว..." / "...ยังไม่มีคะแนนรีวิว") -- i.e. a place nobody has
# written a real description for yet. The batch script uses it to skip
# already-processed places on a resumed run.
ORIGINAL_TEMPLATE_RE = re.compile(r"^(คาเฟ่|ตลาด|พิพิธภัณฑ์|ร้านอาหาร|วัด|สถานที่ท่องเที่ยว|สวนสาธารณะ|อุทยานแห่งชาติ)ในขอนแก่น")

SYSTEM_PROMPT = (
    "You are a concise Thai local-guide copywriter. Output JSON only, in the "
    'shape {"description": "..."}. Ground every sentence only in the facts '
    "given to you -- reviews, search snippets, tags, amenities. Never invent "
    "specifics (hours, awards, history, prices) that aren't present in the "
    "input. Search results are unreliable for common place names -- a search "
    "snippet may describe a different, same-named place in another province "
    "or country entirely. The place you are describing is always in Khon "
    "Kaen province (ขอนแก่น), Thailand -- if a snippet mentions any other "
    "province, city, or country, or any award/certification you cannot "
    "verify is about this exact place, discard that snippet's claims "
    "completely rather than include them. Never write opening hours, days "
    "closed, or prices/price ranges, even when the input has them: the place "
    "has its own hours and price fields, kept current by the Google sync, so "
    "a copy in the description goes stale and contradicts them (seen live: "
    "the chatbot quoted two different opening times for one cafe). Never "
    "mention another province, or a road code of one (e.g. 'ลย.'). When the "
    "input DOES contain "
    "concrete, verifiable specifics (a height/size in meters, "
    "walking distance, an alternate name, a notable feature) prefer stating "
    "them plainly over generic adjectives like 'ร่มรื่น'/'สวยงาม' alone -- "
    "confirmed in testing that a vague summary is a common failure mode even "
    "when good specifics are available in the input, so err toward including "
    "them rather than omitting them for brevity. If two sources disagree on "
    "the same fact (e.g. two different heights for the same waterfall), "
    "pick the review-based one over a search snippet/page, since reviews "
    "are confirmed to be about this exact place and search results are not."
)

MAX_LLM_ATTEMPTS = 2  # the KKU gateway occasionally returns an empty message.content for no
                       # apparent reason (~10-15% of calls in testing) -- one retry clears most of these

DESCRIPTION_TIMEOUT_S = 60
DESCRIPTION_SCHEMA = {
    "type": "object",
    "properties": {"description": {"type": "string"}},
    "required": ["description"],
    "additionalProperties": False,
}

# MODEL_NAME, like every other LLM call. Only on the KKU gateway, which
# enforces a *daily* quota per model, a run of ~600 places can burn through
# it partway in -- there, walk on to these on a daily-limit error instead of
# writing template descriptions for the rest of the run. Spread across
# providers since quota is likely tracked per underlying provider.
_KKU_QUOTA_FALLBACKS = ["gemini-3.7-flash", "gpt-5.6-luna", "deepseek-v4-pro", "gpt-5.6-terra", "llama-4-scout"]
MODEL_FALLBACK_CHAIN = list(dict.fromkeys([MODEL_NAME] + (_KKU_QUOTA_FALLBACKS if LLM_PROVIDER == "kku" else [])))


class ModelChain:
    """Which model of MODEL_FALLBACK_CHAIN is current. The batch script keeps one
    for the whole run so a switch sticks once a model's quota is gone; the API
    route makes a fresh one per request, since a long-lived server must not
    stay pinned to a fallback after the quota resets the next day."""

    def __init__(self):
        self.idx = 0

    @property
    def model(self) -> str:
        return MODEL_FALLBACK_CHAIN[self.idx]

    def advance(self) -> bool:
        if self.idx >= len(MODEL_FALLBACK_CHAIN) - 1:
            return False
        self.idx += 1
        logger.warning("  Switching model: %s -> %s", MODEL_FALLBACK_CHAIN[self.idx - 1], self.model)
        return True


def google_search(query: str, num: int = 3) -> List[Dict]:
    """Returns [{title, snippet, link}, ...], or [] on no results/error --
    never raises, since a search miss should just degrade to reviews-only,
    not crash the whole batch run."""
    try:
        res = requests.post(
            SERPER_ENDPOINT,
            headers={"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"},
            json={"q": query, "gl": "th", "hl": "th", "num": num},
            timeout=10,
        )
        res.raise_for_status()
        items = res.json().get("organic", [])
        return [{"title": i.get("title", ""), "snippet": i.get("snippet", ""), "link": i.get("link", "")} for i in items]
    except Exception as e:
        logger.warning("  Search failed for %r: %s", query, e)
        return []


def fetch_page_text(url: str, max_chars: int = 3000) -> Optional[str]:
    """Fetches `url` and returns its visible text (script/style stripped,
    whitespace collapsed, truncated to max_chars), or None on any failure --
    blocked domain, timeout, non-HTML response, empty extraction. Never
    raises; a fetch miss just means the caller falls back to the search
    snippet instead."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return None
    if parsed.netloc.lower() in BLOCKED_FETCH_DOMAINS:
        return None
    try:
        res = requests.get(url, headers=FETCH_HEADERS, timeout=8)
        res.raise_for_status()
        if "text/html" not in res.headers.get("Content-Type", ""):
            return None
        soup = BeautifulSoup(res.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        text = " ".join(soup.get_text(separator=" ").split())
        return text[:max_chars] if len(text) > 200 else None
    except Exception as e:
        logger.warning("  Page fetch failed for %r: %s", url, e)
        return None


def enrich_with_page_text(results: List[Dict]) -> List[Dict]:
    """Tries each result's link in order and attaches full page text to the
    first one that fetches successfully -- only one, not all three, to keep
    latency/failure surface bounded. The rest keep just their search
    snippet, which build_prompt() falls back to per-result anyway."""
    for r in results:
        text = fetch_page_text(r["link"])
        if text:
            r["full_text"] = text
            break
    return results


def search_for_place(name: str, district: Optional[str]) -> List[Dict]:
    # Common place names (a temple, a noodle shop) recur across provinces --
    # the query needs the location term, or a same-named place elsewhere in
    # Thailand can outrank the actual Khon Kaen one (confirmed happening in
    # testing before this was added).
    if not SERPER_API_KEY:
        return []
    results = google_search(f"{name} {district or 'ขอนแก่น'}")
    return enrich_with_page_text(results)


def template_description(name: str, category: str, tags: List[str], amenities: List[str]) -> str:
    """Deterministic fallback for places with no reviews and no search hits --
    still specific to this place's tags/amenities, unlike the old generic
    rating-only line."""
    bits = [category]
    if tags:
        bits.append("/".join(tags[:3]))
    if amenities:
        bits.append(f"มี{amenities[0]}")
    return f"{name} - {' '.join(bits)}ในขอนแก่น"


def needs_processing(place: Dict) -> bool:
    """True if `place` still has either the original import-time generic
    description, or the deterministic fallback above (i.e. a previous run
    tried and failed to get an LLM description for it) -- both cases should
    be retried. Recomputing template_description() and comparing for equality
    (rather than a second regex) means this stays correct even if its output
    shape changes later."""
    desc = place.get("description") or ""
    if ORIGINAL_TEMPLATE_RE.match(desc):
        return True
    fallback = template_description(place["name"], place["category"], place.get("tags") or [], place.get("amenities") or [])
    return desc == fallback


def build_prompt(place: Dict, search_results: List[Dict]) -> str:
    reviews_text = "\n".join(
        f"- ({r.get('stars', '?')}★) {r.get('text', '')}" for r in (place.get("reviews") or [])
    ) or "(none)"
    search_text = "\n".join(
        f"- {r['title']}: {r['full_text']}" if r.get("full_text") else f"- {r['title']}: {r['snippet']}"
        for r in search_results
    ) or "(none)"
    return f"""
สถานที่: {place['name']}
ที่ตั้ง: {place.get('district') or 'ขอนแก่น'} จังหวัดขอนแก่น ประเทศไทย (ห้ามใช้ข้อมูลของสถานที่ชื่อเดียวกันที่อยู่จังหวัด/ประเทศอื่น)
หมวดหมู่: {place['category']}
แท็ก: {', '.join(place.get('tags') or []) or '(none)'}
สิ่งอำนวยความสะดวก: {', '.join(place.get('amenities') or []) or '(none)'}
คะแนนรีวิว: {place.get('rating') or 'ไม่มี'} จาก {place.get('review_count') or 0} รีวิว

[รีวิวจริงจาก Google Maps]
{reviews_text}

[ผลการค้นหาจาก Google Search]
{search_text}

เขียนคำอธิบายสถานที่นี้เป็นภาษาไทย ยาวไม่เกิน 8-10 บรรทัด อ่านเป็นธรรมชาติเหมือนไกด์ท้องถิ่นแนะนำ
ให้ความยาวพอเหมาะที่จะใส่รายละเอียด/ข้อเท็จจริงที่เจาะจงและมีประโยชน์จริง (ตัวเลข ความสูง
ระยะทาง ชื่อเรียกอื่น จุดเด่น) ถ้ามีอยู่ในข้อมูลข้างต้น ไม่ใช่แค่คำคุณศัพท์กว้างๆ แต่ก็ไม่ต้องยืดเยื้อเกินจำเป็น
ห้ามใส่เวลาเปิด-ปิด วันหยุด หรือราคา (ระบบแสดงจากข้อมูลที่อัปเดตอยู่แล้ว) และห้ามพูดถึงจังหวัดอื่น
อิงจากข้อมูลข้างต้นเท่านั้น ห้ามเดาหรือแต่งข้อมูลที่ไม่มีในนี้
"""


def llm_summarize(place: Dict, search_results: List[Dict], chain: ModelChain) -> Optional[str]:
    prompt = build_prompt(place, search_results)
    attempts_on_model = 0
    while True:
        model = chain.model
        try:
            data = complete_json(
                system=SYSTEM_PROMPT, user=prompt, schema=DESCRIPTION_SCHEMA,
                timeout=DESCRIPTION_TIMEOUT_S, temperature=0.3, model=model, label="describe",
            )
            description = (data.get("description") or "").strip()
            if description:
                return description
            logger.warning("  %s returned empty description for %r", model, place["name"])
        except Exception as e:
            if "daily limit" in str(e).lower():
                logger.warning("  %s hit its daily limit", model)
                if chain.advance():
                    attempts_on_model = 0
                    continue
                logger.warning("  All fallback models exhausted -- falling back to template for %r", place["name"])
                return None
            logger.warning("  LLM summarize failed for %r using %s: %s", place["name"], model, e)
        attempts_on_model += 1
        if attempts_on_model >= MAX_LLM_ATTEMPTS:
            return None


def generate_description(place: Dict, chain: Optional[ModelChain] = None) -> Dict[str, str]:
    """Runs search -> LLM summary -> template fallback for one place dict
    (name, category, district, tags, amenities, rating, review_count, reviews).
    Returns {"description": str, "source": "search_assisted" | "reviews_only" |
    "template_only"}. Never raises on search/LLM failure -- it degrades."""
    chain = chain or ModelChain()
    search_results = search_for_place(place["name"], place.get("district"))
    description = None
    if place.get("reviews") or search_results:
        description = llm_summarize(place, search_results, chain)

    if description:
        return {"description": description, "source": "search_assisted" if search_results else "reviews_only"}
    return {
        "description": template_description(place["name"], place["category"], place.get("tags") or [], place.get("amenities") or []),
        "source": "template_only",
    }
