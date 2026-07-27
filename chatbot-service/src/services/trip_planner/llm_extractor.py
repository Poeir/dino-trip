import json
import logging
import math
import time
from datetime import datetime, timedelta
from openai import OpenAI
from typing import List
from src.core.config import API_KEY, BASE_URL, MODEL_NAME
from .models import Place, TripInput, DailyItinerary, TimeSlot

logger = logging.getLogger(__name__)

# Category-based visit durations, keyed by our normalized Thai categories
# instead of Google's raw type slugs (place_of_worship, museum, ...) -- we
# only keep one broad category per place, not the full types[] list the old
# project had.
TYPE_DURATION_MAP = {
    "พิพิธภัณฑ์": 90, "วัด": 45, "สวนสาธารณะ": 60,
    "ตลาด": 120, "ร้านอาหาร": 60, "คาเฟ่": 45, "สถานที่ท่องเที่ยว": 60,
}

BUFFET_KEYWORDS = ["หมูกระทะ", "ปิ้งย่าง", "บุฟเฟต์", "สุกี้", "ตี๋น้อย", "buffet", "barbecue", "bbq"]
EVENING_KEYWORDS = ["หมูกระทะ", "ปิ้งย่าง", "บุฟเฟต์", "สุกี้", "ตี๋น้อย", "บาร์", "ตลาดกลางคืน"]
PRICE_MAP = {0: 0, 1: 150, 2: 400, 3: 800, 4: 1500}


