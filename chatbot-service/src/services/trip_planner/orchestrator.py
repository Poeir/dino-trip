import math
import random
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from itertools import zip_longest
from src.core.db import find_place_by_name
from src.services.rag.retriever import PlaceRetriever
from .models import BREAKFAST_PREFERENCE, FOOD_PREFERENCES, Place, TripInput, TripSummary, DaySummary
from . import route_scheduler

# Khon Kaen city center -- fallback location if the named accommodation isn't
# found in `places` at all (same fallback the old project used).
DEFAULT_HOTEL_LOCATION = {"lat": 16.4322, "lng": 102.8236}

# Keyed by the frontend's actual budgetList strings (ประหยัด/ปานกลาง/หรูหรา)
# rather than translating to English tiers first -- this app is Thai-first,
# a translation layer just for internal bookkeeping added nothing.
BUDGET_PRICE_RANGES = {
    "ประหยัด": [0, 1],
    "ปานกลาง": [0, 1, 2],
    "หรูหรา": [2, 3, 4],
}

# Categories kept out of the RAG candidate pool for a budget tier. The price
# filter above can't do this on its own: price_level is null for 38 of the 40
# "ตลาด" rows in the live `places` table (and nothing at all is rated 3-4), so
# a หรูหรา trip kept every night market -- both as an LLM pick (the prompt
# carries no price) and as a backfill/gap-filler stop, since those draw from
# this same pool. Must-go places are exempt, same as the price filter.
BUDGET_EXCLUDED_CATEGORIES = {
    "หรูหรา": {"ตลาด"},
}

# --- Spare pool -----------------------------------------------------------
# Some interest sets can't fill a day on their own: "อาหารพื้นถิ่น + คาเฟ่" in
# the city retrieves one temple, four cafes and restaurants, and a 09:00-20:00
# day had 284 idle minutes with nothing left to put in them. The spare pool
# is a short list of neutral places to walk around (parks, lakes, landmarks,
# a market at its hour) that the LLM never sees; route_scheduler only draws
# on it after every interest candidate, at most MAX_SPARE_STOPS_PER_DAY a day
# and only at a sensible hour (auto_add_time_ok). No temples or museums: those
# reach a trip through the traveller's interests, not as padding.
SPARE_CATEGORIES = route_scheduler.SPARE_OUTDOOR_CATEGORIES + ("ตลาด",)
# Stricter than the usual filler bar (route_scheduler.MIN_FILLER_*): nobody
# asked for these places, so only well-established ones qualify.
SPARE_MIN_RATING = 4.0
SPARE_MIN_REVIEWS = 200
# A spare is a walk near where the traveller sleeps, before setting off or on
# the way back -- never a reason to drive to another district.
SPARE_MAX_KM_FROM_HOTEL = route_scheduler.INTERCITY_THRESHOLD_KM
SPARE_POOL_SIZE = 20

# --- Candidate ranking ----------------------------------------------------
# Every place whose tags match an interest scores exactly 1.0 in the search,
# so "คาเฟ่" returns ~150 equally relevant cafes and the pool used to take
# whichever came first. _rerank orders each interest's results by relevance
# tier first (a weak semantic match never passes a tag match), then within a
# tier by a blend of popularity and closeness to the accommodation, plus a
# little noise so the same request doesn't always produce the same trip.
RELEVANCE_TIER = 0.1
POPULARITY_WEIGHT = 0.7
PROXIMITY_WEIGHT = 0.3
RANK_JITTER = 0.05
# Rating pulled toward 4.3 by 50 virtual reviews (same formula as the
# match_places_ranked SQL function), so 5.0 from 3 reviews doesn't beat
# 4.6 from 2,000. Mapped from 3.5..5.0 onto 0..1.
POPULARITY_PRIOR_RATING = 4.3
POPULARITY_PRIOR_REVIEWS = 50
# Proximity score halves at this distance from the accommodation. Only a
# bonus: a far place with strong reviews can still win its slot.
PROXIMITY_HALF_KM = 10.0

