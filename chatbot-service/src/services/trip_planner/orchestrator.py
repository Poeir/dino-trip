from datetime import datetime
from itertools import zip_longest
from src.core.db import find_place_by_name
from src.services.rag.retriever import PlaceRetriever
from .models import Place, TripInput, TripSummary, DaySummary

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
    def __init__(self):
        self.retriever = PlaceRetriever()

    def build_candidate_list(self, user_input: TripInput):
        accommodation_row = find_place_by_name(user_input.accommodation_name)
        if accommodation_row:
            accommodation = Place(**accommodation_row)
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
        for name in user_input.must_go:
            row = find_place_by_name(name)
            if row:
                must_go_list.append(Place(**row))
            else:
                missing_must_go.append(name)

        start_dt = datetime.strptime(user_input.start_time, "%H:%M")
        end_dt = datetime.strptime(user_input.end_time, "%H:%M")
        total_trip_hours = (end_dt - start_dt).seconds / 3600

        if user_input.trip_pace == "relaxed":
            places_per_day = max(3, int(total_trip_hours / 2.5))
        elif user_input.trip_pace == "packed":
            places_per_day = max(5, int(total_trip_hours / 1.5))
        else:
            places_per_day = max(4, int(total_trip_hours / 2.0))

        total_slots = places_per_day * user_input.trip_duration_days
        remaining_slots = total_slots - len(must_go_list)

        interest_list = []
        if remaining_slots > 0:
            if user_input.interests:
                # One retrieval call PER interest, then round-robin merge --
                # not one call on ", ".join(interests). Regression: a single
                # combined query let an interest with many real matches (e.g.
                # 140 temples for "วัฒนธรรม/ศาสนา") drown out one with few (3
                # spots for "ไดโนเสาร์") in the top-N ranking, even though the
                # small interest had exact tag matches -- confirmed live: the
                # 3 dinosaur places never appeared in a combined-query
                # candidate list, but all 3 appeared when queried alone.
                # Round-robin (index 0 of every interest, then index 1, ...)
                # guarantees each stated interest gets a fair shot at a slot
                # before any single interest's larger result count crowds out
                # the rest.
                per_interest_results = [
                    self.retriever.search_and_expand(query=interest, limit=remaining_slots * 5)
                    for interest in user_input.interests
                ]
                rag_results = [
                    row for group in zip_longest(*per_interest_results) for row in group if row is not None
                ]
            else:
                rag_results = self.retriever.search_and_expand(
                    query="สถานที่ท่องเที่ยวยอดนิยม ขอนแก่น", limit=remaining_slots * 5
                )

            existing_ids = {p.id for p in must_go_list}
            allowed_prices = BUDGET_PRICE_RANGES.get(user_input.budget_level, [0, 1, 2])

            for row in rag_results:
                place_id = row.get("id")
                if not place_id or place_id in existing_ids:
                    continue
                place = Place(**row)
                # price_level is null for most of this dataset (Google didn't
                # return it) -- treat unknown as acceptable rather than
                # excluding it, or budget filtering would return almost nothing.
                if place.price_level is not None and place.price_level not in allowed_prices:
                    continue
                if place.category == "ที่พัก":
                    continue
                # Only applies to RAG-sourced candidates, same as the budget
                # filter above -- must_go places are honored regardless of
                # district. Rows without a district tag (place.district is
                # None) are excluded here: don't show a place as "in the
                # city" when we're not actually sure.
                if user_input.area_scope == "เมือง" and not _is_mueang_district(place.district):
                    continue
                interest_list.append(place)
                existing_ids.add(place_id)
                if len(interest_list) >= remaining_slots:
                    break

        return accommodation, must_go_list + interest_list, missing_must_go

    def get_dynamic_instructions(self, user_input: TripInput):
        pace_instruction = {
            "relaxed": "- PACE (Relaxed): Schedule a slow-paced trip. Leave plenty of free time between activities. If there is a time gap > 45 mins, explicitly add '☕ พักผ่อนตามอัธยาศัย'. Do NOT pack too many places into one day.",
            "packed": "- PACE (Packed): Schedule a fast-paced trip. Maximize the number of places visited. Minimize idle time and schedule activities back-to-back.",
        }.get(
            user_input.trip_pace,
            "- PACE (Standard): Balance activity time and rest. A moderate schedule is fine.",
        )

        budget_instruction = {
            "ประหยัด": "- BUDGET (Economy): STRICTLY group places that are in the same area/zone together to minimize driving distance and save fuel costs. Prioritize free or cheap places.",
            "หรูหรา": "- BUDGET (Luxury): IGNORE travel distance and fuel costs entirely. Focus ONLY on providing the most premium, high-end, and exclusive experiences, even if they are far apart.",
        }.get(
            user_input.budget_level,
            "- BUDGET (Standard): Balance the driving distance and the quality of the places. A moderate amount of driving is acceptable.",
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
