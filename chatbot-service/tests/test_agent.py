"""Regression tests for RAGChatbotService -- specifically the tag-parsing
logic responsible for real bugs found through live manual testing this
session: place cards leaking onto knowledge_base-only answers, NO_MATCH
replies rendering as an empty chat bubble, and MATCH/NO_MATCH flipping
inconsistently. Extended to cover events once they were wired into
retrieval alongside places/knowledge_base.

The embedding model (loaded at import time by src.services.rag.retriever)
still loads for real -- that's an accepted, already-normal cost in this dev
environment (same as running the app). What's faked out here is the LLM
client and the retriever's DB calls, so these tests are deterministic and
don't depend on live model behavior or network/API availability.
"""
from types import SimpleNamespace

import pytest

from src.services.chatbot.agent import (
    FALLBACK_MESSAGE,
    MATCH_EVENTS_TAG,
    MATCH_KB_TAG,
    MATCH_PLACES_TAG,
    NO_MATCH_TAG,
    SOURCE_EVENTS,
    SOURCE_KB,
    SOURCE_PLACES,
    RAGChatbotService,
    match_tag,
)


def make_place_row(place_id="p1", name="Test Cafe"):
    return {
        "id": place_id, "name": name, "address": "123 Test Rd", "rating": 4.5,
        "img": None, "description": "A cafe", "hours": "9-18", "price": None, "amenities": [],
    }


def make_kb_row(kb_id="k1", title="Test Article"):
    return {"id": kb_id, "title": title, "content": "Some knowledge base content."}


def make_event_row(event_id="e1", name="Test Festival"):
    return {
        "id": event_id, "name": name, "category": "เทศกาล", "venue_name": "Test Hall",
        "date_range": "1-3 ธ.ค.", "admission": "ฟรี", "suitable_for": [], "description": "A festival.", "img": None,
    }


class FakeRetriever:
    """Stands in for PlaceRetriever -- returns canned rows instead of
    hitting Supabase, and records what query text it was called with."""

    def __init__(self, places=None, kb_entries=None, events=None):
        self._places = places if places is not None else [make_place_row()]
        self._kb_entries = kb_entries if kb_entries is not None else []
        self._events = events if events is not None else []
        self.place_queries = []
        self.kb_queries = []
        self.event_queries = []

    def search_and_expand(self, query, limit=5):
        self.place_queries.append(query)
        return self._places

    def search_knowledge_base(self, query, limit=3):
        self.kb_queries.append(query)
        return self._kb_entries

    def search_events(self, query, limit=3):
        self.event_queries.append(query)
        return self._events


def make_response(text):
    """Mimics the OpenAI SDK's non-streaming ChatCompletion shape far enough
    for agent.py's `response.choices[0].message.content` access."""
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


def make_stream(full_text, chunk_size=3):
    """Splits `full_text` into small chunks to mimic real token-by-token
    streaming and specifically stress-test tag-boundary buffering (a tag
    like "[MATCH:PLACES]" arriving split across several chunks)."""
    chunks = [full_text[i:i + chunk_size] for i in range(0, len(full_text), chunk_size)]
    return [SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=c))]) for c in chunks]


class FakeCompletions:
    def __init__(self, response_text=None, stream_text=None):
        self._response_text = response_text
        self._stream_text = stream_text
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs.get("stream"):
            return iter(make_stream(self._stream_text))
        return make_response(self._response_text)


def make_service(response_text=None, stream_text=None, places=None, kb_entries=None, events=None):
    svc = RAGChatbotService()
    svc.retriever = FakeRetriever(places=places, kb_entries=kb_entries, events=events)
    svc.client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions(response_text, stream_text)))
    return svc


