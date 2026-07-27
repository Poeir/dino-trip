import datetime
import logging
import time
from openai import OpenAI
from src.core.config import API_KEY, BASE_URL, MODEL_NAME
from src.services.rag.retriever import PlaceRetriever

logger = logging.getLogger(__name__)

FALLBACK_MESSAGE = "(น้องไดโน) ไม่มีข้อมูลในส่วนนี้ครับ ลองถามเกี่ยวกับสถานที่ท่องเที่ยว ร้านอาหาร หรือคาเฟ่ในขอนแก่นดูนะครับ"

# The LLM is asked to prefix every reply with one of these tags so the code
# can detect a no-match answer deterministically (instead of string-matching
# the LLM's prose against FALLBACK_MESSAGE, which breaks the moment the model
# paraphrases its refusal instead of repeating it verbatim), and separately
# so `places` cards are only attached when the answer actually drew on the
# `places` table -- a knowledge_base-only answer (history/culture/transport)
# was otherwise still shipping the top-3 retrieved *places* as source cards,
# even though the reply never mentioned them (confirmed by testing).
MATCH_PLACES_TAG = "[MATCH:PLACES]"
MATCH_KB_TAG = "[MATCH:KB]"
MATCH_BOTH_TAG = "[MATCH:BOTH]"
NO_MATCH_TAG = "[NO_MATCH]"
ALL_TAGS = (MATCH_PLACES_TAG, MATCH_KB_TAG, MATCH_BOTH_TAG, NO_MATCH_TAG)
PLACE_CARD_TAGS = (MATCH_PLACES_TAG, MATCH_BOTH_TAG)


