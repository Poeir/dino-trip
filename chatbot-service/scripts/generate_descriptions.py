"""Generates a grounded, place-specific description for every `places` row,
replacing the generic "{category}ในขอนแก่น คะแนนรีวิว X ดาว..." fallback that
the backend's mapDesc() writes when Google Places returns no
generativeSummary/editorialSummary -- confirmed empty for all 664 rows in this
dataset, even well-known landmarks, so there's nothing left to gain by
re-fetching from Google.

The actual pipeline (reviews + serper.dev search snippets -> LLM -> template
fallback) lives in src/services/place_description.py, shared with the admin
form's "generate with AI" button (POST /admin/places/describe). This script is
only the batch driver: it walks the whole table and writes results straight
to the DB. It uses the service's one LLM (LLM_PROVIDER / MODEL_NAME).

Run whenever descriptions need regenerating (e.g. after a bulk import):
    cd chatbot-service && python scripts/generate_descriptions.py [--dry-run] [--limit N] [--force]

Re-run scripts/embed_content.py afterward -- description feeds its
place_text() composition, so embeddings go stale otherwise.
"""
import argparse
import logging
import os
import sys
import time

# Windows consoles default to a legacy codepage (cp874 for Thai locale) that
# can't encode most Thai/Unicode output -- force UTF-8 stdout so printing
# place names/descriptions doesn't crash mid-run.
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.config import SERPER_API_KEY
from src.core.db import supabase
from src.services.place_description import ModelChain, generate_description, needs_processing

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print results without writing to the DB")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N places")
    parser.add_argument("--force", action="store_true", help="Reprocess places that already have a non-template description (default: skip them)")
    args = parser.parse_args()

    if not SERPER_API_KEY:
        print("Missing SERPER_API_KEY. Copy chatbot-service/.env.example to .env and fill it in.")
        sys.exit(1)

    # One chain for the whole run: on the KKU gateway, once a model's daily
    # quota is gone the switch sticks, instead of retrying it on every place.
    chain = ModelChain()

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

        result = generate_description(place, chain)
        description, source = result["description"], result["source"]
        stats[source] += 1
        # Courtesy pacing -- the search proxy has a per-second quota and the
        # LLM may be a shared gateway.
        time.sleep(0.5)

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
