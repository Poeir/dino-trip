"""Opening hours for the chatbot: "is it open at 01:00?" and hours text the
model can't misread.

Seen live: "หิวตอนตีหนึ่ง แถวมข.มีร้านไหนเปิดบ้าง" was answered "nothing is
open", with โจ๊กเจ้น้อย ("ทุกวัน 7:00–4:00") read as closing at 16:00 -- and
the search never looked at hours at all, though 29 food places are open at
that time.

Works on Google's `hours_periods` (places.hours_periods): days 0=Sunday..6,
a close on the next day for overnight hours, and one period with no close
for "open 24 hours". route_scheduler.check_is_open covers the trip planner
but not the early hours spilling over from the day before, which is exactly
what a 01:00 question needs.
"""
import datetime
import re

WEEK_MINUTES = 7 * 24 * 60

# "7:00–4:00": a close at or before the open is the next morning.
_RANGE_RE = re.compile(r"(\d{1,2})[:.](\d{2})\s*[–-]\s*(\d{1,2})[:.](\d{2})")


def _week_minute(point: dict) -> int:
    return (point["day"] * 24 + point["hour"]) * 60 + point.get("minute", 0)


def is_always_open(periods) -> bool:
    return bool(periods) and len(periods) == 1 and "close" not in periods[0]


def is_open_at(periods, when: datetime.datetime) -> bool | None:
    """Whether the periods cover `when`; None without hours data."""
    if not periods:
        return None
    if is_always_open(periods):
        return True
    google_day = (when.weekday() + 1) % 7
    t = (google_day * 24 + when.hour) * 60 + when.minute
    for p in periods:
        if "open" not in p or "close" not in p:
            continue
        start, end = _week_minute(p["open"]), _week_minute(p["close"])
        length = (end - start) % WEEK_MINUTES or WEEK_MINUTES
        if (t - start) % WEEK_MINUTES < length:
            return True
    return False


def _close_text(hour: int, minute: int) -> str:
    if hour == 0 and minute == 0:
        return "ปิดเที่ยงคืน"
    if 1 <= hour <= 5:
        return f"ปิดตี {hour}" + (f".{minute:02d}" if minute else "") + " ของวันถัดไป"
    return f"ปิด {hour}:{minute:02d} น. ของวันถัดไป"


def annotate_overnight(hours: str | None) -> str | None:
    """Spells out a range that runs past midnight: "ทุกวัน 7:00–4:00" ->
    "ทุกวัน 7:00–4:00 (ปิดตี 4 ของวันถัดไป)"."""
    if not hours:
        return hours

    def note(m: re.Match) -> str:
        oh, om, ch, cm = map(int, m.groups())
        if ch * 60 + cm > oh * 60 + om:
            return m.group(0)
        return f"{m.group(0)} ({_close_text(ch, cm)})"

    return _RANGE_RE.sub(note, hours)


_TI_HOURS = {"หนึ่ง": 1, "สอง": 2, "สาม": 3, "สี่": 4, "ห้า": 5}
_TI_RE = re.compile(r"ตี\s*(หนึ่ง|สอง|สาม|สี่|ห้า|[1-5])(?![0-9])")
_MIDNIGHT_WORDS = ("หลังเที่ยงคืน", "เที่ยงคืน")
_LATE_WORDS = ("เปิดดึก", "ดึกๆ", "ดึก ๆ", "กลางดึก", "ตอนดึก", "ร้านดึก", "กลางคืนดึก")
_NOW_WORDS = ("เปิดตอนนี้", "ตอนนี้เปิด", "เปิดอยู่", "ยังเปิด", "open now")
_LATE_EVENING = (23, 30)


_TIME_WORDS_RE = re.compile(
    r"ตี\s*(?:หนึ่ง|สอง|สาม|สี่|ห้า|[1-5])|หลังเที่ยงคืน|เที่ยงคืน|เปิดดึก|กลางดึก|ตอนดึก|ดึก\s*ๆ"
    r"|เปิดตอนนี้|ตอนนี้เปิด|เปิดอยู่|ยังเปิด|ตอนนี้|ตอน|เปิด|หิว"
)


def strip_time_words(text: str) -> str:
    """What's left of an area question once the time it asks about is out:
    "หิวตอนตีหนึ่ง มีร้านไหนเปิดบ้าง" names no particular dish, so the area's
    open places are ranked as they are, not by a search for those words."""
    return " ".join(_TIME_WORDS_RE.sub(" ", text).split())


def requested_time(query: str, now: datetime.datetime) -> tuple[datetime.datetime, str] | None:
    """The time a question asks about being open, with a Thai label for the
    prompt -- "ตีหนึ่ง" is tonight's 01:00, "เปิดดึก" 23:30 -- or None."""
    lowered = query.lower()

    def tonight(hour: int, minute: int = 0) -> datetime.datetime:
        # Before 06:00 "ตีหนึ่ง" still means the night that is under way.
        day = now.date() if now.hour < 6 and hour < 6 else now.date() + datetime.timedelta(days=1 if hour < 6 else 0)
        return datetime.datetime.combine(day, datetime.time(hour, minute), tzinfo=now.tzinfo)

    m = _TI_RE.search(lowered)
    if m:
        hour = _TI_HOURS.get(m.group(1)) or int(m.group(1))
        return tonight(hour), f"ตี {hour} คืนนี้"
    if any(w in lowered for w in _MIDNIGHT_WORDS):
        return tonight(0, 30), "หลังเที่ยงคืนคืนนี้ (00:30 น.)"
    if any(w in lowered for w in _LATE_WORDS):
        if now.hour >= 23 or now.hour < 5:
            return now, "ตอนนี้"
        return tonight(*_LATE_EVENING), "ช่วงดึกคืนนี้ (23:30 น.)"
    if any(w in lowered for w in _NOW_WORDS):
        return now, "ตอนนี้"
    return None