class RAGChatbotService:
    def __init__(self):
        self.retriever = PlaceRetriever()
        self.client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
        self.model_name = MODEL_NAME

    def _prepare(self, user_message: str, history: list[dict]) -> tuple[list[dict], list[dict]]:
        # Retrieve from both places and knowledge_base -- unlike the old
        # project, which only ever searched places.
        places = self.retriever.search_and_expand(query=user_message, limit=3)
        kb_entries = self.retriever.search_knowledge_base(query=user_message, limit=3)
        logger.info(
            "chat retrieval query=%r place_ids=%s kb_ids=%s",
            user_message,
            [p["id"] for p in places],
            [k["id"] for k in kb_entries],
        )

        source_places = [
            {
                "id": p["id"],
                "name": p["name"],
                "address": p.get("address"),
                "rating": p.get("rating"),
                "image_url": p.get("img"),
            }
            for p in places
        ]

        place_context = "\n---\n".join(
            f"ชื่อสถานที่: {p['name']}\n"
            f"คะแนน: {p.get('rating') or '-'} ดาว\n"
            f"รายละเอียด: {p.get('description') or '-'}\n"
            f"ที่อยู่: {p.get('address') or '-'}\n"
            f"เวลาเปิด-ปิด: {p.get('hours') or '-'}\n"
            f"ราคา: {p.get('price') or 'ไม่มีข้อมูลราคา'}\n"
            f"สิ่งอำนวยความสะดวก: {', '.join(p.get('amenities') or []) or 'ไม่มีข้อมูล'}"
            for p in places
        )
        kb_context = "\n---\n".join(
            f"หัวข้อ: {k['title']}\nเนื้อหา: {k.get('content', '')}" for k in kb_entries
        )
        context_str = "\n---\n".join(filter(None, [place_context, kb_context])) or "ไม่มีข้อมูลที่ตรงกับคำถามในฐานข้อมูล"

        current_time_info = datetime.datetime.now().strftime("%A เวลา %H:%M น.")

        system_prompt = f"""
        คุณคือ 'น้องไดโน' ผู้ช่วยส่วนตัวสำหรับการท่องเที่ยวในจังหวัดขอนแก่น เป็นมิตรและสุภาพ
        ขณะนี้คือวัน {current_time_info} (ใช้ข้อมูลนี้ตัดสินว่าสถานที่เปิดหรือปิด)

        [กฎเหล็ก]
        1. ขึ้นต้นคำตอบทุกครั้งด้วยแท็กใดแท็กหนึ่งต่อไปนี้เป็นอันดับแรกเสมอ (ห้ามมีข้อความอื่นนำหน้าแท็ก) [ข้อมูลบริบท] ด้านล่างมี 2 ส่วนคือ "รายการสถานที่" (ร้าน/คาเฟ่/ที่เที่ยว) และ "ความรู้ทั่วไป" (ประวัติศาสตร์/วัฒนธรรม/การเดินทาง ฯลฯ):
           - {MATCH_PLACES_TAG} ตามด้วยคำตอบ หากคำตอบอ้างอิงเฉพาะ "รายการสถานที่"
           - {MATCH_KB_TAG} ตามด้วยคำตอบ หากคำตอบอ้างอิงเฉพาะ "ความรู้ทั่วไป" ไม่ได้พูดถึงสถานที่รายการใดใน [ข้อมูลบริบท] เลย
           - {MATCH_BOTH_TAG} ตามด้วยคำตอบ หากคำตอบอ้างอิงทั้งสองส่วน
           - ใช้แท็ก MATCH ที่ตรงกับสิ่งที่ตอบจริง แม้จะตอบได้แค่บางส่วนของคำถามที่ถามหลายอย่างพร้อมกัน โดยที่แต่ละส่วนต้องตรงกับที่ผู้ใช้ถามจริงๆ (เช่น ผู้ใช้ถามทั้งร้านกาแฟและร้านอาหาร แต่บริบทมีแต่ร้านกาแฟ ก็ให้ใช้ {MATCH_PLACES_TAG} แนะนำร้านกาแฟที่มี แล้วบอกตรงๆ ว่าไม่มีข้อมูลร้านอาหารในส่วนที่เหลือ)
           - ใช้ {NO_MATCH_TAG} ถ้าไม่มีรายการใดใน [ข้อมูลบริบท] ตรงกับสิ่งที่ผู้ใช้ถามหาจริงๆ แม้แต่รายการเดียว -- ห้ามใช้ MATCH แค่เพราะบริบทมีสถานที่ประเภทอื่นที่ "ใกล้เคียง" หรืออยู่ในขอนแก่นเหมือนกัน (เช่น ผู้ใช้ถามหา "น้ำตก" แต่บริบทมีแต่สะพานกับสวนน้ำ ซึ่งไม่ใช่น้ำตก เลยไม่นับว่าตรง ต้องใช้ {NO_MATCH_TAG} ห้ามหยิบสะพาน/สวนน้ำมาแนะนำแทน) ตามด้วยอะไรก็ได้สั้นๆ (ข้อความส่วนนี้จะไม่ถูกแสดงให้ผู้ใช้เห็น ระบบจะแสดงข้อความมาตรฐานแทน)
        2. กรุณาตอบคำถามของผู้ใช้โดยอ้างอิงจาก [ข้อมูลบริบท] ด้านล่างนี้เท่านั้น
        3. หากมีข้อมูลในบริบท ให้สรุปและตอบอย่างเป็นธรรมชาติ
        4. ห้ามแต่งเติม หรือเดาข้อมูลสถานที่ขึ้นมาเองเด็ดขาด รวมถึงคุณสมบัติที่ไม่มีระบุใน [ข้อมูลบริบท] เช่น ที่จอดรถ, wifi, การเดินทาง/ระยะห่างจากจุดอื่น -- ถ้าไม่มีข้อมูลด้านนี้ ให้บอกตรงๆ ว่าไม่มีข้อมูล ห้ามอนุมานจากที่อยู่หรือชื่อสถานที่เอง

        [ข้อมูลบริบท]
        {context_str}
        """

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history[-4:])
        messages.append({"role": "user", "content": user_message})
        return messages, source_places

    def chat(self, user_message: str, history: list[dict] | None = None) -> dict:
        history = history or []
        messages, source_places = self._prepare(user_message, history)

        t0 = time.time()
        response = self.client.chat.completions.create(
            model=self.model_name,
            messages=messages,
            # Low temperature: the [MATCH]/[NO_MATCH] decision at the start of
            # every reply needs to be consistent for identical retrieved
            # context -- 0.3 was flipping the tag on repeated identical
            # requests during testing.
            temperature=0.1,
        )
        raw_reply = response.choices[0].message.content
        elapsed = time.time() - t0

        matched_tag = next((t for t in ALL_TAGS if raw_reply.startswith(t)), None)
        is_fallback = matched_tag == NO_MATCH_TAG
        if is_fallback:
            bot_reply = FALLBACK_MESSAGE
            source_places = []
        elif matched_tag:
            bot_reply = raw_reply[len(matched_tag):].strip()
            if matched_tag not in PLACE_CARD_TAGS:
                source_places = []
        else:
            # Model didn't follow the tag instruction -- treat as a match
            # rather than silently dropping the answer.
            bot_reply = raw_reply
        logger.info("chat done in %.2fs tag=%s", elapsed, matched_tag)

        return {"reply": bot_reply, "places": source_places}

    def chat_stream(self, user_message: str, history: list[dict] | None = None):
        """Generator yielding {"type": "token", "text": ...} chunks as the LLM
        streams its answer, then a final {"type": "done", "reply", "places"}.
        `places` is only known once the leading [MATCH]/[NO_MATCH] tag has
        been read from the stream, so it's withheld until the last event
        rather than sent up front."""
        history = history or []
        messages, source_places = self._prepare(user_message, history)

        t0 = time.time()
        stream = self.client.chat.completions.create(
            model=self.model_name,
            messages=messages,
            # Low temperature: the [MATCH]/[NO_MATCH] decision at the start of
            # every reply needs to be consistent for identical retrieved
            # context -- 0.3 was flipping the tag on repeated identical
            # requests during testing.
            temperature=0.1,
            stream=True,
        )

        full_text = ""
        tag_buffer = ""
        tag_resolved = False
        is_fallback = False
        include_places = False
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if not delta:
                continue

            if not tag_resolved:
                tag_buffer += delta
                matched_tag = next((t for t in ALL_TAGS if tag_buffer.startswith(t)), None)
                if matched_tag:
                    tag_resolved = True
                    if matched_tag == NO_MATCH_TAG:
                        # Rest of the model's (hidden) no-match text still
                        # needs draining from the stream, just not yielded.
                        is_fallback = True
                    else:
                        include_places = matched_tag in PLACE_CARD_TAGS
                        remainder = tag_buffer[len(matched_tag):].lstrip()
                        if remainder:
                            full_text += remainder
                            yield {"type": "token", "text": remainder}
                elif not any(t.startswith(tag_buffer) for t in ALL_TAGS):
                    # Doesn't match any tag prefix -- model skipped the tag
                    # instruction. Treat everything buffered so far as a
                    # normal (matched) reply rather than dropping it.
                    tag_resolved = True
                    include_places = True
                    full_text += tag_buffer
                    yield {"type": "token", "text": tag_buffer}
                # else: still an ambiguous prefix of one of the tags, keep buffering
                continue

            if is_fallback:
                continue  # drain the hidden no-match text without yielding it
            full_text += delta
            yield {"type": "token", "text": delta}

        elapsed = time.time() - t0
        final_reply = FALLBACK_MESSAGE if is_fallback else full_text
        final_places = source_places if include_places else []
        logger.info("chat_stream done in %.2fs fallback=%s include_places=%s", elapsed, is_fallback, include_places)

        yield {"type": "done", "reply": final_reply, "places": final_places}