class LLMTripPlanner:
    def __init__(self, candidates: List[Place], start_point: Place = None):
        self.candidates = candidates
        self.start_point = start_point
        self.location_map = {loc.id: loc for loc in candidates}
        self.default_model = MODEL_NAME
        self.client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

    def calculate_distance(self, loc1: Place, loc2: Place) -> float:
        R = 6371
        dlat = math.radians(loc2.latitude - loc1.latitude)
        dlon = math.radians(loc2.longitude - loc1.longitude)
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(loc1.latitude)) * math.cos(math.radians(loc2.latitude)) * math.sin(dlon / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c

    def get_visit_duration(self, loc: Place, pace: str) -> int:
        name_lower = loc.name.lower()
        if any(kw in name_lower for kw in BUFFET_KEYWORDS):
            return 120

        base_duration = TYPE_DURATION_MAP.get(loc.category, 60)

        if pace == "relaxed":
            return base_duration + 30
        elif pace == "packed":
            return max(30, base_duration - 15)
        return base_duration

    def check_is_open(self, loc: Place, arrival_dt: datetime) -> dict:
        """Check whether `loc` is open at `arrival_dt`. Needs the raw Google
        `periods` data (places.hours_periods) -- `loc.hours` is only a
        formatted display string, not usable for this."""
        if not loc.hours_periods:
            return {"is_open": True, "wait_min": 0, "status": "Open (No Data)"}

        # Google Maps: 0=Sunday, 1=Monday... | Python: 0=Monday, 6=Sunday
        google_day = (arrival_dt.weekday() + 1) % 7
        arrival_minutes = arrival_dt.hour * 60 + arrival_dt.minute

        today_periods = [p for p in loc.hours_periods if p["open"]["day"] == google_day]
        if not today_periods:
            return {"is_open": False, "wait_min": 0, "status": "Closed Today"}

        for p in today_periods:
            open_min = p["open"]["hour"] * 60 + p["open"]["minute"]
            if "close" in p and p["close"]["day"] == google_day:
                close_min = p["close"]["hour"] * 60 + p["close"]["minute"]
                if open_min <= arrival_minutes < close_min:
                    return {"is_open": True, "wait_min": 0, "status": "Open"}
                elif arrival_minutes < open_min:
                    return {"is_open": False, "wait_min": open_min - arrival_minutes, "status": "Waiting"}
            else:
                # Overnight hours (closes after midnight, on the following day).
                if arrival_minutes >= open_min:
                    return {"is_open": True, "wait_min": 0, "status": "Open"}
                else:
                    return {"is_open": False, "wait_min": open_min - arrival_minutes, "status": "Waiting"}

        return {"is_open": False, "wait_min": 0, "status": "Closed"}

    def is_evening_place(self, loc: Place) -> bool:
        name_lower = loc.name.lower()
        return any(kw in name_lower for kw in EVENING_KEYWORDS)

    def generate_prompt(self, user_input: TripInput, pace_instruction: str, budget_instruction: str) -> str:
        places_str = "".join(
            f"- ID: {loc.id}, Name: {loc.name}, Category: {loc.category}, Rating: {loc.rating}, Hours: {loc.hours or 'unknown'}\n"
            for loc in self.candidates
        )

        trip_start_date = datetime.strptime(user_input.start_date, "%Y-%m-%d")
        day_dates_str = ", ".join(
            f"Day {i + 1} = {(trip_start_date + timedelta(days=i)).strftime('%Y-%m-%d (%A)')}"
            for i in range(user_input.trip_duration_days)
        )

        return f"""
        You are a proficient travel planner. Based on the provided candidate locations and the user query, please create a detailed travel plan.

        [USER QUERY]
        - Duration: {user_input.trip_duration_days} days
        - Pace: {user_input.trip_pace}
        - Budget: {user_input.budget_level}
        - Interests: {', '.join(user_input.interests)}
        - Must Go: {', '.join(user_input.must_go)}
        - Start: {user_input.start_time}, End: {user_input.end_time}
        - Calendar dates per day: {day_dates_str}

        [DYNAMIC CONSTRAINTS]
        {pace_instruction}
        {budget_instruction}

        [PROVIDED DATA - CANDIDATE LOCATIONS]
        {places_str}

        [STRICT RULES]
        1. All the information in your plan (especially place_id) MUST be derived ONLY from the PROVIDED DATA above. Do not invent places.
        2. Output STRICTLY in JSON format. Do not write any other text.
        3. Align with commonsense: Do not put heavy restaurants back-to-back. Mix attractions, cafes, and restaurants logically.
        4. Do not include "Accommodation/Hotels" in the schedule! Only include tourist attractions, cafes, and restaurants. The system will calculate the return trip to your accommodation automatically.
        5. No place's arrival_time may be at or after the End time ({user_input.end_time}). If the Start-End window is too short for a place, schedule fewer places that day rather than running past End.
        6. Each place's Hours field tells you which days/times it's open -- use the Calendar dates per day above to check the actual weekday, and do not schedule a place on a day/time it's closed.

        [EXAMPLE JSON OUTPUT FORMAT]
        {{
            "itinerary": [
                {{
                    "day": 1,
                    "schedule": [
                        {{
                            "place_id": "ID_FROM_LIST",
                            "arrival_time": "HH:MM",
                            "departure_time": "HH:MM"
                        }}
                    ]
                }}
            ]
        }}
        """

    def clean_json_string(self, json_str: str) -> str:
        json_str = json_str.strip()
        if json_str.startswith("```json"):
            json_str = json_str[7:]
        elif json_str.startswith("```"):
            json_str = json_str[3:]
        if json_str.endswith("```"):
            json_str = json_str[:-3]
        return json_str.strip()

    def _call_llm_for_itinerary(self, prompt: str) -> dict:
        response = self.client.chat.completions.create(
            model=self.default_model,
            messages=[
                {"role": "system", "content": "You are a helpful travel assistant. Output JSON only."},
                {"role": "user", "content": prompt},
            ],
            stream=False,
            # Low temperature + JSON mode: this is a structured-output task, not
            # a creative one -- 0.7 was carried over from the old project's
            # free-text chat settings and made malformed JSON (which we
            # deliberately don't fall back on, see routes_tripplanner.py) more
            # likely than it needed to be.
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        return json.loads(self.clean_json_string(content))

    def solve_route_with_llm(self, user_input: TripInput, pace_instruction: str, budget_instruction: str) -> List[DailyItinerary]:
        prompt = self.generate_prompt(user_input, pace_instruction, budget_instruction)

        t0 = time.time()
        data = None
        last_err = None
        for attempt in (1, 2):
            try:
                data = self._call_llm_for_itinerary(prompt)
                break
            except Exception as e:
                last_err = e
                logger.warning("trip planner LLM call/parse failed (attempt %d/2): %s", attempt, e)
        if data is None:
            logger.error("trip planner LLM failed after retry, giving up: %s", last_err)
            raise last_err
        logger.info("trip planner LLM responded in %.2fs (days=%d)", time.time() - t0, user_input.trip_duration_days)

        # check_is_open() keys off current_dt.weekday(), so each day of a
        # multi-day trip needs its own real calendar date -- using bare
        # start_time (defaults to 1900-01-01, always a Monday) made every
        # day of the trip get checked against Monday's opening hours.
        trip_start_date = datetime.strptime(user_input.start_date, "%Y-%m-%d")
        start_time_of_day = datetime.strptime(user_input.start_time, "%H:%M").time()
        end_time_of_day = datetime.strptime(user_input.end_time, "%H:%M").time()

        final_itinerary = []
        for day_data in data.get("itinerary", []):
            day_num = day_data["day"]
            schedule = []
            current_loc = self.start_point
            day_cost = 0.0
            day_travel = 0
            day_date = (trip_start_date + timedelta(days=day_num - 1)).date()
            current_dt = datetime.combine(day_date, start_time_of_day)
            end_dt_bound = datetime.combine(day_date, end_time_of_day)

            for slot in day_data["schedule"]:
                # Deterministic backstop for [STRICT RULES] #5 above -- the
                # LLM is asked not to run past End time, but isn't always
                # reliable about it, so stop adding stops here too rather
                # than trusting the model alone.
                if current_dt >= end_dt_bound:
                    break

                loc_id = slot["place_id"]
                if loc_id not in self.location_map:
                    continue
                dest = self.location_map[loc_id]

                dist = 0.0
                travel_min = 0
                if current_loc:
                    dist = self.calculate_distance(current_loc, dest)
                    travel_min = int((dist / 30.0) * 60)  # assume 30 km/h average driving speed

                arrival_at_door = current_dt + timedelta(minutes=travel_min)
                open_info = self.check_is_open(dest, arrival_at_door)

                # Deterministic backstop for STRICT RULES #6 -- the LLM is
                # asked not to schedule closed places, but isn't always
                # reliable about it. "Waiting" (opens later today) is still
                # worth visiting; "Closed"/"Closed Today" never will be, so
                # drop the stop instead of showing the user a doomed visit.
                if open_info["status"] in ("Closed", "Closed Today"):
                    logger.info("trip planner: dropping %s, %s at %s", dest.name, open_info["status"], arrival_at_door)
                    continue

                gap_minutes = 0

                if open_info["status"] == "Waiting":
                    gap_minutes = open_info["wait_min"]
                elif self.is_evening_place(dest) and arrival_at_door.hour < 17:
                    # No opening-hours data but it's clearly an evening spot -- assume 17:00.
                    target_dt = arrival_at_door.replace(hour=17, minute=0, second=0)
                    gap_minutes = int((target_dt - arrival_at_door).total_seconds() / 60)

                wait_min = 0
                if gap_minutes > 45:
                    dummy_loc = Place(
                        id="free_time_dummy",
                        name="☕ พักผ่อนตามอัธยาศัย / แวะเดินเล่นชิลๆ",
                        category=None,
                        rating=0.0,
                        lat=current_loc.latitude if current_loc else dest.latitude,
                        lng=current_loc.longitude if current_loc else dest.longitude,
                    )
                    free_departure = current_dt + timedelta(minutes=gap_minutes)
                    schedule.append(TimeSlot(
                        place=dummy_loc,
                        arrival_time=current_dt.strftime("%H:%M"),
                        departure_time=free_departure.strftime("%H:%M"),
                        travel_time_min=0, distance_km=0.0,
                        status="Free Time", wait_time_min=0,
                    ))
                    current_dt = free_departure
                    arrival_at_door = current_dt + timedelta(minutes=travel_min)
                    open_info = self.check_is_open(dest, arrival_at_door)
                    wait_min = open_info["wait_min"] if open_info["status"] == "Waiting" else 0
                else:
                    wait_min = gap_minutes

                start_activity_dt = arrival_at_door + timedelta(minutes=wait_min)
                visit_min = self.get_visit_duration(dest, user_input.trip_pace)
                departure_dt = start_activity_dt + timedelta(minutes=visit_min)

                schedule.append(TimeSlot(
                    place=dest,
                    arrival_time=arrival_at_door.strftime("%H:%M"),
                    departure_time=departure_dt.strftime("%H:%M"),
                    travel_time_min=travel_min,
                    distance_km=round(dist, 2),
                    status=open_info["status"] if wait_min == 0 else "Waiting",
                    wait_time_min=wait_min,
                ))

                fuel_cost = dist * 4.0  # 4 THB/km
                if dest.price_level is not None:
                    place_cost = PRICE_MAP.get(dest.price_level, 150)
                elif dest.category in ("ร้านอาหาร", "คาเฟ่"):
                    place_cost = 250
                elif dest.category == "ตลาด":
                    place_cost = 300
                elif dest.category in ("วัด", "สวนสาธารณะ", "พิพิธภัณฑ์"):
                    place_cost = 0
                else:
                    place_cost = 100

                day_cost += fuel_cost + place_cost
                day_travel += travel_min
                current_loc = dest
                current_dt = departure_dt

            if day_num < user_input.trip_duration_days and current_loc and self.start_point:
                dist = self.calculate_distance(current_loc, self.start_point)
                travel_min = int((dist / 30.0) * 60)
                arrival_at_hotel = current_dt + timedelta(minutes=travel_min)
                schedule.append(TimeSlot(
                    place=self.start_point,
                    arrival_time=arrival_at_hotel.strftime("%H:%M"),
                    departure_time=arrival_at_hotel.strftime("%H:%M"),
                    travel_time_min=travel_min, distance_km=round(dist, 2),
                    status="End of Day (Return to Hotel)", wait_time_min=0,
                ))
                day_cost += dist * 4.0
                day_travel += travel_min

            final_itinerary.append(DailyItinerary(
                day=day_num, date=day_date.strftime("%Y-%m-%d"),
                schedule=schedule,
                day_cost_estimate=round(day_cost, 2),
                day_travel_time_total=day_travel,
            ))

        return final_itinerary
