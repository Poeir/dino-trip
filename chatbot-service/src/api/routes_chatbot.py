import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from src.services.chatbot.agent import RAGChatbotService

router = APIRouter(prefix="/chat", tags=["Chatbot"])
chatbot_service = RAGChatbotService()


class HistoryMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    # Prior turns, oldest first. The server is stateless -- the client owns
    # the conversation. Sanitized/truncated in agent.clean_history.
    history: list[HistoryMessage] = Field(default_factory=list, max_length=50)


@router.post("/")
def chat_endpoint(request: ChatRequest):
    """Server-Sent Events stream: a `token` event per chunk of the reply as
    it's generated, then one final `done` event carrying the full reply text
    and the source `places` (withheld until the end -- see
    RAGChatbotService.chat_stream)."""

    def event_stream():
        for event in chatbot_service.chat_stream(
            user_message=request.message,
            history=[m.model_dump() for m in request.history],
        ):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
