import datetime
import itertools
import logging
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from openai import BadRequestError
from src.core.llm_client import make_llm_client
from src.core.clock import BANGKOK_TZ, now_bangkok
from src.core.config import CHAT_LLM_PROVIDER, CHAT_MODEL_NAME
from src.core.usage import UsageTracker
from src.services.rag.retriever import PlaceRetriever

logger = logging.getLogger(__name__)

# Still a refusal (the model's own no-match text is never shown), but one
# that says what the bot can do and how to ask again, instead of a dead end.
FALLBACK_MESSAGE = (
    "ขออภัยครับ น้องไดโนยังไม่มีข้อมูลเรื่องนี้ในระบบ "
    "ตอนนี้น้องไดโนช่วยแนะนำร้านอาหาร คาเฟ่ ที่เที่ยว วัด ตลาด และงานอีเวนต์ในขอนแก่นได้ครับ "
    "ลองบอกแนวที่ชอบหรือย่านที่จะไปดูนะครับ เช่น \"คาเฟ่บรรยากาศดีแถวบึงแก่นนคร\" หรือ \"ที่เที่ยวพาเด็ก\""
)
# Shown when a turn fails (LLM timeout, DB error, empty model output). Same
# wording as the frontend's own catch-all in AppContext.sendChat.
ERROR_MESSAGE = "ขออภัยครับ ระบบแชทขัดข้องชั่วคราว ลองใหม่อีกครั้งนะครับ"

_THAI_WEEKDAYS = ("จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์")
_THAI_MONTHS = (
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
)


def current_time_text(now: datetime.datetime | None = None) -> str:
    """Today's date and time in Thailand, in the same Buddhist-era form the
    event date ranges use ("23-25 ต.ค. 2569") so the model can compare them."""
    now = now.astimezone(BANGKOK_TZ) if now else now_bangkok()
    return (
        f"วัน{_THAI_WEEKDAYS[now.weekday()]}ที่ {now.day} {_THAI_MONTHS[now.month - 1]} "
        f"พ.ศ. {now.year + 543} (ค.ศ. {now.year}) เวลา {now:%H:%M} น."
    )

# The LLM is asked to prefix every reply with one of these tags so the code
# can detect a no-match answer deterministically (instead of string-matching
# the LLM's prose against FALLBACK_MESSAGE, which breaks the moment the model
# paraphrases its refusal instead of repeating it verbatim), and separately
# so `places`/`events` cards are only attached when the answer actually drew
# on that table -- a knowledge_base-only answer (history/culture/transport)
# was otherwise still shipping the top-3 retrieved *places* as source cards,
# even though the reply never mentioned them (confirmed by testing).
SOURCE_PLACES = "PLACES"
SOURCE_KB = "KB"
SOURCE_EVENTS = "EVENTS"
_SOURCES = (SOURCE_PLACES, SOURCE_KB, SOURCE_EVENTS)

MATCH_PLACES_TAG = "[MATCH:PLACES]"
MATCH_KB_TAG = "[MATCH:KB]"
MATCH_EVENTS_TAG = "[MATCH:EVENTS]"
NO_MATCH_TAG = "[NO_MATCH]"

# Separate from _SOURCES/MATCH_TAGS on purpose: a question about the bot
# itself ("ชื่ออะไร", "ทำอะไรได้บ้าง") never cites places/kb/events, so it
# doesn't belong in that combinatorial set, and it must NOT fall through to
# NO_MATCH_TAG -- NO_MATCH replies have their text discarded and replaced
# with FALLBACK_MESSAGE (see chat()/chat_stream()), which previously made
# even "สวัสดี ชื่ออะไร" answer with the generic "ไม่มีข้อมูล..." fallback
# despite the system prompt already telling the model its own name.
SOURCE_SELF = "SELF"
MATCH_SELF_TAG = "[MATCH:SELF]"

# Every way the model could plausibly write a multi-source tag: any
# non-empty subset of {PLACES, KB, EVENTS}, in any order. The prompt asks
# for one canonical order (PLACES, KB, EVENTS) for readability, but this
# accepts every permutation too -- a model that writes "[MATCH:EVENTS+PLACES]"
# instead of "[MATCH:PLACES+EVENTS]" still matches cleanly instead of
# leaking the raw tag into the visible reply (see chat_stream's
# prefix-buffering, which falls through to "not a tag" if nothing here matches).
MATCH_TAGS = tuple(
    f"[MATCH:{'+'.join(combo)}]"
    for r in range(1, len(_SOURCES) + 1)
    for combo in itertools.permutations(_SOURCES, r)
)
ALL_TAGS = (*MATCH_TAGS, MATCH_SELF_TAG, NO_MATCH_TAG)