GENERIC_INTEREST_QUERY = "สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น"
MEAL_QUERY = "ร้านอาหารแนะนำ ขอนแก่น"

# The searches for one trip (one per interest, the meal search, the must-go
# name lookups) are independent network calls, run side by side.
_search_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="trip-search")


def _popularity_score(row: dict) -> float:
    rating = row.get("rating") or 0.0
    reviews = row.get("review_count") or 0
    bayes = (rating * reviews + POPULARITY_PRIOR_RATING * POPULARITY_PRIOR_REVIEWS) / (reviews + POPULARITY_PRIOR_REVIEWS)
    return min(1.0, max(0.0, (bayes - 3.5) / 1.5))


def _proximity_score(row: dict, origin: Place | None) -> float:
    if origin is None or row.get("lat") is None or row.get("lng") is None:
        return 0.0
    here = Place(id="_", name="_", lat=row["lat"], lng=row["lng"])
    return 1.0 / (1.0 + route_scheduler.calculate_distance(origin, here) / PROXIMITY_HALF_KM)


def _rerank(rows: list, origin: Place | None, rng: random.Random) -> list:
    """See RELEVANCE_TIER above. `origin` is None when the accommodation's
    location isn't really known; popularity then decides alone."""
    pop_w, prox_w = (POPULARITY_WEIGHT, PROXIMITY_WEIGHT) if origin else (1.0, 0.0)

    def key(row):
        tier = math.floor((row.get("match_score") or 1.0) / RELEVANCE_TIER + 1e-9)
        blend = pop_w * _popularity_score(row) + prox_w * _proximity_score(row, origin) + rng.uniform(0, RANK_JITTER)
        return (-tier, -blend)

    return sorted(rows, key=key)


# Same-category places allowed in a row before _diversify moves to another
# category (within one relevance tier).
DIVERSITY_RUN = 2


