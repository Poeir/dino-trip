import datetime
from openai import OpenAI
from src.core.config import API_KEY, BASE_URL, MODEL_NAME
from src.services.rag.retriever import PlaceRetriever

FALLBACK_MESSAGE = "(น้องไดโน) ไม่มีข้อมูลในส่วนนี้ครับ ลองถามเกี่ยวกับสถานที่ท่องเที่ยว ร้านอาหาร หรือคาเฟ่ในขอนแก่นดูนะครับ"


class RAGChatbotService:
    def __init__(self):
        self.retriever = PlaceRetriever()
        self.client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
        self.model_name = MODEL_NAME

    def chat(self, user_message: str, history: list[dict] | None = None) -> dict:
        history = history or []

        # Retrieve from both places and knowledge_base -- unlike the old
        # project, which only ever searched places.
        places = self.retriever.search_and_expand(query=user_message, limit=3)
        kb_entries = self.retriever.search_knowledge_base(query=user_message, limit=3)

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
            f"เวลาเปิด-ปิด: {p.get('hours') or '-'}"
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
        1. กรุณาตอบคำถามของผู้ใช้โดยอ้างอิงจาก [ข้อมูลบริบท] ด้านล่างนี้เท่านั้น
        2. หากมีข้อมูลในบริบท ให้สรุปและตอบอย่างเป็นธรรมชาติ
        3. หากคำถามของผู้ใช้ ไม่เกี่ยวข้องกับ [ข้อมูลบริบท] เลย หรือคุณไม่มีข้อมูล ให้ตอบอย่างสุภาพว่า "{FALLBACK_MESSAGE}"
        4. ห้ามแต่งเติม หรือเดาข้อมูลสถานที่ขึ้นมาเองเด็ดขาด

        [ข้อมูลบริบท]
        {context_str}
        """

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history[-4:])
        messages.append({"role": "user", "content": user_message})

        response = self.client.chat.completions.create(
            model=self.model_name,
            messages=messages,
            temperature=0.3,
        )
        bot_reply = response.choices[0].message.content

        if FALLBACK_MESSAGE in bot_reply:
            source_places = []

        return {"reply": bot_reply, "places": source_places}