def match_tag(*sources: str) -> str:
    """Builds a [MATCH:...] tag from source names, e.g.
    match_tag(SOURCE_PLACES, SOURCE_EVENTS) -> "[MATCH:PLACES+EVENTS]"."""
    return f"[MATCH:{'+'.join(sources)}]"


# Multi-turn: the client owns the conversation and resends it each request
# (stateless server). Only the tail is kept and each turn is capped so a long
# chat can't blow up the prompt. History only exists to resolve references
# ("ร้านนั้น", "ที่สอง"), and the two roles need very different budgets:
# measured real user questions in this app top out around ~50 chars, while a
# 3-place recommendation reply routinely runs 1,000-1,400 chars (one bullet
# list per place). A single MAX_HISTORY_CHARS=600 was truncating mid-name on
# the 2nd place and dropping the 3rd entirely -- silently breaking "ร้านที่สอง
# ล่ะ"/"ร้านที่สามอยู่ไหน" follow-ups, since clean_history runs before the
# rewrite step even sees the history. User turns get a small cap (guards
# against someone pasting a wall of text); assistant turns get enough room to
# keep a typical 3-item list intact.
MAX_HISTORY_MESSAGES = 4
MAX_USER_HISTORY_CHARS = 300
MAX_ASSISTANT_HISTORY_CHARS = 1400
MAX_REWRITE_CHARS = 300

# A hung gateway used to block a request for minutes (the SDK default is 600s
# with 2 retries). The rewrite is optional, so it gets a short leash and falls
# back to the raw message; the answer call gets one retry.
LLM_TIMEOUT_S = 25
LLM_MAX_RETRIES = 1
REWRITE_TIMEOUT_S = 8
_HISTORY_ROLES = ("user", "assistant")

# Gemini 3 Flash "thinks" by default even for a one-line query rewrite --
# measured via usage.jsonl: reasoning_tokens alone hit 600-900 (more than the
# visible output), adding 3-15s of *variable* latency on top of a pipeline
# that already makes two sequential LLM calls (rewrite, then answer) on every
# turn past the first -- this is the real reason turns 2+ feel much slower
# than turn 1, more than history size ever was. reasoning_effort="low" cut a
# measured rewrite call from ~8.5s to ~3s with no change in output quality;
# "minimal" is rejected outright by this model ("THINKING_LEVEL_MINIMAL
# unsupported"). Deliberately NOT applied to the answer call too: tried that
# and it broke the live golden-set tests hard (10/33 failing -- event
# matching, sushi retrieval, multi-turn referent resolution), because the
# [MATCH]/[NO_MATCH] tag decision and source-citation rules actually need the
# reasoning budget, unlike the mechanical rewrite task. Some gateways may
# reject the param entirely -- probed once per process (see _create) and
# skipped afterwards rather than retried every call once we know it doesn't work.
REASONING_EFFORT = "low"

REWRITE_PROMPT = """คุณเขียนคำถามล่าสุดของผู้ใช้ใหม่ให้เป็นประโยคที่เข้าใจได้ด้วยตัวเอง โดยไม่ต้องอ่านบทสนทนาก่อนหน้า
- แทนคำอ้างอิงอย่าง "ร้านนั้น" "งานนั้น" "แล้วที่สองล่ะ" ด้วยชื่อจริงจากบทสนทนา
- ถ้าคำถามล่าสุดเปลี่ยนหัวข้อใหม่หรือเข้าใจได้ด้วยตัวเองอยู่แล้ว ให้ตอบคำถามเดิมทุกตัวอักษร ห้ามเอาหัวข้อเก่ามาปน
- ห้ามตอบคำถามเอง ห้ามเพิ่มข้อมูลที่ไม่มีในบทสนทนา
- ตอบเฉพาะคำถามที่เขียนใหม่ บรรทัดเดียว ไม่มีคำอธิบายอื่น"""