class TestChatTagParsing:
    """Non-streaming chat() -- verifies places/events are only attached when
    the tag says that source was actually used."""

    def test_match_places_attaches_places(self):
        svc = make_service(response_text=f"{MATCH_PLACES_TAG} แนะนำร้าน X ครับ")
        result = svc.chat("แนะนำร้านกาแฟ")
        assert result["reply"] == "แนะนำร้าน X ครับ"
        assert len(result["places"]) == 1
        assert result["events"] == []

    def test_match_kb_drops_places_and_events_even_though_retriever_had_some(self):
        # Regression: places used to be attached unconditionally regardless
        # of whether the answer actually drew on them.
        svc = make_service(
            response_text=f"{MATCH_KB_TAG} ขอนแก่นก่อตั้งปี 2340 ครับ",
            events=[make_event_row()],
        )
        result = svc.chat("ประวัติศาสตร์ขอนแก่นเป็นมายังไง")
        assert result["places"] == []
        assert result["events"] == []
        assert "แต่งเติม" not in result["reply"]  # sanity: tag itself stripped from reply

    def test_match_events_attaches_events_only(self):
        svc = make_service(response_text=f"{MATCH_EVENTS_TAG} มีเทศกาล Y จัดสุดสัปดาห์นี้ครับ", events=[make_event_row()])
        result = svc.chat("มีงานเทศกาลอะไรบ้าง")
        assert result["places"] == []
        assert len(result["events"]) == 1

    def test_match_places_and_events_attaches_both(self):
        tag = match_tag(SOURCE_PLACES, SOURCE_EVENTS)
        svc = make_service(response_text=f"{tag} ร้าน X และงานเทศกาล Y ครับ", events=[make_event_row()])
        result = svc.chat("แนะนำร้านกาแฟและงานเทศกาลใกล้ๆ")
        assert len(result["places"]) == 1
        assert len(result["events"]) == 1

    def test_match_all_three_sources_attaches_places_and_events(self):
        tag = match_tag(SOURCE_PLACES, SOURCE_KB, SOURCE_EVENTS)
        svc = make_service(response_text=f"{tag} คำตอบผสมทั้งสามส่วน", events=[make_event_row()])
        result = svc.chat("คำถามผสม")
        assert len(result["places"]) == 1
        assert len(result["events"]) == 1

    def test_no_match_returns_fallback_message_and_no_cards(self):
        svc = make_service(response_text=f"{NO_MATCH_TAG} ไม่เกี่ยวกับขอนแก่นเลย", events=[make_event_row()])
        result = svc.chat("แก้สมการ 2x=4")
        assert result["reply"] == FALLBACK_MESSAGE
        assert result["places"] == []
        assert result["events"] == []

    def test_missing_tag_is_treated_as_a_match_not_dropped(self):
        # Defensive fallback: a model that skips the tag instruction
        # shouldn't have its whole answer silently discarded.
        svc = make_service(response_text="สวัสดีครับ ไม่มีแท็กนำหน้าเลย", events=[make_event_row()])
        result = svc.chat("คำถามอะไรก็ได้")
        assert result["reply"] == "สวัสดีครับ ไม่มีแท็กนำหน้าเลย"
        assert len(result["places"]) == 1
        assert len(result["events"]) == 1


