"""Pick-quality metrics computed offline from a stored LLM output + the cached
candidate pool, so they apply to every record uniformly (including runs made
before a metric existed). No LLM, no DB, no heavy imports.
"""

THIN_REVIEWS = 20  # fewer reviews than this = rating is weakly evidenced


def final_compliance(itinerary, start_time, end_time):
    """Commonsense checks on the FINAL plan, from the stored `itinerary` stop
    strings ("HH:MM Name [category]"). Same lunch rule as scheduler_replay:
    a day is lunch-eligible when the window starts by 12:00 and ends after 13:00."""
    covers_lunch = start_time <= "12:00" and end_time >= "13:00"
    no_meal = eligible = served = stops = 0
    for day in itinerary or []:
        meals = [s for s in day["stops"] if s.endswith("[ร้านอาหาร]")]
        no_meal += not meals
        stops += sum(1 for s in day["stops"] if not s.endswith(("[None]", "[ที่พัก]")))
        if covers_lunch:
            eligible += 1
            served += any("11:00" <= s[:5] <= "14:00" for s in meals)
    chars = sum(len(s) for day in itinerary or [] for s in day["stops"])
    return {"no_meal_days": no_meal, "lunch_eligible_days": eligible, "lunch_served_days": served,
            "final_stops": stops, "itinerary_chars": chars}


def pick_quality(llm_output, candidates, interests):
    """candidates: list of place dicts (as cached). Returns None-safe metrics
    over the places the LLM picked (deduped, valid IDs only)."""
    by_id = {c["id"]: c for c in candidates}
    seen, picks = set(), []
    for day in (llm_output or {}).get("itinerary", []):
        for e in day.get("places", []):
            pid = e.get("place_id")
            if pid in by_id and pid not in seen:
                seen.add(pid)
                picks.append(by_id[pid])
    non_rest = [p for p in picks if p.get("category") != "ร้านอาหาร"]
    wanted = set(interests)
    interest_match = None
    if wanted and non_rest:
        interest_match = sum(1 for p in non_rest if wanted & set(p.get("tags") or [])) / len(non_rest)
    ratings = [p.get("rating") or 0.0 for p in picks]
    return {
        "interest_match": interest_match,
        "avg_rating_picked": sum(ratings) / len(ratings) if ratings else None,
        "thin_review_picks": sum(1 for p in picks if (p.get("review_count") or 0) < THIN_REVIEWS),
    }