def clean_history(history) -> list[dict]:
    """Sanitizes client-supplied history: only user/assistant turns (a client-
    sent "system" turn would be a prompt-injection channel), non-empty string
    content, each turn truncated, and only the most recent turns kept."""
    cleaned = []
    for m in history or []:
        role = m.get("role") if isinstance(m, dict) else None
        content = m.get("content") if isinstance(m, dict) else None
        if role not in _HISTORY_ROLES or not isinstance(content, str):
            continue
        limit = MAX_USER_HISTORY_CHARS if role == "user" else MAX_ASSISTANT_HISTORY_CHARS
        content = content.strip()[:limit]
        if content:
            cleaned.append({"role": role, "content": content})
    return cleaned[-MAX_HISTORY_MESSAGES:]


_PARENTHETICAL_RE = re.compile(r"[(（][^)）]*[)）]")
# Words the model routinely leaves off a DB name: "พระธาตุขามแก่น จังหวัดขอนแก่น"
# is written as "พระธาตุขามแก่น", "... อ.อุบลรัตน์ จ.ขอนแก่น" loses its suffix.
_LOCATION_QUALIFIER_RE = re.compile(r"ขอนแก่น|^(khon|kaen|khonkaen)$|^[อจต]\.", re.IGNORECASE)
# Below this, what's left of a name is a common word ("ชาม" from
# "ชาม ( Charm kitchen )" matched "ชามละ 50 บาท"), so only the full name counts.
_MIN_PARTIAL_NAME_CHARS = 4


def _normalize_name(text: str) -> str:
    """Letters, marks and digits only, case-folded: "**En Khonkaen** (เอ็น
    ขอนแก่น)" and "En Khonkaen - เอ็น ขอนแก่น" compare equal."""
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if unicodedata.category(c)[0] in "LMN")


def _named_in_reply(name: str, normalized_reply: str) -> bool:
    if _normalize_name(name) in normalized_reply:
        return True
    parts = [_normalize_name(p) for p in _PARENTHETICAL_RE.sub(" ", name).split() if not _LOCATION_QUALIFIER_RE.search(p)]
    parts = [p for p in parts if p]
    return sum(map(len, parts)) >= _MIN_PARTIAL_NAME_CHARS and all(p in normalized_reply for p in parts)


def cited_only(cards: list[dict], reply: str) -> list[dict]:
    """The cards whose place/event the reply actually names. Retrieval hands
    the model three candidates and it often uses one, but every candidate
    used to ship as a source card: a noodle-shop answer arrived with two
    temple cards under "อ้างอิงจาก 3 สถานที่". If no name can be found in the
    reply at all, the cards are left as they were rather than guessing."""
    normalized_reply = _normalize_name(reply)
    cited = [c for c in cards if _named_in_reply(c["name"], normalized_reply)]
    return cited or cards


def _tag_sources(tag: str) -> set[str]:
    """Which of PLACES/KB/EVENTS a [MATCH:...] tag cites -- order-independent."""
    if not tag or tag == NO_MATCH_TAG:
        return set()
    return set(tag[len("[MATCH:"):-1].split("+"))