class TestChatStreamTagParsing:
    """Streaming chat_stream() -- same tag semantics as chat(), plus the
    token-buffering logic needed to detect a tag that arrives split across
    several small SSE chunks."""

    def _collect(self, svc, message):
        events = list(svc.chat_stream(message))
        tokens = "".join(e["text"] for e in events if e["type"] == "token")
        done = next(e for e in events if e["type"] == "done")
        return tokens, done

    def test_match_places_streams_tokens_and_attaches_places(self):
        svc = make_service(stream_text=f"{MATCH_PLACES_TAG} แนะนำร้าน X ครับ")
        tokens, done = self._collect(svc, "แนะนำร้านกาแฟ")
        assert tokens == "แนะนำร้าน X ครับ"  # leading space after the tag stripped
        assert done["reply"] == "แนะนำร้าน X ครับ"
        assert len(done["places"]) == 1
        assert done["events"] == []

    def test_match_kb_streams_tokens_but_drops_places_and_events(self):
        svc = make_service(stream_text=f"{MATCH_KB_TAG} ขอนแก่นก่อตั้งปี 2340 ครับ", events=[make_event_row()])
        tokens, done = self._collect(svc, "ประวัติศาสตร์ขอนแก่น")
        assert "2340" in tokens
        assert done["places"] == []
        assert done["events"] == []

    def test_match_events_streams_tokens_and_attaches_events(self):
        svc = make_service(stream_text=f"{MATCH_EVENTS_TAG} มีงานเทศกาล Y ครับ", events=[make_event_row()])
        tokens, done = self._collect(svc, "มีงานเทศกาลอะไรบ้าง")
        assert "เทศกาล Y" in tokens
        assert done["places"] == []
        assert len(done["events"]) == 1

    def test_match_places_plus_events_combo_streams_and_attaches_both(self):
        tag = match_tag(SOURCE_PLACES, SOURCE_EVENTS)
        svc = make_service(stream_text=f"{tag} ร้าน X และงาน Y ครับ", events=[make_event_row()])
        tokens, done = self._collect(svc, "คำถามผสม")
        assert tokens == "ร้าน X และงาน Y ครับ"
        assert len(done["places"]) == 1
        assert len(done["events"]) == 1

    def test_reversed_combo_order_still_resolves(self):
        # The prompt asks for canonical PLACES,KB,EVENTS order, but the model
        # writing them in a different order shouldn't leak the raw tag into
        # the visible reply -- see MATCH_TAGS' comment in agent.py.
        tag = match_tag(SOURCE_EVENTS, SOURCE_PLACES)
        svc = make_service(stream_text=f"{tag} งาน Y และร้าน X ครับ", events=[make_event_row()])
        tokens, done = self._collect(svc, "คำถามผสม")
        assert tokens == "งาน Y และร้าน X ครับ"
        assert len(done["places"]) == 1
        assert len(done["events"]) == 1

    def test_no_match_streams_fallback_text_not_the_hidden_reasoning(self):
        # Regression: this used to yield zero token events, so the frontend
        # (which only renders accumulated tokens, never the final `reply`
        # field) showed a permanently empty chat bubble.
        svc = make_service(stream_text=f"{NO_MATCH_TAG} เหตุผลภายในที่ไม่ควรโชว์ผู้ใช้")
        tokens, done = self._collect(svc, "แก้สมการ 2x=4")
        assert tokens == FALLBACK_MESSAGE
        assert "เหตุผลภายใน" not in tokens  # the model's hidden reasoning never leaks out
        assert done["reply"] == FALLBACK_MESSAGE
        assert done["places"] == []
        assert done["events"] == []

    def test_tag_split_across_many_small_chunks_still_resolves(self):
        # chunk_size=1 forces "[MATCH:PLACES]" to arrive one character at a
        # time -- exercises the ambiguous-prefix buffering path directly.
        svc = RAGChatbotService()
        svc.retriever = FakeRetriever()
        full_text = f"{MATCH_PLACES_TAG} เนื้อหาคำตอบ"
        svc.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
            create=lambda **kwargs: iter(make_stream(full_text, chunk_size=1))
        )))
        tokens, done = self._collect(svc, "คำถาม")
        assert tokens == "เนื้อหาคำตอบ"  # leading space survives the tag/content chunk split, still stripped
        assert len(done["places"]) == 1

    def test_missing_tag_streams_everything_and_keeps_places_and_events(self):
        svc = make_service(stream_text="ไม่มีแท็กนำหน้าเลยครับ", events=[make_event_row()])
        tokens, done = self._collect(svc, "คำถามอะไรก็ได้")
        assert tokens == "ไม่มีแท็กนำหน้าเลยครับ"
        assert len(done["places"]) == 1
        assert len(done["events"]) == 1
