"""Generates a grounded, place-specific description for every `places` row,
replacing the 100% generic "{category}ในขอนแก่น คะแนนรีวิว X ดาว..." fallback
template that import-places.js's mapDesc() writes when Google Places API
doesn't return generativeSummary/editorialSummary -- confirmed empty for all
664 rows in this dataset, even well-known landmarks, so there's nothing left
to gain by re-fetching from Google.

Sources, in priority order:
  1. Existing Google Maps reviews (places.reviews -- already in DB, capped at
     5/place by Google itself, not by us; no more obtainable there).
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

Run whenever descriptions need regenerating (e.g. after a fresh
import-places.js run):
    cd chatbot-service && python scripts/generate_descriptions.py [--dry-run] [--limit N]

Re-run scripts/embed_content.py afterward -- description feeds its
place_text() composition, so embeddings go stale otherwise.
"""
import argparse
import json
import logging
import os
import re
import sys
import time
from typing import Dict, List, Optional

# Windows consoles default to a legacy codepage (cp874 for Thai locale) that
# can't encode most Thai/Unicode output -- force UTF-8 stdout so printing
# place names/descriptions doesn't crash mid-run.
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
from bs4 import BeautifulSoup
from openai import OpenAI
from urllib.parse import urlparse

from src.core.config import API_KEY, BASE_URL, DESCRIPTION_MODEL_NAME, SERPER_API_KEY
from src.core.db import supabase
from src.services.trip_planner.json_utils import clean_json_string

logging.basicConfig(level=logging.INFO, format="%(message)s")
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

# Matches import-places.js's mapDesc() fallback ("{category}ในขอนแก่น
# คะแนนรีวิว X ดาว..." / "...ยังไม่มีคะแนนรีวิว") -- i.e. a place this script
# hasn't touched yet. Used to skip already-processed places on a resumed run
# instead of re-spending search+LLM calls on them.
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
    "completely rather than include them. When the input DOES contain "
    "concrete, verifiable specifics (a height/size in meters, opening hours, "
    "walking distance, an alternate name, a notable feature) prefer stating "
    "them plainly over generic adjectives like 'ร่มรื่น'/'สวยงาม' alone -- "
    "confirmed in testing that a vague summary is a common failure mode even "
    "when good specifics are available in the input, so err toward including "
    "them rather than omitting them for brevity. If two sources disagree on "
    "the same fact (e.g. two different heights for the same waterfall), "
    "pick the review-based one over a search snippet/page, since reviews "
    "are confirmed to be about this exact place and search results are not."
)


