from __future__ import annotations
from datetime import datetime
from typing import Annotated, List, Optional, Any, Dict
from pydantic import BaseModel, Field, field_validator, model_validator


class Place(BaseModel):
    """Flat model matching the Postgres `places` table directly -- the old
    project's nested core/contact/address/openingHours/media/features/extra
    "DinoDB" shape doesn't apply anymore now that MongoDB is gone."""
    id: str
    name: str
    category: Optional[str] = None
    rating: Optional[float] = 0.0
    review_count: Optional[int] = 0
    price: Optional[str] = None
    price_level: Optional[int] = None
    address: Optional[str] = None
    subcategory: Optional[str] = None  # ร้านอาหาร/คาเฟ่ sub-type (backend lib/placeSubcategory.js); drives food_preferences
    district: Optional[str] = None  # Google administrative_area_level_2, e.g. "เมืองขอนแก่น" (see import-places.js's mapDistrict())
    hours: Optional[str] = None
    hours_periods: Optional[List[Dict[str, Any]]] = None
    # Google's operating status: OPERATIONAL / CLOSED_TEMPORARILY /
    # CLOSED_PERMANENTLY (see backend's 20260728000006_add_business_status.sql
    # migration) -- route_scheduler.check_is_open()/find_anchor_window()
    # treat CLOSED_TEMPORARILY/CLOSED_PERMANENTLY as closed regardless of
    # hours_periods, since a place that's shut down doesn't become open again
    # just because its scraped weekly hours still say otherwise.
    business_status: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    maps_url: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    description: Optional[str] = None
    amenities: List[str] = []
    tags: List[str] = []
    img: Optional[str] = None
    # Admin-set time of day for a "ตลาด" row: morning / evening / all_day
    # (places.market_time). None = not labelled; route_scheduler.market_kind
    # then falls back to opening hours and the name.
    market_time: Optional[str] = None
    # Not a DB column. True for a place from the orchestrator's spare pool:
    # nobody asked for it (not an interest match, never shown to the LLM), it
    # only fills dead time under stricter rules -- see route_scheduler's
    # MAX_SPARE_STOPS_PER_DAY / auto_add_time_ok.
    is_spare: bool = False

    class Config:
        extra = "ignore"  # ignore extra columns we don't model here (source, google_place_id, has_qr, ...)

    @property
    def latitude(self) -> float:
        return self.lat or 0.0

    @property
    def longitude(self) -> float:
        return self.lng or 0.0

    @property
    def types(self) -> List[str]:
        """Single-item list so the (originally Google-types-list-oriented)
        scheduling heuristics in llm_extractor.py still work unchanged --
        we only have one normalized category per place, not a type list."""
        return [self.category] if self.category else []


# The values the trip form sends (frontend AppContext paceList, seed.js
# budgetList / areaScopeList). Anything else used to be accepted and silently
# treated as the default.
TRIP_PACES = ("relaxed", "standard", "packed")
BUDGET_LEVELS = ("ประหยัด", "ปานกลาง", "หรูหรา")
AREA_SCOPES = ("เมือง", "ทั่วขอนแก่น")

# The trip form's "อยากกินอะไร" choices (frontend seed.js foodPreferenceList)
# -> (category, places.subcategory) they select. Restaurant ones steer the
# day's lunch/dinner; the bakery one steers which cafes are offered.
FOOD_PREFERENCES = {
    "อาหารอีสาน": ("ร้านอาหาร", "อาหารอีสาน"),
    "ปิ้งย่าง/ชาบู": ("ร้านอาหาร", "ปิ้งย่าง/ชาบู"),
    "ญี่ปุ่น/เกาหลี": ("ร้านอาหาร", "ญี่ปุ่น/เกาหลี"),
    "ก๋วยเตี๋ยว": ("ร้านอาหาร", "ก๋วยเตี๋ยว"),
    # Special: adds a breakfast meal to every day that starts early enough
    # (route_scheduler.day_meals), served by a breakfast shop.
    "อาหารเช้า": ("ร้านอาหาร", "อาหารเช้า"),
    "เวียดนาม": ("ร้านอาหาร", "เวียดนาม"),
    "เบเกอรี่/ของหวาน": ("คาเฟ่", "เบเกอรี่/ของหวาน"),
}
# Was an interest until 2026-10-21; old clients and saved trips still send it.
LEGACY_LOCAL_FOOD_INTEREST = "อาหารพื้นถิ่น"
BREAKFAST_PREFERENCE = "อาหารเช้า"


