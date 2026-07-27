import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.api.routes_chatbot import router as chatbot_router
from src.api.routes_tripplanner import router as tripplanner_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(title="Khon Kaen AI Trip Planner")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chatbot_router)
app.include_router(tripplanner_router)


@app.get("/")
def read_root():
    return {"message": "Welcome to Khon Kaen Trip API! ไปที่ /docs เพื่อดูวิธีใช้งาน"}