def google_search(query: str, num: int = 3) -> List[Dict]:
    """Returns [{title, snippet, link}, ...], or [] on no results/error --
    never raises, since a search miss should just degrade to reviews-only,
    not crash the whole batch run. Plain query, no site restriction -- an
    earlier version biased landmark-category places (วัด/พิพิธภัณฑ์/etc.) to
    a Wikipedia/TAT-only query, but that returned noticeably less/thinner
    data than a plain search, per live testing -- dropped in favor of one
    consistent unrestricted query for every place."""
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
    domain = urlparse(url).netloc.lower()
    if domain in BLOCKED_FETCH_DOMAINS:
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
    description, or this script's own deterministic fallback (i.e. a
    previous run tried and failed to get an LLM description for it) --
    both cases should be retried. Recomputing template_description() and
    comparing for equality (rather than a second regex) means this stays
    correct even if template_description()'s output shape changes later."""
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
ให้ความยาวพอเหมาะที่จะใส่รายละเอียด/ข้อเท็จจริงที่เจาะจงและมีประโยชน์จริง (ตัวเลข ความสูง เวลาเปิด-ปิด
ระยะทาง ชื่อเรียกอื่น จุดเด่น) ถ้ามีอยู่ในข้อมูลข้างต้น ไม่ใช่แค่คำคุณศัพท์กว้างๆ แต่ก็ไม่ต้องยืดเยื้อเกินจำเป็น
อิงจากข้อมูลข้างต้นเท่านั้น ห้ามเดาหรือแต่งข้อมูลที่ไม่มีในนี้
"""


MAX_LLM_ATTEMPTS = 2  # the KKU gateway occasionally returns an empty message.content for no
                       # apparent reason (~10-15% of calls in testing) -- one retry clears most of these

# The KKU gateway enforces a *daily* quota per model, not per key -- a run of
# ~600 places can burn through one model's quota partway in (confirmed: both
# gemini-2.5-flash and gpt-5.4 hit this in one run each). Rather than stop
# and require a manual restart with a different DESCRIPTION_MODEL_NAME, walk
# this chain automatically on a daily-limit error and keep going -- this is
# module-level state (not per-call) so the switch sticks for the rest of the
# run once a model is exhausted, instead of retrying it on every place.
# Order picked from `GET {BASE_URL}/models`: spread across different
# providers (Gemini/OpenAI/Claude/Deepseek) since quota is very likely
# tracked per underlying provider, not just per model id.
MODEL_FALLBACK_CHAIN = [
    DESCRIPTION_MODEL_NAME,
    "gemini-2.5-flash",
    "gpt-5.4",
    "claude-haiku-4.5",
    "deepseek-v3.2",
    "gpt-5.1",
    "gemini-2.5-flash-lite",
    "llama-4-scout",
]
# De-dupe while preserving order (DESCRIPTION_MODEL_NAME may already be one of the defaults).
MODEL_FALLBACK_CHAIN = list(dict.fromkeys(MODEL_FALLBACK_CHAIN))
_model_idx = 0


def _advance_model() -> bool:
    global _model_idx
    if _model_idx >= len(MODEL_FALLBACK_CHAIN) - 1:
        return False
    _model_idx += 1
    logger.warning("  Switching model: %s -> %s", MODEL_FALLBACK_CHAIN[_model_idx - 1], MODEL_FALLBACK_CHAIN[_model_idx])
    return True


def llm_summarize(client: OpenAI, place: Dict, search_results: List[Dict]) -> Optional[str]:
    prompt = build_prompt(place, search_results)
    attempts_on_model = 0
    while True:
        model = MODEL_FALLBACK_CHAIN[_model_idx]
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                response_format={"type": "json_object"},
            )
            data = json.loads(clean_json_string(response.choices[0].message.content))
            description = (data.get("description") or "").strip()
            if description:
                return description
            logger.warning("  %s returned empty description for %r", model, place["name"])
        except Exception as e:
            if "daily limit" in str(e).lower():
                logger.warning("  %s hit its daily limit", model)
                if _advance_model():
                    attempts_on_model = 0
                    continue
                logger.warning("  All fallback models exhausted -- falling back to template for %r", place["name"])
                return None
            logger.warning("  LLM summarize failed for %r using %s: %s", place["name"], model, e)
        attempts_on_model += 1
        if attempts_on_model >= MAX_LLM_ATTEMPTS:
            return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print results without writing to the DB")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N places")
    parser.add_argument("--force", action="store_true", help="Reprocess places that already have a non-template description (default: skip them)")
    args = parser.parse_args()

    if not SERPER_API_KEY:
        print("Missing SERPER_API_KEY. Copy chatbot-service/.env.example to .env and fill it in.")
        sys.exit(1)

    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

    places = (
        supabase.table("places")
        .select("id, name, category, district, tags, amenities, rating, review_count, reviews, description")
        .execute()
        .data
    )
    if args.limit:
        places = places[: args.limit]

    stats = {"search_assisted": 0, "reviews_only": 0, "template_only": 0, "skipped": 0}

    for i, place in enumerate(places, 1):
        if not args.force and not needs_processing(place):
            stats["skipped"] += 1
            print(f"[{i}/{len(places)}] {place['name']} (skipped, already processed)")
            continue

        has_reviews = bool(place.get("reviews"))
        search_results = search_for_place(place["name"], place.get("district"))
        time.sleep(0.2)  # courtesy pacing for the Custom Search per-second quota

        if has_reviews or search_results:
            description = llm_summarize(client, place, search_results)
            time.sleep(0.3)  # courtesy pacing -- KKU_API_KEY is a shared university gateway
        else:
            description = None

        if description:
            source = "search_assisted" if search_results else "reviews_only"
        else:
            description = template_description(place["name"], place["category"], place.get("tags") or [], place.get("amenities") or [])
            source = "template_only"
        stats[source] += 1

        print(f"[{i}/{len(places)}] {place['name']} ({source})\n  -> {description}")

        if not args.dry_run:
            supabase.table("places").update({"description": description}).eq("id", place["id"]).execute()

    print(
        f"\nDone. search_assisted={stats['search_assisted']} "
        f"reviews_only={stats['reviews_only']} template_only={stats['template_only']} "
        f"skipped={stats['skipped']}"
    )
    if args.dry_run:
        print("(dry run -- nothing written to DB)")


if __name__ == "__main__":
    main()
