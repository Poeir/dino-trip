import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.core.db import supabase
from src.services.place_classify import classify_place
from src.services.place_description import ModelChain, generate_description
from src.services.rag import embedder

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])

# Not auth-gated here -- the Node backend's proxies (see
# backend/src/routes/reindex.routes.js and places.routes.js's /describe) are
# what enforce requireAdmin before ever reaching this service. These endpoints
# aren't meant to be called directly from the browser.


@router.post("/reindex")
def trigger_reindex():
    started = embedder.start_reindex(only_pending=True)
    if not started:
        raise HTTPException(status_code=409, detail="กำลังรัน embedding อยู่แล้ว รอให้เสร็จก่อน")
    return embedder.get_status()


@router.get("/reindex/status")
def reindex_status():
    return embedder.get_status()


@router.get("/reindex/pending")
def reindex_pending():
    return embedder.get_pending_items()


class DescribePlaceRequest(BaseModel):
    # Form values win over the DB row's: the admin may have edited the name,
    # tags or amenities without saving yet. `placeId` only adds what the form
    # doesn't have (Google reviews, rating, district).
    placeId: Optional[str] = None
    name: str = Field(max_length=200)
    category: str = Field(max_length=100)
    district: Optional[str] = Field(default=None, max_length=100)
    tags: List[str] = Field(default_factory=list, max_length=30)
    amenities: List[str] = Field(default_factory=list, max_length=50)


@router.post("/places/describe")
def describe_place(req: DescribePlaceRequest):
    name, category = req.name.strip(), req.category.strip()
    if not name or not category:
        raise HTTPException(status_code=400, detail="ต้องมีชื่อและหมวดหมู่สถานที่")

    place = {
        "name": name,
        "category": category,
        "district": (req.district or "").strip() or None,
        "tags": [t.strip() for t in req.tags if t.strip()],
        "amenities": [a.strip() for a in req.amenities if a.strip()],
        "rating": None,
        "review_count": 0,
        "reviews": [],
    }

    if req.placeId:
        try:
            rows = (
                supabase.table("places")
                .select("district, rating, review_count, reviews")
                .eq("id", req.placeId)
                .limit(1)
                .execute()
                .data
            )
        except Exception as e:
            logger.error("describe: loading place %s failed: %s", req.placeId, e)
            raise HTTPException(status_code=502, detail="โหลดข้อมูลสถานที่ไม่สำเร็จ")
        if rows:
            row = rows[0]
            place["district"] = place["district"] or row.get("district")
            place["rating"] = row.get("rating")
            place["review_count"] = row.get("review_count") or 0
            place["reviews"] = row.get("reviews") or []

    # Fresh chain per request: a daily-limit fallback must not outlive the day.
    return generate_description(place, ModelChain())


class ClassifyPlaceRequest(BaseModel):
    # Built by backend/src/services/placeClassify.js from the place's Google data.
    name: str = Field(max_length=200)
    fixedCategory: Optional[str] = Field(default=None, max_length=100)
    primaryType: Optional[str] = Field(default=None, max_length=100)
    types: List[str] = Field(default_factory=list, max_length=40)
    summary: Optional[str] = Field(default=None, max_length=2000)
    reviews: List[str] = Field(default_factory=list, max_length=5)


@router.post("/places/classify")
def classify_place_route(req: ClassifyPlaceRequest):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="ต้องมีชื่อสถานที่")
    place = {
        "name": req.name.strip(), "primaryType": req.primaryType, "types": req.types,
        "summary": req.summary, "reviews": req.reviews,
    }
    try:
        return classify_place(place, req.fixedCategory)
    except Exception as e:  # noqa: BLE001 -- quota/network/bad JSON: the import goes on without it
        logger.error("classify failed for %r: %s", req.name, e)
        raise HTTPException(status_code=502, detail="AI จัดหมวดไม่สำเร็จ")
