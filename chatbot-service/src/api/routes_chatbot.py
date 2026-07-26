from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from src.services.chatbot.agent import RAGChatbotService

router = APIRouter(prefix="/chat", tags=["Chatbot"])
chatbot_service = RAGChatbotService()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []


class ChatResponse(BaseModel):
    reply: str
    places: List[Dict[str, Any]] = []


@router.post("/", response_model=ChatResponse)
def chat_endpoint(request: ChatRequest):
    history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
    result = chatbot_service.chat(user_message=request.message, history=history_dicts)
    return ChatResponse(reply=result["reply"], places=result.get("places", []))
