import json
import logging
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.core.llm_client import make_llm_client
from src.core.config import MODEL_NAME
from src.services.trip_planner.json_utils import clean_json_string

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["Events"])
client = make_llm_client()

# Matches the admin event form fields 1:1 (frontend/src/admin/EventsTab.jsx) --
# the LLM's raw JSON is never trusted as-is, only these keys are ever read
# back out of it.
EVENT_FIELDS = ["name", "category", "dateRange", "venueName", "admission", "organizer", "suitableFor", "desc"]
# Machine-readable bounds (YYYY-MM-DD, Gregorian) -- these drive the computed
# ongoing/upcoming/ended status, so they must be valid dates or empty.
DATE_FIELDS = ["eventStartDate", "eventEndDate"]


def _valid_iso_date(val) -> str:
    if not isinstance(val, str):
        return ""
    try:
        return date.fromisoformat(val.strip()).isoformat()
    except ValueError:
        return ""


class ExtractEventRequest(BaseModel):
    text: str


def build_prompt(post_text: str) -> str:
    today = date.today().strftime("%Y-%m-%d (%A)")
    return f"""
    You extract structured event info from a Thai Facebook post so an admin can review it before publishing. Today's date is {today} -- resolve relative dates ("พรุ่งนี้", "เสาร์นี้", "สุดสัปดาห์นี้") against it.

    [FACEBOOK POST TEXT]
    {post_text}

    Extract these fields as JSON:
    - name: ชื่องาน/กิจกรรม
    - category: ประเภทงาน (เช่น เทศกาล, งานวัด, คอนเสิร์ต, งานประเพณี) -- one short Thai phrase
    - dateRange: ช่วงวันที่จัดงาน ในรูปแบบเดียวกับที่คนไทยเขียน เช่น "1-3 ธ.ค. 2569"
    - eventStartDate: วันแรกของงาน ในรูปแบบ YYYY-MM-DD ปี ค.ศ. (Gregorian) -- ต้องแปลงปี พ.ศ. เป็น ค.ศ. โดยลบ 543 เช่น 2569 -> 2026
    - eventEndDate: วันสุดท้ายของงาน ในรูปแบบ YYYY-MM-DD ปี ค.ศ. (ถ้างานวันเดียว ให้ใส่วันเดียวกับ eventStartDate)
    - venueName: ชื่อสถานที่จัดงาน
    - admission: ค่าเข้างาน (ถ้าข้อความไม่ได้พูดถึงค่าใช้จ่ายเลย ให้เว้นว่าง อย่าเดาว่าฟรี)
    - organizer: หน่วยงาน/ผู้จัดงาน (ถ้ามีระบุ)
    - suitableFor: กลุ่มที่เหมาะสม เป็น array ของคำสั้นๆ เช่น ["ครอบครัว", "วัยรุ่น"] (ถ้าข้อความไม่ได้บอกเลยให้เป็น array ว่าง)
    - desc: สรุปรายละเอียดงานสั้นๆ 1-3 ประโยค จากเนื้อหาโพสต์

    Rules:
    1. Only use information present in the post text. Do not invent dates, prices, or venues that aren't there.
    2. If a field cannot be determined from the text, use "" (or [] for suitableFor) -- never guess.
    3. Output STRICTLY a JSON object with exactly these keys: name, category, dateRange, eventStartDate, eventEndDate, venueName, admission, organizer, suitableFor, desc. No other text.
    """


@router.post("/extract")
def extract_event(req: ExtractEventRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="ข้อความว่างเปล่า")

    try:
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You extract structured event data from Thai Facebook posts. Output JSON only."},
                {"role": "user", "content": build_prompt(text)},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        data = json.loads(clean_json_string(response.choices[0].message.content))
    except Exception as e:
        logger.error("event extraction failed: %s", e)
        raise HTTPException(status_code=502, detail=f"ดึงข้อมูลจากข้อความไม่สำเร็จ: {e}")

    # Never trust the LLM's key set or types directly -- only pass through the
    # known form fields, and flatten suitableFor to the comma-joined string
    # the admin form's input expects (same shape openEditForm() clones to).
    result = {}
    for field in EVENT_FIELDS:
        val = data.get(field)
        if field == "suitableFor" and isinstance(val, list):
            val = ", ".join(str(v).strip() for v in val if str(v).strip())
        result[field] = val if isinstance(val, str) else ""
    for field in DATE_FIELDS:
        result[field] = _valid_iso_date(data.get(field))
    # A lone end date, or an end before the start, is an LLM slip -- drop the
    # end rather than let the form save an impossible range.
    if result["eventEndDate"] and (not result["eventStartDate"] or result["eventEndDate"] < result["eventStartDate"]):
        result["eventEndDate"] = ""
    return result