def meal_food_kinds(food_preferences) -> List[str]:
    """Restaurant subcategories wanted at lunch/dinner (breakfast is its own meal)."""
    return [
        FOOD_PREFERENCES[p][1] for p in food_preferences
        if FOOD_PREFERENCES[p][0] == "ร้านอาหาร" and p != BREAKFAST_PREFERENCE
    ]


# Where the trip's last day ends when it isn't the accommodation (the trip
# form's "วันสุดท้ายจบที่"): a transport hub (coordinates in trip_ends.py), an
# อำเภอ (centre worked out from `places`), or a pin. See trip_ends.py.
TRIP_END_KINDS = ("airport", "bus", "train", "district", "pin")


class TripEnd(BaseModel):
    kind: str = Field(max_length=20)
    # อำเภอ name for "district" (as in places.district, e.g. "ชุมแพ"); a label
    # for "pin". Ignored for the hubs, which have their own names.
    name: Optional[str] = Field(default=None, max_length=200)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    # Departure time (flight / bus / train) or, for a district/pin, when to be
    # there. None = the day's normal end_time.
    time: Optional[str] = Field(default=None, max_length=10)

    @field_validator("kind")
    @classmethod
    def _known_kind(cls, value: str) -> str:
        if value not in TRIP_END_KINDS:
            raise ValueError(f"trip_end.kind must be one of {TRIP_END_KINDS}")
        return value

    @field_validator("time")
    @classmethod
    def _is_a_time(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            try:
                datetime.strptime(value, "%H:%M")
            except ValueError:
                raise ValueError("trip_end.time must be HH:MM")
        return value

    @model_validator(mode="after")
    def _has_a_location(self) -> "TripEnd":
        if self.kind == "pin" and (self.lat is None or self.lng is None):
            raise ValueError("trip_end of kind 'pin' needs lat and lng")
        if self.kind == "district" and not (self.name or "").strip():
            raise ValueError("trip_end of kind 'district' needs a name")
        return self


class TripInput(BaseModel):
    # Field caps exist because this endpoint is public and these values are
    # interpolated into the LLM prompt (billed per token). The frontend already
    # limits trips to 7 days; the server cap is looser so it never rejects a
    # legitimate request, only abuse.
    # The form offers 1-5 days (frontend seed.js MAX_TRIP_DAYS); a 5-day plan
    # already takes ~90 s. 7 leaves slack for saved/older requests.
    trip_duration_days: int = Field(ge=1, le=7)
    start_date: str = Field(max_length=10)
    accommodation_name: str = Field(max_length=200)
    # Real coordinates from the frontend's Google Maps search (LocationPicker)
    # or the browser's geolocation -- when present, orchestrator.py prefers
    # these over find_place_by_name()'s name-matching against the curated
    # `places` table, which real accommodations (not tourist attractions)
    # almost never match, silently falling back to a hardcoded city-center
    # point. None for both (old clients, or nothing picked) keeps that old
    # fallback behavior unchanged.
    accommodation_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    accommodation_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    must_go: List[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=30)
    interests: List[Annotated[str, Field(max_length=100)]] = Field(default_factory=list, max_length=30)
    # Kinds of food wanted at meals (keys of FOOD_PREFERENCES); empty = no preference.
    food_preferences: List[Annotated[str, Field(max_length=50)]] = Field(default_factory=list, max_length=len(FOOD_PREFERENCES))
    trip_pace: str = Field(default="relaxed", max_length=30)  # relaxed | standard | packed
    budget_level: str = Field(default="ปานกลาง", max_length=30)  # ประหยัด | ปานกลาง | หรูหรา -- matches the frontend's budgetList directly
    area_scope: str = Field(default="ทั่วขอนแก่น", max_length=30)  # เมือง | ทั่วขอนแก่น -- matches the frontend's areaScopeList directly
    start_time: str = Field(default="09:00", max_length=10)
    end_time: str = Field(default="18:00", max_length=10)
    # None = the last day ends back at the accommodation, like every other day.
    trip_end: Optional[TripEnd] = None

    # Everything below is parsed with strptime further down (orchestrator,
    # llm_extractor): a malformed value used to surface there as a 500, and an
    # end time at or before the start as a trip with no stops in it. Rejected
    # here instead, as a 422 before any retrieval or LLM call is made.
    @field_validator("start_date")
    @classmethod
    def _is_a_date(cls, value: str) -> str:
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            raise ValueError("start_date must be YYYY-MM-DD")
        return value

    @field_validator("start_time", "end_time")
    @classmethod
    def _is_a_time(cls, value: str) -> str:
        try:
            datetime.strptime(value, "%H:%M")
        except ValueError:
            raise ValueError("must be HH:MM")
        return value

    @field_validator("trip_pace")
    @classmethod
    def _known_pace(cls, value: str) -> str:
        if value not in TRIP_PACES:
            raise ValueError(f"trip_pace must be one of {TRIP_PACES}")
        return value

    @field_validator("budget_level")
    @classmethod
    def _known_budget(cls, value: str) -> str:
        if value not in BUDGET_LEVELS:
            raise ValueError(f"budget_level must be one of {BUDGET_LEVELS}")
        return value

    @field_validator("area_scope")
    @classmethod
    def _known_area(cls, value: str) -> str:
        if value not in AREA_SCOPES:
            raise ValueError(f"area_scope must be one of {AREA_SCOPES}")
        return value

    @field_validator("food_preferences")
    @classmethod
    def _known_food(cls, value: List[str]) -> List[str]:
        unknown = [v for v in value if v not in FOOD_PREFERENCES]
        if unknown:
            raise ValueError(f"food_preferences must be among {tuple(FOOD_PREFERENCES)}")
        return list(dict.fromkeys(value))

    @model_validator(mode="after")
    def _local_food_interest_moves_to_food(self) -> "TripInput":
        """"อาหารพื้นถิ่น" left the interests for the food choices (as Isan
        food); a request that still sends it as an interest gets that."""
        if LEGACY_LOCAL_FOOD_INTEREST in self.interests:
            self.interests = [i for i in self.interests if i != LEGACY_LOCAL_FOOD_INTEREST]
            if "อาหารอีสาน" not in self.food_preferences:
                self.food_preferences = [*self.food_preferences, "อาหารอีสาน"]
        return self

    @model_validator(mode="after")
    def _day_ends_after_it_starts(self) -> "TripInput":
        if datetime.strptime(self.end_time, "%H:%M") <= datetime.strptime(self.start_time, "%H:%M"):
            raise ValueError("end_time must be later than start_time")
        return self


class TimeSlot(BaseModel):
    place: Place
    arrival_time: str
    departure_time: str
    travel_time_min: int
    distance_km: float
    status: str = "Open"  # Open, Closed, Waiting, Free Time, End of Day...
    wait_time_min: int = 0
    is_anchor: bool = False  # place had a narrow real opening window that day and anchored the schedule around it
    meal_role: Optional[str] = None  # "lunch" | "dinner" | None, for ร้านอาหาร category places
    # Who put this stop in the day (llm_extractor._build_itinerary_from_llm_days):
    # "llm" (the generator's pick), "must_go" (the user's, injected when the
    # LLM left it out), "meal" (a restaurant brought in for a lunch/dinner),
    # "backfill" (an unpicked candidate topping up a short day), "gap_filler"
    # (an unpicked candidate filling idle time), "spare" (the spare pool the
    # LLM never sees). None for the hotel leg and free-time blocks.
    source: Optional[str] = None


class DailyItinerary(BaseModel):
    day: int
    date: str
    schedule: List[TimeSlot]
    day_cost_estimate: float
    day_travel_time_total: int


class DaySummary(BaseModel):
    day: int
    date: str
    timeline: List[str]
    daily_cost: float


class TripSummary(BaseModel):
    total_days: int
    total_places: int
    total_cost: float
    total_distance: float
    days: List[DaySummary]


class TripResponse(BaseModel):
    itinerary: List[DailyItinerary]
    total_distance_km: float
    total_cost_estimate: float
    note: str
    summary: Optional[TripSummary] = None
    planning_rationale: str = ""  # judge's user-facing explanation, "" hides the frontend block
    usage: Optional[dict] = None  # LLM token/cost totals for this trip (src/core/usage.py)


class JudgeVerdict(BaseModel):
    """Internal-only -- never returned from the API as-is (its `rationale`
    field is copied into TripResponse.planning_rationale)."""
    passed: bool              # no "major" issue (see judge.py)
    score: float              # 0.0-1.0, as reported by the judge LLM; for logs and choosing between rounds
    major_issues: int = 0     # issues the judge rated major: a traveller would mind, and other picks could fix
    issues: List[str] = []    # "[major] Day 2: problem" / "[minor] ..."
    feedback: str = ""        # re-injected verbatim into the next generation prompt (model-facing)
    rationale: str = ""       # short Thai, user-facing explanation of the plan's logic (human-facing)
    # True only when evaluate() never got a real verdict from the judge LLM
    # (call/parse exception) and fell back to an unconditional pass. `passed`
    # stays True either way (see judge.py's fail-open rationale), but this
    # flag lets a caller -- or an experiment collecting score/pass-rate data
    # -- tell "the judge said yes" apart from "the judge never actually ran".
    # Conflating the two silently corrupts any pass-rate/score metric.
    judge_call_failed: bool = False
