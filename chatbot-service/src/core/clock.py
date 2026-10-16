"""Thailand's wall clock, independent of the process clock.

The production container runs in UTC, so `datetime.now()` / `date.today()`
are 7 hours behind: "is it open now" answers were off by 7 hours, and between
00:00 and 07:00 Thai time "today" was still yesterday.
"""
import datetime

# Thailand has no DST, so a fixed offset is exact and needs no tz database.
BANGKOK_TZ = datetime.timezone(datetime.timedelta(hours=7))


def now_bangkok() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc).astimezone(BANGKOK_TZ)


def today_bangkok() -> datetime.date:
    return now_bangkok().date()
