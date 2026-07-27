import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Literal, Optional
from src.services.chatbot.agent import RAGChatbotService

router = APIRouter(prefix="/chat", tags=["Chatbot"])
chatbot_service = RAGChatbotService()


class ChatMessage(BaseModel):
    # Restricted to the two roles the frontend legitimately sends -- a free
    # `role: str` let a client plant a fake "system" message into `history`,
    # which sat right next to the real system prompt in the messages array
    # and got the LLM to dump it verbatim (confirmed by testing).
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []


@router.post("/")
def chat_endpoint(request: ChatRequest):
    """Server-Sent Events stream: a `token` event per chunk of the reply as
    it's generated, then one final `done` event carrying the full reply text
    and the source `places` (withheld until the end -- see
    RAGChatbotService.chat_stream)."""
    history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]

    def event_stream():
        for event in chatbot_service.chat_stream(user_message=request.message, history=history_dicts):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
