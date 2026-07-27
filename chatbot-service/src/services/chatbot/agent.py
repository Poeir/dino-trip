import datetime
import logging
import time
from openai import OpenAI
from src.core.config import API_KEY, BASE_URL, MODEL_NAME
from src.services.rag.retriever import PlaceRetriever

logger = logging.getLogger(__name__)

FALLBACK_MESSAGE = "(น้องไดโน) ไม่มีข้อมูลในส่วนนี้ครับ ลองถามเกี่ยวกับสถานที่ท่องเที่ยว ร้านอาหาร หรือคาเฟ่ในขอนแก่นดูนะครับ"

# The LLM is asked to prefix every reply with one of these tags so the code
# can detect a no-match answer deterministically, instead of string-matching
# the LLM's prose against FALLBACK_MESSAGE (which breaks the moment the model
# paraphrases the refusal instead of repeating it verbatim).
MATCH_TAG = "[MATCH]"
NO_MATCH_TAG = "[NO_MATCH]"


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
        1. ขึ้นต้นคำตอบทุกครั้งด้วยแท็ก {MATCH_TAG} หรือ {NO_MATCH_TAG} เป็นอันดับแรกเสมอ (ห้ามมีข้อความอื่นนำหน้าแท็ก):
           - ใช้ {MATCH_TAG} ตามด้วยคำตอบ หากมีสถานที่หรือข้อมูลอย่างน้อย 1 รายการใน [ข้อมูลบริบท] ที่เกี่ยวข้องกับคำถาม แม้จะตอบได้แค่บางส่วนของคำถาม (เช่น ผู้ใช้ถามทั้งร้านกาแฟและร้านอาหาร แต่บริบทมีแต่ร้านกาแฟ ก็ให้ใช้ {MATCH_TAG} แนะนำร้านกาแฟที่มี แล้วบอกตรงๆ ว่าไม่มีข้อมูลร้านอาหารในส่วนที่เหลือ)
           - ใช้ {NO_MATCH_TAG} ตามด้วยอะไรก็ได้สั้นๆ เฉพาะกรณีที่ไม่มีรายการใดใน [ข้อมูลบริบท] เกี่ยวข้องกับคำถามเลยแม้แต่รายการเดียว (ข้อความส่วนนี้จะไม่ถูกแสดงให้ผู้ใช้เห็น ระบบจะแสดงข้อความมาตรฐานแทน)
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

        is_fallback = raw_reply.startswith(NO_MATCH_TAG)
        if is_fallback:
            bot_reply = FALLBACK_MESSAGE
            source_places = []
        elif raw_reply.startswith(MATCH_TAG):
            bot_reply = raw_reply[len(MATCH_TAG):].strip()
        else:
            # Model didn't follow the tag instruction -- treat as a match
            # rather than silently dropping the answer.
            bot_reply = raw_reply
        logger.info("chat done in %.2fs fallback=%s", elapsed, is_fallback)

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
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if not delta:
                continue

            if not tag_resolved:
                tag_buffer += delta
                if tag_buffer.startswith(NO_MATCH_TAG):
                    # Rest of the model's (hidden) no-match text still needs
                    # draining from the stream, just not yielded to the client.
                    is_fallback = True
                    tag_resolved = True
                elif tag_buffer.startswith(MATCH_TAG):
                    tag_resolved = True
                    remainder = tag_buffer[len(MATCH_TAG):].lstrip()
                    if remainder:
                        full_text += remainder
                        yield {"type": "token", "text": remainder}
                elif not (NO_MATCH_TAG.startswith(tag_buffer) or MATCH_TAG.startswith(tag_buffer)):
                    # Doesn't match either tag prefix -- model skipped the
                    # tag instruction. Treat everything buffered so far as a
                    # normal (matched) reply rather than dropping it.
                    tag_resolved = True
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
        final_places = [] if is_fallback else source_places
        logger.info("chat_stream done in %.2fs fallback=%s", elapsed, is_fallback)

        yield {"type": "done", "reply": final_reply, "places": final_places}