class RAGChatbotService:
    def __init__(self):
        self.retriever = PlaceRetriever()
        self.client = make_llm_client(CHAT_LLM_PROVIDER, timeout=LLM_TIMEOUT_S, max_retries=LLM_MAX_RETRIES)
        self.model_name = CHAT_MODEL_NAME
        self._reasoning_effort_supported = True

    @staticmethod
    def _temperature(value: float) -> dict:
        # Claude's newer models reject `temperature` outright (400 "deprecated").
        return {} if CHAT_LLM_PROVIDER == "anthropic" else {"temperature": value}

    def _create(self, **kwargs):
        """The rewrite call: chat.completions.create with REASONING_EFFORT
        applied, falling back to the plain call (and remembering not to
        retry) if the gateway rejects the parameter outright instead of
        paying a failed attempt on every single call. No SDK retries: the
        client's LLM_MAX_RETRIES would turn the 8s leash into 16s, and a
        failed rewrite just falls back to the raw message anyway."""
        completions = self.client.with_options(max_retries=0).chat.completions
        if self._reasoning_effort_supported:
            try:
                return completions.create(reasoning_effort=REASONING_EFFORT, **kwargs)
            except BadRequestError:
                logger.warning("gateway rejected reasoning_effort=%s; disabling it for this process", REASONING_EFFORT)
                self._reasoning_effort_supported = False
        return completions.create(**kwargs)

    def _rewrite_query(self, user_message: str, history: list[dict], usage: UsageTracker | None = None) -> str:
        """Turns a follow-up ("แล้วร้านนั้นเปิดกี่โมง") into a standalone
        query for retrieval -- searching on the raw follow-up finds nothing
        because the referent only exists in the history. Skipped on the first
        turn (no extra LLM call). Any failure falls back to the raw message so
        a rewrite hiccup never breaks the chat."""
        if not history:
            return user_message
        transcript = "\n".join(
            f"{'ผู้ใช้' if m['role'] == 'user' else 'น้องไดโน'}: {m['content']}" for m in history
        )
        try:
            response = self._create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": REWRITE_PROMPT},
                    {"role": "user", "content": f"[บทสนทนาก่อนหน้า]\n{transcript}\n\n[คำถามล่าสุด]\n{user_message}"},
                ],
                **self._temperature(0),
                timeout=REWRITE_TIMEOUT_S,
            )
            if usage:
                usage.record_response("rewrite", self.model_name, response)
            rewritten = (response.choices[0].message.content or "").strip().splitlines()
            rewritten = rewritten[0].strip()[:MAX_REWRITE_CHARS] if rewritten else ""
        except Exception as e:
            logger.warning("query rewrite failed, using raw message: %s", e)
            return user_message
        return rewritten or user_message

    def _prepare(self, user_message: str, history=None, usage: UsageTracker | None = None) -> tuple[list[dict], list[dict], list[dict], dict]:
        history = clean_history(history)
        t0 = time.time()
        search_query = self._rewrite_query(user_message, history, usage)
        rewrite_ms = (time.time() - t0) * 1000

        # Retrieve from places, knowledge_base, and events -- unlike the old
        # project, which only ever searched places.
        t0 = time.time()
        # Run concurrently: each call now uses its own dedicated Supabase
        # client (see retriever.py), which fixed the earlier httpx.ReadError
        # ([WinError 10035]) that a shared client's connection hit when
        # threads raced on it. retriever.embed() serializes the encode, so
        # the three searches still only encode the query once.
        with ThreadPoolExecutor(max_workers=3) as pool:
            f_places = pool.submit(self.retriever.search_chat_places, query=search_query, limit=3)
            f_kb = pool.submit(self.retriever.search_knowledge_base, query=search_query, limit=3)
            f_events = pool.submit(self.retriever.search_events, query=search_query, limit=3)
            places = f_places.result()
            kb_entries = f_kb.result()
            events = f_events.result()
        retrieve_ms = (time.time() - t0) * 1000

        logger.info(
            "chat retrieval query=%r search_query=%r place_ids=%s kb_ids=%s event_ids=%s rewrite_ms=%.0f retrieve_ms=%.0f",
            user_message,
            search_query,
            [p["id"] for p in places],
            [k["id"] for k in kb_entries],
            [e["id"] for e in events],
            rewrite_ms,
            retrieve_ms,
        )

        source_places = [
            {
                "id": p["id"],
                "name": p["name"],
                "category": p.get("category"),
                "address": p.get("address"),
                "rating": p.get("rating"),
                "image_url": p.get("img"),
            }
            for p in places
        ]
        source_events = [
            {
                "id": e["id"],
                "name": e["name"],
                "category": e.get("category"),
                "venueName": e.get("venue_name"),
                "dateRange": e.get("date_range"),
                "admission": e.get("admission"),
                "image_url": e.get("img"),
            }
            for e in events
        ]

        place_context = "\n---\n".join(
            f"ชื่อสถานที่: {p['name']}\n"
            f"ประเภท/แท็ก: {', '.join(p.get('tags') or []) or p.get('category') or '-'}\n"
            f"คะแนน: {p.get('rating') or '-'} ดาว\n"
            f"รายละเอียด: {p.get('description') or '-'}\n"
            f"ที่อยู่: {p.get('address') or '-'}\n"
            f"เวลาเปิด-ปิด: {p.get('hours') or '-'}\n"
            f"ราคา: {p.get('price') or 'ไม่มีข้อมูลราคา'}\n"
            f"สิ่งอำนวยความสะดวก: {', '.join(p.get('amenities') or []) or 'ไม่มีข้อมูล'}"
            # Set by retriever.search_chat_places for "แถว X" questions: the
            # model may not work out distances itself (rule 4), so it is told.
            + (f"\nทำเลเทียบกับที่ผู้ใช้ถาม: {p['area_note']}" if p.get("area_note") else "")
            for p in places
        )
        kb_context = "\n---\n".join(
            f"หัวข้อ: {k['title']}\nเนื้อหา: {k.get('content', '')}" for k in kb_entries
        )
        event_context = "\n---\n".join(
            f"ชื่องาน: {e['name']}\n"
            f"ประเภท: {e.get('category') or '-'}\n"
            f"สถานที่จัดงาน: {e.get('venue_name') or '-'}\n"
            f"วันที่จัดงาน: {e.get('date_range') or 'ไม่มีข้อมูลวันที่'}\n"
            f"ค่าเข้างาน: {e.get('admission') or 'ไม่มีข้อมูลค่าเข้างาน'}\n"
            f"เหมาะสำหรับ: {', '.join(e.get('suitable_for') or []) or 'ไม่มีข้อมูล'}\n"
            f"รายละเอียด: {e.get('description') or '-'}"
            for e in events
        )
        context_str = "\n---\n".join(filter(None, [place_context, kb_context, event_context])) or "ไม่มีข้อมูลที่ตรงกับคำถามในฐานข้อมูล"

        system_prompt = f"""
        คุณคือ 'น้องไดโน' ผู้ช่วยส่วนตัวสำหรับการท่องเที่ยวในจังหวัดขอนแก่น เป็นมิตรและสุภาพ
        ขณะนี้คือ{current_time_text()} ตามเวลาประเทศไทย (ใช้ข้อมูลนี้ตัดสินว่าสถานที่เปิดหรือปิด และงานไหนผ่านไปแล้ว กำลังจัดอยู่ หรือยังไม่ถึง)

        [กฎเหล็ก]
        1. ขึ้นต้นคำตอบทุกครั้งด้วยแท็ก [MATCH:...] เป็นอันดับแรกเสมอ (ห้ามมีข้อความอื่นนำหน้าแท็ก) [ข้อมูลบริบท] ด้านล่างมี 3 ส่วนคือ "รายการสถานที่" (ร้าน/คาเฟ่/ที่เที่ยว), "ความรู้ทั่วไป" (ประวัติศาสตร์/วัฒนธรรม/การเดินทาง ฯลฯ), และ "รายการอีเวนท์" (งาน/เทศกาล/กิจกรรม):
           - ใส่ชื่อแหล่งข้อมูลที่คำตอบ "อ้างอิงจริง" ในแท็ก คั่นด้วยเครื่องหมาย + ตามลำดับ PLACES, KB, EVENTS เท่านั้น -- ใช้ได้แค่คำว่า {SOURCE_PLACES} (รายการสถานที่), {SOURCE_KB} (ความรู้ทั่วไป), {SOURCE_EVENTS} (รายการอีเวนท์) เช่น {MATCH_PLACES_TAG}, {MATCH_EVENTS_TAG}, {match_tag(SOURCE_PLACES, SOURCE_EVENTS)}, {match_tag(SOURCE_PLACES, SOURCE_KB, SOURCE_EVENTS)}
           - ใช้แหล่งข้อมูลที่ตรงกับสิ่งที่ตอบจริงเท่านั้น แม้จะตอบได้แค่บางส่วนของคำถามที่ถามหลายอย่างพร้อมกัน โดยที่แต่ละส่วนต้องตรงกับที่ผู้ใช้ถามจริงๆ (เช่น ผู้ใช้ถามทั้งร้านกาแฟและงานเทศกาล แต่บริบทมีแต่ร้านกาแฟ ก็ให้ใช้ {MATCH_PLACES_TAG} แนะนำร้านกาแฟที่มี แล้วบอกตรงๆ ว่าไม่มีข้อมูลงานเทศกาลในส่วนที่เหลือ)
           - ใช้ {NO_MATCH_TAG} ถ้าไม่มีรายการใดใน [ข้อมูลบริบท] ตรงกับสิ่งที่ผู้ใช้ถามหาจริงๆ แม้แต่รายการเดียว -- ห้ามใช้ MATCH แค่เพราะบริบทมีรายการประเภทอื่นที่ "ใกล้เคียง" หรืออยู่ในขอนแก่นเหมือนกัน (เช่น ผู้ใช้ถามหา "น้ำตก" แต่บริบทมีแต่สะพานกับสวนน้ำ ซึ่งไม่ใช่น้ำตก เลยไม่นับว่าตรง ต้องใช้ {NO_MATCH_TAG} ห้ามหยิบสะพาน/สวนน้ำมาแนะนำแทน) แต่ถ้าผู้ใช้ถามหาเมนูหรือชนิดอาหารเฉพาะ (เช่น ซูชิ, เนื้อย่าง) และบริบทมีร้านที่เป็นประเภทอาหารนั้นตามชื่อ/ประเภท/แท็ก (เช่น ร้านอาหารญี่ปุ่นสำหรับซูชิ) ให้นับว่าตรง ใช้ MATCH แนะนำร้านนั้นได้ โดยบอกตรงๆ ว่าไม่มีข้อมูลเมนูเฉพาะรายการ ตามด้วยอะไรก็ได้สั้นๆ (ข้อความส่วนนี้จะไม่ถูกแสดงให้ผู้ใช้เห็น ระบบจะแสดงข้อความมาตรฐานแทน)
        2. กรุณาตอบคำถามของผู้ใช้โดยอ้างอิงจาก [ข้อมูลบริบท] ด้านล่างนี้เท่านั้น
        3. หากมีข้อมูลในบริบท ให้สรุปและตอบอย่างเป็นธรรมชาติ
        4. ห้ามแต่งเติม หรือเดาข้อมูลสถานที่/งานขึ้นมาเองเด็ดขาด รวมถึงคุณสมบัติที่ไม่มีระบุใน [ข้อมูลบริบท] เช่น ที่จอดรถ, wifi, การเดินทาง/ระยะห่างจากจุดอื่น, วันที่จัดงานที่ไม่ได้ระบุไว้ -- ถ้าไม่มีข้อมูลด้านนี้ ให้บอกตรงๆ ว่าไม่มีข้อมูล ห้ามอนุมานจากที่อยู่หรือชื่อสถานที่/งานเอง
        5. ห้ามแนะนำอีเวนท์ที่ไม่ได้อยู่ใน [ข้อมูลบริบท] -- ระบบกรองอีเวนท์ที่จบไปแล้วหรือถูกยกเลิกออกให้แล้ว รายการอีเวนท์ที่เห็นในบริบทคือรายการที่ยังใช้ได้ทั้งหมด
        6. หากมีประวัติการสนทนาก่อนหน้า ให้ใช้เพื่อเข้าใจคำอ้างอิงในคำถามล่าสุดเท่านั้น (เช่น "ร้านนั้น") ห้ามใช้ประวัติเป็นแหล่งข้อมูลข้อเท็จจริง ข้อเท็จจริงต้องมาจาก [ข้อมูลบริบท] เสมอ และประวัติของคำตอบก่อนหน้าไม่มีแท็ก แต่คำตอบใหม่ของคุณต้องขึ้นต้นด้วยแท็กตามกฎข้อ 1 ทุกครั้ง
        7. ถ้าผู้ใช้ถามเกี่ยวกับตัวคุณเอง (ทักทาย, ชื่ออะไร, ทำอะไรได้บ้าง, คุยเล่นทั่วไปสั้นๆ) ให้ใช้แท็ก {MATCH_SELF_TAG} แทน {NO_MATCH_TAG} และตอบได้ตรงๆ โดยไม่ต้องมีข้อมูลใน [ข้อมูลบริบท] รองรับ -- สิ่งที่คุณทำได้จริงคือแนะนำร้านอาหาร คาเฟ่ สถานที่ท่องเที่ยว และอีเวนท์ในจังหวัดขอนแก่น จากฐานข้อมูลที่มี ห้ามอ้างว่าจองร้าน จองโรงแรม ซื้อตั๋ว หรือทำอย่างอื่นที่ทำไม่ได้จริง ใช้ {MATCH_SELF_TAG} เฉพาะคำถามเกี่ยวกับตัวคุณเองเท่านั้น คำถามความรู้ทั่วไปอื่นที่ไม่เกี่ยวกับตัวคุณ (ประวัติศาสตร์ เหตุการณ์ปัจจุบัน ความรู้วิชาการ ฯลฯ) ยังต้องใช้กฎข้อ 1-2 ตามปกติ (ตอบจาก [ข้อมูลบริบท] เท่านั้น ไม่มีก็ {NO_MATCH_TAG})

        [ข้อมูลบริบท]
        {context_str}
        """

        messages = [
            {"role": "system", "content": system_prompt},
            *history,
            {"role": "user", "content": user_message},
        ]
        return messages, source_places, source_events, {"retrieve_ms": retrieve_ms, "rewrite_ms": rewrite_ms}

    def chat(self, user_message: str, history=None) -> dict:
        t_total0 = time.time()
        usage = UsageTracker("chat", turn=len(history or []) // 2 + 1)
        messages, source_places, source_events, timings = self._prepare(user_message, history, usage)

        t0 = time.time()
        # Not routed through _create: the answer call needs its full
        # reasoning budget for the [MATCH]/[NO_MATCH] decision (see
        # REASONING_EFFORT's comment -- reasoning_effort="low" here broke
        # 10/33 live golden-set tests).
        response = self.client.chat.completions.create(
            model=self.model_name,
            messages=messages,
            # Low temperature: the [MATCH]/[NO_MATCH] decision at the start of
            # every reply needs to be consistent for identical retrieved
            # context -- 0.3 was flipping the tag on repeated identical
            # requests during testing.
            **self._temperature(0.1),
        )
        usage.record_response("answer", self.model_name, response)
        raw_reply = response.choices[0].message.content or ""
        llm_ms = (time.time() - t0) * 1000

        matched_tag = next((t for t in ALL_TAGS if raw_reply.startswith(t)), None)
        is_fallback = matched_tag == NO_MATCH_TAG
        if is_fallback:
            bot_reply = FALLBACK_MESSAGE
            source_places = []
            source_events = []
        elif matched_tag:
            bot_reply = raw_reply[len(matched_tag):].strip()
            matched_sources = _tag_sources(matched_tag)
            if SOURCE_PLACES not in matched_sources:
                source_places = []
            if SOURCE_EVENTS not in matched_sources:
                source_events = []
        else:
            # Model didn't follow the tag instruction -- treat as a match
            # rather than silently dropping the answer.
            bot_reply = raw_reply
        if not bot_reply:
            # No content, or a tag with nothing after it.
            logger.warning("chat got an empty reply (tag=%s)", matched_tag)
            bot_reply = ERROR_MESSAGE
            source_places = []
            source_events = []
        source_places = cited_only(source_places, bot_reply)
        source_events = cited_only(source_events, bot_reply)
        total_ms = (time.time() - t_total0) * 1000
        logger.info(
            "chat done tag=%s retrieve_ms=%.0f llm_ms=%.0f total_ms=%.0f",
            matched_tag, timings["retrieve_ms"], llm_ms, total_ms,
        )

        return {"reply": bot_reply, "places": source_places, "events": source_events, "usage": usage.finish()}

    def chat_stream(self, user_message: str, history=None):
        """Generator yielding {"type": "token", "text": ...} chunks as the LLM
        streams its answer, then a final {"type": "done", "reply", "places",
        "events"}. `places`/`events` are only known once the leading
        [MATCH]/[NO_MATCH] tag has been read from the stream, so they're
        withheld until the last event rather than sent up front.

        A failure anywhere in the turn (retrieval, the LLM call, or the
        stream dying mid-answer) ends the stream with ERROR_MESSAGE and a
        normal `done` instead of an exception: raising here kills the HTTP
        response after its 200 headers are already sent."""
        usage = UsageTracker("chat", turn=len(history or []) // 2 + 1)
        emitted = ""
        try:
            for event in self._stream_turn(user_message, history, usage):
                if event["type"] == "token":
                    emitted += event["text"]
                yield event
        except Exception:
            logger.exception("chat_stream failed query=%r", user_message)
            # A NO_MATCH turn has already shown its whole answer; only the
            # hidden text was still being drained.
            if emitted != FALLBACK_MESSAGE:
                notice = f"\n\n{ERROR_MESSAGE}" if emitted else ERROR_MESSAGE
                emitted += notice
                yield {"type": "token", "text": notice}
            usage.meta["failed"] = True
            yield {"type": "done", "reply": emitted, "places": [], "events": [], "usage": usage.finish()}

    def _stream_turn(self, user_message: str, history, usage: UsageTracker):
        t_total0 = time.time()
        messages, source_places, source_events, timings = self._prepare(user_message, history, usage)

        t0 = time.time()
        stream_kwargs = dict(
            model=self.model_name,
            messages=messages,
            # Low temperature: the [MATCH]/[NO_MATCH] decision at the start of
            # every reply needs to be consistent for identical retrieved
            # context -- 0.3 was flipping the tag on repeated identical
            # requests during testing.
            **self._temperature(0.1),
            stream=True,
        )
        # Not given REASONING_EFFORT, same reason as the non-streamed answer
        # call above: this is the call that makes the [MATCH]/[NO_MATCH]
        # decision, and cutting its reasoning budget broke live tests.
        try:
            # include_usage makes the gateway append a final chunk carrying
            # token counts (with empty `choices`).
            stream = self.client.chat.completions.create(**stream_kwargs, stream_options={"include_usage": True})
        except BadRequestError:
            # Gateway rejects stream_options: chat still works, this turn's
            # answer call is just recorded as usage_missing.
            logger.warning("gateway rejected stream_options; answer usage unavailable for streamed chat")
            stream = self.client.chat.completions.create(**stream_kwargs)
        stream_usage = None

        full_text = ""
        tag_buffer = ""
        tag_resolved = False
        is_fallback = False
        include_places = False
        include_events = False
        # Whitespace right after the tag (typically one space before the
        # real reply starts) needs skipping, but it can arrive in its own
        # chunk separately from the tag -- a plain one-shot .lstrip() at the
        # tag-match moment only strips it when the API happens to bundle it
        # into the same chunk, which isn't guaranteed. This flag makes the
        # skip survive across chunk boundaries instead.
        skip_leading_ws = False
        for chunk in stream:
            if getattr(chunk, "usage", None):
                stream_usage = chunk.usage
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if not delta:
                continue

            if not tag_resolved:
                tag_buffer += delta
                matched_tag = next((t for t in ALL_TAGS if tag_buffer.startswith(t)), None)
                if matched_tag:
                    tag_resolved = True
                    if matched_tag == NO_MATCH_TAG:
                        # The model's own no-match text is hidden (drained
                        # below, not yielded) -- but the frontend only ever
                        # renders accumulated `token` events, it doesn't read
                        # `reply` off the final `done` event. So the fallback
                        # message itself has to go out as a token here, or a
                        # NO_MATCH answer renders as a permanently empty
                        # bubble (confirmed live: this was exactly that bug).
                        is_fallback = True
                        full_text = FALLBACK_MESSAGE
                        yield {"type": "token", "text": FALLBACK_MESSAGE}
                    else:
                        matched_sources = _tag_sources(matched_tag)
                        include_places = SOURCE_PLACES in matched_sources
                        include_events = SOURCE_EVENTS in matched_sources
                        remainder = tag_buffer[len(matched_tag):].lstrip()
                        if remainder:
                            full_text += remainder
                            yield {"type": "token", "text": remainder}
                        else:
                            skip_leading_ws = True
                elif not any(t.startswith(tag_buffer) for t in ALL_TAGS):
                    # Doesn't match any tag prefix -- model skipped the tag
                    # instruction. Treat everything buffered so far as a
                    # normal (matched) reply rather than dropping it.
                    tag_resolved = True
                    include_places = True
                    include_events = True
                    full_text += tag_buffer
                    yield {"type": "token", "text": tag_buffer}
                # else: still an ambiguous prefix of one of the tags, keep buffering
                continue

            if is_fallback:
                continue  # drain the hidden no-match text without yielding it

            if skip_leading_ws:
                delta = delta.lstrip()
                if not delta:
                    continue
                skip_leading_ws = False

            full_text += delta
            yield {"type": "token", "text": delta}

        if not full_text:
            # No content at all, a tag with nothing after it, or a stream that
            # ended mid-tag: the frontend hides an empty bot bubble, so the
            # user would otherwise see no answer and no error.
            logger.warning("chat_stream got an empty reply (tag_buffer=%r)", tag_buffer)
            full_text = ERROR_MESSAGE
            include_places = False
            include_events = False
            yield {"type": "token", "text": ERROR_MESSAGE}

        llm_ms = (time.time() - t0) * 1000
        final_reply = FALLBACK_MESSAGE if is_fallback else full_text
        final_places = cited_only(source_places, full_text) if include_places else []
        final_events = cited_only(source_events, full_text) if include_events else []
        total_ms = (time.time() - t_total0) * 1000
        logger.info(
            "chat_stream done fallback=%s include_places=%s include_events=%s retrieve_ms=%.0f llm_ms=%.0f total_ms=%.0f",
            is_fallback, include_places, include_events, timings["retrieve_ms"], llm_ms, total_ms,
        )

        usage.record("answer", self.model_name, stream_usage)
        yield {"type": "done", "reply": final_reply, "places": final_places, "events": final_events, "usage": usage.finish()}
