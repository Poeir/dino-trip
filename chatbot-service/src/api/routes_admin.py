import logging

from fastapi import APIRouter, HTTPException

from src.services.rag import embedder

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])

# Not auth-gated here -- the Node backend's /api/reindex proxy (see
# backend/src/routes/reindex.routes.js) is what enforces requireAdmin before
# ever reaching this service. This endpoint isn't meant to be called directly
# from the browser.


@router.post("/reindex")
def trigger_reindex():
    started = embedder.start_reindex(only_pending=True)
    if not started:
        raise HTTPException(status_code=409, detail="กำลังรัน embedding อยู่แล้ว รอให้เสร็จก่อน")
    return embedder.get_status()


@router.get("/reindex/status")
def reindex_status():
    return embedder.get_status()
