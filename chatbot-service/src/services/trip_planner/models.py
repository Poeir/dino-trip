from __future__ import annotations
from typing import List, Optional, Any, Dict
from pydantic import BaseModel


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
    hours: Optional[str] = None
    hours_periods: Optional[List[Dict[str, Any]]] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    maps_url: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    description: Optional[str] = None
    amenities: List[str] = []
    tags: List[str] = []
    img: Optional[str] = None

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


class TripInput(BaseModel):
    trip_duration_days: int
    start_date: str
    accommodation_name: str
    must_go: List[str] = []
    interests: List[str] = []
    trip_pace: str = "relaxed"  # relaxed | standard | packed
    budget_level: str = "ปานกลาง"  # ประหยัด | ปานกลาง | หรูหรา -- matches the frontend's budgetList directly
    start_time: str = "09:00"
    end_time: str = "18:00"


class TimeSlot(BaseModel):
    place: Place
    arrival_time: str
    departure_time: str
    travel_time_min: int
    distance_km: float
    status: str = "Open"  # Open, Closed, Waiting, Free Time, End of Day...
    wait_time_min: int = 0


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
