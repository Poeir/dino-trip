import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from src.services.chatbot.agent import RAGChatbotService

router = APIRouter(prefix="/chat", tags=["Chatbot"])
chatbot_service = RAGChatbotService()


# The server keeps only the last few turns and truncates each (agent.clean_history),
# so these only bound what a request may *carry*: well above what is kept (the
# frontend sends 4 turns of at most 2,000 chars), well below a multi-MB body.
MAX_HISTORY_ITEMS = 10
MAX_HISTORY_CONTENT_CHARS = 5000


class HistoryMessage(BaseModel):
    role: str = Field(max_length=20)
    content: str = Field(max_length=MAX_HISTORY_CONTENT_CHARS)


# Real questions top out around ~50 chars. Without a cap one request could carry
# an arbitrarily large prompt (rewrite + embedding + answer all see it) and the
# rate limiter counts requests, not tokens -- on Vertex that is billed per token.
MAX_MESSAGE_CHARS = 500


class ChatRequest(BaseModel):
    message: str = Field(max_length=MAX_MESSAGE_CHARS)
    # Prior turns, oldest first. The server is stateless -- the client owns
    # the conversation. Sanitized/truncated in agent.clean_history.
    history: list[HistoryMessage] = Field(default_factory=list, max_length=MAX_HISTORY_ITEMS)


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
            # `usage` (token counts, cost, model) is for logs/usage.jsonl; the
            # browser has no use for it and shouldn't see what a turn costs.
            event = {k: v for k, v in event.items() if k != "usage"}
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