def _diversify(rows: list) -> list:
    """Reorders one interest's ranked results so categories alternate: within
    a relevance tier, the next row is the best-ranked one whose category has
    been used least (in steps of DIVERSITY_RUN). "ครอบครัว"/"ธรรมชาติ" results
    are mostly parks, and taking them in rank order handed the LLM a pool it
    could only build park-after-park days from (live 2026-10-21)."""
    remaining = list(rows)
    counts: dict = {}
    out = []
    while remaining:
        def key(item):
            i, row = item
            tier = math.floor((row.get("match_score") or 1.0) / RELEVANCE_TIER + 1e-9)
            return (-tier, counts.get(row.get("category"), 0) // DIVERSITY_RUN, i)
        i, row = min(enumerate(remaining), key=key)
        out.append(row)
        counts[row.get("category")] = counts.get(row.get("category"), 0) + 1
        remaining.pop(i)
    return out


def _daytime_capacity(places: list, days: int) -> int:
    """How many daytime stops `places` can really supply over `days`: each
    category counts only up to its daily cap times the days. Ten cafes on a
    two-day trip are four usable stops (2 a day) -- counting all ten, a
    cafe-only trip looked full and came back to the hotel at 14:38 (live
    2026-10-21)."""
    per_category: dict = {}
    for p in places:
        if _is_daytime_stop(p):
            per_category[p.category] = per_category.get(p.category, 0) + 1
    total = 0
    for category, n in per_category.items():
        cap = route_scheduler.category_daily_cap(category)
        total += n if cap is None else min(n, cap * days)
    return total


def _is_daytime_stop(place: Place) -> bool:
    """Something to do before the evening: not a restaurant, an evening
    market or an evening-only place."""
    return (
        place.category != "ร้านอาหาร"
        and route_scheduler.market_kind(place) != "evening"
        and not route_scheduler.is_evening_place(place)
    )


# Google's administrative_area_level_2 name for Khon Kaen's city district
# (see import-places.js's mapDistrict()) comes back inconsistently across
# rows -- confirmed against the live `places` table: "อำเภอเมืองขอนแก่น" (the
# majority), plus "เมือง", "อ.เมือง", "อ.เมืองขอนแก่น", "Muang", and other
# prefix/casing variants, all referring to the same district. None of the
# *other* (non-Mueang) districts in the data contain "เมือง" as a substring
# (ภูเวียง, อุบลรัตน์, ชุมแพ, หนองเรือ, ... all clearly outlying names), so a
# substring/casefold check reliably identifies Mueang without needing a
# lookup table for every prefix variant.
def _is_mueang_district(district: str | None) -> bool:
    if not district:
        return False
    return "เมือง" in district or "muang" in district.lower()


class TripBuilderService:
    def __init__(self, rng: random.Random | None = None):
        self.retriever = PlaceRetriever()
        self.rng = rng or random.Random()

    def build_candidate_list(self, user_input: TripInput):
        # Real coordinates from the frontend's map picker/geolocation take
        # priority over name-matching -- find_place_by_name() only searches
        # the curated `places` table (tourist attractions/cafes/restaurants),
        # which a real accommodation's name almost never matches, so that
        # path was silently falling back to a hardcoded city-center point
        # for most users. Only reached when the request didn't supply
        # coordinates at all (old clients, or nothing picked).
        # Where candidates get a closeness bonus from (see _rerank): only a
        # location that is really known, not the city-centre fallback.
        origin = None
        if user_input.accommodation_lat is not None and user_input.accommodation_lng is not None:
            accommodation = origin = Place(
                id="hotel_dummy",
                name=user_input.accommodation_name or "ที่พัก",
                category="ที่พัก",
                rating=4.5,
                lat=user_input.accommodation_lat,
                lng=user_input.accommodation_lng,
            )
        else:
            accommodation_row = find_place_by_name(user_input.accommodation_name)
            if accommodation_row:
                accommodation = origin = Place(**accommodation_row)
            else:
                accommodation = Place(
                    id="hotel_dummy",
                    name=user_input.accommodation_name,
                    category="ที่พัก",
                    rating=4.5,
                    lat=DEFAULT_HOTEL_LOCATION["lat"],
                    lng=DEFAULT_HOTEL_LOCATION["lng"],
                )

        must_go_list = []
        missing_must_go = []
        must_go_rows = list(_search_pool.map(lambda name: find_place_by_name(name), user_input.must_go))
        for name, row in zip(user_input.must_go, must_go_rows):
            if row:
                must_go_list.append(Place(**row))
            else:
                missing_must_go.append(name)

        start_dt = datetime.strptime(user_input.start_time, "%H:%M")
        end_dt = datetime.strptime(user_input.end_time, "%H:%M")

        # Per-day slots: the pace's attraction max for this window (see
        # route_scheduler.pace_stop_range -- the same range llm_extractor
        # enforces afterwards), plus room for the day's restaurants, which
        # don't count toward that range. Rounded up on purpose: undercounting
        # here is what previously starved the LLM's candidate pool below what
        # a full day needs.
        min_attractions, max_attractions = route_scheduler.pace_stop_range(
            user_input.trip_pace, start_dt.time(), end_dt.time(), breakfast=BREAKFAST_PREFERENCE in user_input.food_preferences,
        )
        places_per_day = max_attractions + 2

        total_slots = places_per_day * user_input.trip_duration_days
        remaining_slots = total_slots - len(must_go_list)

        # Extra selection surplus beyond what the day slots strictly need.
        # Without it, self.candidates ends up sized almost exactly to
        # total_slots, so once the LLM assigns most of them to days,
        # llm_extractor.py's backfill_pool (built from whatever candidates
        # the LLM *didn't* pick) has nothing spare left -- confirmed live: a
        # relaxed-pace day with a 3h26m gap fell back to a "☕ free time"
        # placeholder in materialize_day_schedule instead of a real nearby
        # place, purely because the candidate pool had already been used up.
        # 50% surplus keeps the LLM's day-assignment choices the same size
        # (it still only picks what a day needs) while leaving real
        # candidates on the table for route_scheduler's deterministic
        # backfill/gap-filler layers to draw from.
        candidate_pool_target = math.ceil(remaining_slots * 1.5)

        existing_ids = {p.id for p in must_go_list}
        allowed_prices = BUDGET_PRICE_RANGES.get(user_input.budget_level, [0, 1, 2])
        excluded_categories = BUDGET_EXCLUDED_CATEGORIES.get(user_input.budget_level, set())

        meal_reserve_needed = user_input.trip_duration_days * 2

        def search(query, limit):
            return _search_pool.submit(lambda: self.retriever.search_and_expand(query=query, limit=limit))

        # One retrieval call PER interest, then round-robin merge -- not one
        # call on ", ".join(interests). Regression: a single combined query
        # let an interest with many real matches (e.g. 140 temples for
        # "วัฒนธรรม/ศาสนา") drown out one with few (3 spots for "ไดโนเสาร์")
        # in the top-N ranking, even though the small interest had exact tag
        # matches -- confirmed live: the 3 dinosaur places never appeared in
        # a combined-query candidate list, but all 3 appeared when queried
        # alone. Round-robin (index 0 of every interest, then index 1, ...)
        # guarantees each stated interest gets a fair shot at a slot before
        # any single interest's larger result count crowds out the rest.
        # The meal search below is started at the same time; it's only read
        # if the interest results don't already hold enough restaurants.
        interest_futures = []
        generic_future = None
        if remaining_slots > 0:
            interest_futures = [
                search(query, candidate_pool_target * 5)
                for query in (user_input.interests or [GENERIC_INTEREST_QUERY])
            ]
            if user_input.interests:
                # Read only if the interests can't fill the days (see below).
                generic_future = search(GENERIC_INTEREST_QUERY, candidate_pool_target * 5)
        meal_future = search(MEAL_QUERY, meal_reserve_needed * 10)

        def accept(row):
            """The candidate `row` as a Place, or None if it's out for this trip."""
            place_id = row.get("id")
            if not place_id or place_id in existing_ids:
                return None
            place = Place(**row)
            # price_level is null for most of this dataset (Google didn't
            # return it) -- treat unknown as acceptable rather than
            # excluding it, or budget filtering would return almost nothing.
            if place.price_level is not None and place.price_level not in allowed_prices:
                return None
            if place.category == "ที่พัก" or place.category in excluded_categories:
                return None
            # Only applies to RAG-sourced candidates, same as the budget
            # filter above -- must_go places are honored regardless of
            # district. Rows without a district tag (place.district is
            # None) are excluded here: don't show a place as "in the
            # city" when we're not actually sure.
            if user_input.area_scope == "เมือง" and not _is_mueang_district(place.district):
                return None
            return place

        interest_list = []
        if interest_futures:
            per_interest_results = [_diversify(_rerank(f.result(), origin, self.rng)) for f in interest_futures]
            rag_results = [
                row for group in zip_longest(*per_interest_results) for row in group if row is not None
            ]

            for row in rag_results:
                place = accept(row)
                if not place:
                    continue
                interest_list.append(place)
                existing_ids.add(place.id)
                if len(interest_list) >= candidate_pool_target:
                    break

        # --- Daytime top-up -----------------------------------------------
        # Interests whose places are mostly evening ones (night markets,
        # dinners) can't fill a day that starts in the morning: live
        # "อาหารพื้นถิ่น + ช้อปปิ้ง" 08:00-21:00 trips had 5-6 hours of free
        # time, and neither the LLM nor the judge could fix it -- nothing in
        # the pool was open in the day. Popular daytime places are added
        # until the trip has the pace's minimum of them for every day.
        # Counted per category against the daily caps (_daytime_capacity), so a
        # top-up only adds places that raise what the days can actually hold.
        if generic_future is not None:
            days = user_input.trip_duration_days
            daytime_needed = min_attractions * days
            have = _daytime_capacity(must_go_list + interest_list, days)
            if have < daytime_needed:
                for row in _diversify(_rerank(generic_future.result(), origin, self.rng)):
                    if have >= daytime_needed:
                        break
                    place = accept(row)
                    if not place or not _is_daytime_stop(place):
                        continue
                    with_it = _daytime_capacity(must_go_list + interest_list + [place], days)
                    if with_it > have:
                        interest_list.append(place)
                        existing_ids.add(place.id)
                        have = with_it

        # --- Meal reserve -------------------------------------------------
        # A day with no meal isn't a reasonable itinerary regardless of what
        # interests were stated, so llm_extractor.py guarantees at least one
        # restaurant per day from this pool -- which only works if the pool
        # holds restaurants that can really be visited on this trip:
        #   1. open during the trip's daily window (route_scheduler.open_for_meal),
        #   2. enough LUNCH-capable ones for the number of days, when the
        #      window covers lunch (evening-only restaurants alone leave
        #      every midday without a meal).
        # Interest retrieval ranks by relevance, not by either.
        # (Tried and removed: also reserving restaurants near each outlying
        # cluster of places. Replaying stored LLM picks, it moved a Phu Wiang
        # day's meal from an in-town lunch on the way to a 15:13 meal at a
        # nearby restaurant, because the scheduler weighs distance far above
        # meal timing -- a net loss, with no measurable gain.)
        start_min = start_dt.hour * 60 + start_dt.minute
        end_min = end_dt.hour * 60 + end_dt.minute
        trip_start = datetime.strptime(user_input.start_date, "%Y-%m-%d").date()
        trip_dates = [trip_start + timedelta(days=i) for i in range(user_input.trip_duration_days)]
        needs_lunch = bool(route_scheduler.meal_probe_minutes(start_min, end_min, route_scheduler.MEAL_LUNCH_WINDOW))

        def usable(p):
            return route_scheduler.open_for_meal(p, trip_dates, start_min, end_min)

        def lunch_capable(p):
            return route_scheduler.open_for_meal(p, trip_dates, start_min, end_min, route_scheduler.MEAL_LUNCH_WINDOW)

        # Restaurants that can never be visited within the window only waste
        # a slot and invite the LLM to pick a meal the scheduler must drop.
        # Must-go restaurants are exempt: the user asked for them by name.
        interest_list = [p for p in interest_list if p.category != "ร้านอาหาร" or usable(p)]
        existing_ids = {p.id for p in must_go_list + interest_list}

        def meal_counts():
            restaurants = [p for p in must_go_list + interest_list if p.category == "ร้านอาหาร" and usable(p)]
            return len(restaurants), sum(1 for p in restaurants if lunch_capable(p))

        lunch_needed = user_input.trip_duration_days if needs_lunch else 0

        def acceptable_meal(row, require_lunch=False):
            place_id = row.get("id")
            if not place_id or place_id in existing_ids:
                return None
            place = Place(**row)
            if place.category != "ร้านอาหาร":
                return None
            if place.price_level is not None and place.price_level not in allowed_prices:
                return None
            if user_input.area_scope == "เมือง" and not _is_mueang_district(place.district):
                return None
            if not usable(place) or (require_lunch and not lunch_capable(place)):
                return None
            return place

        def add_meal(place):
            interest_list.append(place)
            existing_ids.add(place.id)

        def by_rating(rows):
            return sorted(rows, key=lambda r: (-(r.get("rating") or 0.0), -(r.get("review_count") or 0)))

        # --- Food preferences ---------------------------------------------
        # Restaurants (and bakery cafes) of the kinds the traveller asked for,
        # best and nearest first, so the LLM can pick them for meals and
        # llm_extractor._ensure_meals can fall back on them. Enough per kind
        # to cover every meal of the trip between them.
        if user_input.food_preferences:
            meals_per_kind = max(2, math.ceil(meal_reserve_needed / len(user_input.food_preferences)) + 1)
            for pref in user_input.food_preferences:
                category, subcategory = FOOD_PREFERENCES[pref]
                if category == "ร้านอาหาร":
                    rows, wanted, check = self.retriever.list_restaurants(), meals_per_kind, acceptable_meal
                else:
                    rows, wanted, check = self.retriever.list_by_categories(("คาเฟ่",)), user_input.trip_duration_days, accept
                added = 0
                for row in _rerank([r for r in rows if r.get("subcategory") == subcategory], origin, self.rng):
                    if added >= wanted:
                        break
                    place = check(row)
                    if place:
                        add_meal(place)
                        added += 1

        have, have_lunch = meal_counts()
        if have < meal_reserve_needed or have_lunch < lunch_needed:
            # Relevance-ranked first (the old behaviour), over a wider net
            # than before since many top results can be unusable.
            for row in meal_future.result():
                if have >= meal_reserve_needed and have_lunch >= lunch_needed:
                    break
                place = acceptable_meal(row, require_lunch=have >= meal_reserve_needed)
                if place:
                    add_meal(place)
                    have, have_lunch = have + 1, have_lunch + (1 if lunch_capable(place) else 0)

            # Still short (e.g. the ranked results were all evening-only):
            # fall back to the full restaurant list, best-rated first.
            if have < meal_reserve_needed or have_lunch < lunch_needed:
                for row in by_rating(self.retriever.list_restaurants()):
                    if have >= meal_reserve_needed and have_lunch >= lunch_needed:
                        break
                    place = acceptable_meal(row, require_lunch=have >= meal_reserve_needed)
                    if place:
                        add_meal(place)
                        have, have_lunch = have + 1, have_lunch + (1 if lunch_capable(place) else 0)

        return accommodation, must_go_list + interest_list, missing_must_go, {p.id for p in must_go_list}

    def build_meal_pool(self, user_input: TripInput, exclude_ids: set) -> list:
        """Every restaurant this trip could eat at, beyond the candidates the
        LLM sees: same budget and area rules, open for a meal inside the
        daily window on some trip day. llm_extractor draws a day's lunch or
        dinner from here when the day's own picks can't serve it -- above all
        a day out of town, where the candidates' restaurants are all in the
        city (a Phu Wiang day used to get its only meal back in town at 17:00)."""
        allowed_prices = BUDGET_PRICE_RANGES.get(user_input.budget_level, [0, 1, 2])
        start = datetime.strptime(user_input.start_time, "%H:%M")
        end = datetime.strptime(user_input.end_time, "%H:%M")
        start_min, end_min = start.hour * 60 + start.minute, end.hour * 60 + end.minute
        trip_start = datetime.strptime(user_input.start_date, "%Y-%m-%d").date()
        trip_dates = [trip_start + timedelta(days=i) for i in range(user_input.trip_duration_days)]

        pool = []
        for row in self.retriever.list_restaurants():
            if not row.get("id") or row["id"] in exclude_ids or row.get("lat") is None or row.get("lng") is None:
                continue
            place = Place(**row)
            if place.price_level is not None and place.price_level not in allowed_prices:
                continue
            if user_input.area_scope == "เมือง" and not _is_mueang_district(place.district):
                continue
            if not route_scheduler.open_for_meal(place, trip_dates, start_min, end_min):
                continue
            pool.append(place)
        return pool

    def build_spare_pool(self, user_input: TripInput, accommodation: Place, exclude_ids: set):
        """Spare places for this trip (see SPARE_CATEGORIES above), nearest
        the accommodation first. Same budget and area rules as the candidate
        list; `exclude_ids` are the candidates already in play."""
        allowed_prices = BUDGET_PRICE_RANGES.get(user_input.budget_level, [0, 1, 2])
        excluded_categories = BUDGET_EXCLUDED_CATEGORIES.get(user_input.budget_level, set())

        spares = []
        for row in self.retriever.list_by_categories(SPARE_CATEGORIES):
            if not row.get("id") or row["id"] in exclude_ids:
                continue
            place = Place(**row, is_spare=True)
            if (place.rating or 0.0) < SPARE_MIN_RATING or (place.review_count or 0) < SPARE_MIN_REVIEWS:
                continue
            if place.category in excluded_categories:
                continue
            if place.price_level is not None and place.price_level not in allowed_prices:
                continue
            if user_input.area_scope == "เมือง" and not _is_mueang_district(place.district):
                continue
            if place.lat is None or place.lng is None or route_scheduler._is_business_closed(place):
                continue
            # A market only counts once it's known when people go to it.
            if place.category == "ตลาด" and route_scheduler.market_kind(place) not in ("morning", "evening"):
                continue
            distance = route_scheduler.calculate_distance(accommodation, place)
            if distance > SPARE_MAX_KM_FROM_HOTEL:
                continue
            spares.append((distance, place))
        spares.sort(key=lambda pair: pair[0])
        return [place for _, place in spares[:SPARE_POOL_SIZE]]

    def get_dynamic_instructions(self, user_input: TripInput):
        start = datetime.strptime(user_input.start_time, "%H:%M").time()
        end = datetime.strptime(user_input.end_time, "%H:%M").time()
        lo, hi = route_scheduler.pace_stop_range(
            user_input.trip_pace, start, end, breakfast=BREAKFAST_PREFERENCE in user_input.food_preferences,
        )
        count = f"{lo}" if lo == hi else f"{lo}-{hi}"
        pace_instruction = {
            "relaxed": "- PACE (Relaxed): Schedule a slow-paced trip. Leave plenty of free time between activities. If there is a time gap > 45 mins, explicitly add '☕ พักผ่อนตามอัธยาศัย'.",
            "packed": "- PACE (Packed): Schedule a fast-paced trip. Minimize idle time and schedule activities back-to-back.",
        }.get(
            user_input.trip_pace,
            "- PACE (Standard): Balance activity time and rest. A moderate schedule is fine.",
        )
        pace_instruction += (
            f" Plan {count} attractions per day (cafes count, restaurants do not) -- "
            f"never more than {hi}."
        )

        # These only guide WHICH places to pick -- a deterministic scheduler
        # (route_scheduler.py) owns geographic ordering for every trip
        # regardless of budget tier, so these no longer instruct the LLM
        # about driving distance/fuel cost trade-offs at all.
        budget_instruction = {
            "ประหยัด": "- BUDGET (Economy): Prioritize free or cheap places.",
            "หรูหรา": "- BUDGET (Luxury): Focus ONLY on providing the most premium, high-end, and exclusive experiences.",
        }.get(
            user_input.budget_level,
            "- BUDGET (Standard): Balance cost and the quality of the places.",
        )

        return pace_instruction, budget_instruction

    def create_trip_summary(self, itinerary, total_dist, total_cost) -> TripSummary:
        day_summaries = []
        total_places = 0
        for day in itinerary:
            timeline_text = []
            for i, slot in enumerate(day.schedule):
                total_places += 1
                if i > 0:
                    timeline_text.append(f"🚗 เดินทางด้วยรถยนต์ {slot.travel_time_min} นาที ({slot.distance_km} กม.)")
                status_text = ""
                if slot.status == "Waiting":
                    status_text = f" (⚠️ รอ {slot.wait_time_min} นาที)"
                elif slot.status == "Closed":
                    status_text = " (❌ ร้านปิด!)"
                timeline_text.append(f"{slot.arrival_time} - {slot.place.name}{status_text}")

            day_summaries.append(DaySummary(
                day=day.day, date=day.date,
                timeline=timeline_text,
                daily_cost=round(day.day_cost_estimate, 2),
            ))

        return TripSummary(
            total_days=len(itinerary),
            total_places=total_places,
            total_cost=round(total_cost, 2),
            total_distance=round(total_dist, 2),
            days=day_summaries,
        )
