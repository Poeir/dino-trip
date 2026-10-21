""""แถว X" questions: find where X is, then rank the places around it.

The hybrid search only compares the query with a place's name, tags and
embedding, so "อยากเที่ยวแถวท่าพระ" came back with three temples elsewhere in
the province and "ร้านอาหารแถวบึงแก่นนคร" with noodle shops across town
(confirmed against the live retriever). Where a place is lives in its
coordinates and its ตำบล/อำเภอ columns, which that search never looks at.

X resolves to either an administrative area (a ตำบล or อำเภอ that places
are filed under) or a landmark (a place in the table, e.g. บึงแก่นนคร,
เซ็นทรัล ขอนแก่น). Anything else -- "แถวนี้", "ใกล้ฉัน", a name the table
doesn't have -- resolves to nothing and the caller falls back to the normal
search, so a question this can't place behaves exactly as before.

Pure functions over plain place dicts; the database reads live in
retriever.PlaceRetriever.search_chat_places.
"""
import math
import re
import unicodedata

from src.services.rag.synonyms import FILLER_WORDS, INTENT_CATEGORIES, intent_categories

AREA_MARKERS = ("แถวๆ", "แถว", "ใกล้ๆ", "ใกล้", "บริเวณ", "รอบๆ")
# Where the place name stops in "แถวเซ็นทรัลขอนแก่นมีอะไรบ้าง": Thai has no
# spaces between words, so the name runs into the rest of the question.
_STOP_PHRASES = (
    "มีอะไร", "มีร้าน", "มีที่", "มีคาเฟ่", "มีของ", "บ้าง", "หน่อย", "ไหม", "มั้ย", "ช่วย", "แนะนำ",
    "ครับ", "ค่ะ", "คะ", "นะ", "อร่อย", "ดีๆ", "สวยๆ", "เด็ดๆ", "?",
)
# Too broad to mean a neighbourhood: every place in the table is in
# ขอนแก่น, and three in four are in อำเภอเมืองขอนแก่น.
_TOO_BROAD = {"ขอนแก่น", "จังหวัดขอนแก่น", "เมืองขอนแก่น", "อำเภอเมืองขอนแก่น", "เมือง", "khonkaen"}
_ADMIN_PREFIX_RE = re.compile(r"^(ตำบล|ต\.|อำเภอ|อ\.)\s*")
_PARENTHETICAL_RE = re.compile(r"[(（][^)）]*[)）]")
# A shorter landmark key is a common word ("วัด", "ตลาด") that names no one place.
MIN_LANDMARK_CHARS = 4
# Same idea for a ตำบล/อำเภอ matched as a prefix of the text ("ในเมือง" in "ในเมืองอะมี").
MIN_ADMIN_PREFIX_CHARS = 4

TOURISM = ("สถานที่ท่องเที่ยว", "วัด", "พิพิธภัณฑ์", "สวนสาธารณะ", "ตลาด", "อุทยานแห่งชาติ", "ห้างสรรพสินค้า")
# What kind of place the rest of the question asks for, by `category`.
# Without it "ร้านอาหารแถวบึงแก่นนคร" would rank the park's other
# neighbours -- temples, a market -- alongside its restaurants.
CATEGORY_WORDS: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (("ร้านอาหาร", "อาหาร", "ของกิน", "กินข้าว", "ร้านกิน", "food", "restaurant"), ("ร้านอาหาร",)),
    (("คาเฟ่", "กาแฟ", "cafe", "coffee"), ("คาเฟ่",)),
    # Not bare "เที่ยว": "อยากเที่ยวแถวท่าพระ" means "going out around
    # there", restaurants included -- with it, ท่าพระ's one restaurant was
    # filtered out and only a golf club was left.
    (("ที่เที่ยว",), TOURISM),
    (("วัด", "ไหว้พระ"), ("วัด",)),
    (("ตลาด",), ("ตลาด",)),
    (("ห้าง",), ("ห้างสรรพสินค้า",)),
    (("พิพิธภัณฑ์",), ("พิพิธภัณฑ์",)),
    (("สวนสาธารณะ",), ("สวนสาธารณะ",)),
)
# Left over once the place, the marker and the kind of place are taken out of
# "อยากเที่ยวแถวท่าพระ ช่วยแนะนำหน่อย": if nothing else is left, the
# question asks for "anything there", not for something specific.
_GENERIC_WORDS = ("อยาก", "ไป", "เที่ยว", "ที่", "มี", "อะไร", "ไหน", "ดี", "หา", "ร้าน", "ขอ", "แนะนำ", "ช่วย",
                  "ได้", "ต้องการ", "สัก", "เอา")

LANDMARK_RADIUS_KM = 2.0
WIDER_RADIUS_KM = 5.0


def normalize(text: str) -> str:
    """Letters, marks and digits only, case-folded -- "เซ็นทรัล ขอนแก่น" and
    "เซ็นทรัลขอนแก่น" compare equal."""
    return "".join(c for c in unicodedata.normalize("NFKC", text or "").casefold() if unicodedata.category(c)[0] in "LMN")


def split_area_query(query: str) -> tuple[str, str] | None:
    """("what", "where") for "<what> แถว <where> <rest>", or None if the
    question has no area marker. `what` keeps <rest>, which often says what
    is wanted ("แถวเซ็นทรัลมีร้านอาหารไหม")."""
    hits = [(query.find(m), m) for m in AREA_MARKERS if m in query]
    if not hits:
        return None
    start, marker = min(hits, key=lambda h: (h[0], -len(h[1])))
    after = query[start + len(marker):].lstrip()
    cut = min((i for i in (after.find(s) for s in _STOP_PHRASES) if i > 0), default=len(after))
    where = after[:cut].strip()
    if not where:
        return None
    what = " ".join(f"{query[:start]} {after[cut:]}".split())
    return what, where


# What may stand right before a bare area name: "อยากเที่ยว|ท่าพระ", "ไป|ท่าพระ",
# "ร้านอาหาร|ที่|ท่าพระ", "ตำบล|ท่าพระ". Without one of these a ตำบล/อำเภอ name
# is probably part of something else ("สถานีท่าพระ", a shop's name).
BARE_AREA_PREFIXES = ("เที่ยว", "ไป", "ใน", "ที่", "ตำบล", "ต.", "อำเภอ", "อ.", "อยู่")


def split_bare_area_query(query: str, places: list[dict]) -> tuple[str, str] | None:
    """("what", "where") for an area named without "แถว", e.g. "อยากไปเที่ยวท่าพระ"
    (confirmed live: it fell to the plain search, which read "เที่ยว...พระ"
    as temples and answered with three temples elsewhere, though ท่าพระ has
    places). Only a ตำบล/อำเภอ that exists in `places` counts, after one of
    BARE_AREA_PREFIXES and followed by the end, a space or a stop phrase;
    anything else returns None and the question is searched as before.
    Landmarks need "แถว" -- "ไปบึงแก่นนคร" asks about that place itself."""
    names = {p[k] for p in places for k in ("district", "subdistrict") if p.get(k)}
    names = sorted((n for n in names if len(normalize(n)) >= MIN_ADMIN_PREFIX_CHARS and normalize(n) not in _TOO_BROAD),
                   key=len, reverse=True)
    for name in names:
        start = query.find(name)
        while start != -1:
            before, after = query[:start].rstrip(), query[start + len(name):]
            if before.endswith(BARE_AREA_PREFIXES) and (not after.strip() or after[:1].isspace() or after.lstrip().startswith(_STOP_PHRASES)):
                return " ".join(f"{before} {after}".split()), name
            start = query.find(name, start + 1)
    return None


def wanted_categories(what: str) -> list[str]:
    lowered = what.lower()
    found = [c for words, cats in CATEGORY_WORDS if any(w in lowered for w in words) for c in cats]
    return list(dict.fromkeys(found + intent_categories(what)))


def is_specific(what: str) -> bool:
    """Whether `what` asks for something narrower than a category, e.g. the
    ก๋วยเตี๋ยว in "ร้านก๋วยเตี๋ยวแถวท่าพระ"."""
    rest = what.lower()
    words = [w for words, _ in CATEGORY_WORDS for w in words]
    # "ฝนตก" names a kind of place (indoor), not something a search can rank.
    for w in sorted((*FILLER_WORDS, *_STOP_PHRASES, *words, *INTENT_CATEGORIES, *_GENERIC_WORDS), key=len, reverse=True):
        rest = rest.replace(w, " ")
    return len(normalize(rest)) >= 2


def _core_name(name: str) -> str:
    return normalize(_PARENTHETICAL_RE.sub(" ", name or ""))


def resolve_area(where: str, places: list[dict]) -> dict | None:
    """What "where" names, from the places table itself:
    {"kind": "subdistrict"|"district", "name"} or {"kind": "landmark", "place"}.
    An exact ตำบล/อำเภอ name wins, then an exact place name, then the
    longest place name the text starts with, then -- for a shortened name
    like "เซ็นทรัล" -- the most-reviewed place whose name starts with it."""
    text = _ADMIN_PREFIX_RE.sub("", where.strip())
    full = normalize(text)
    first = normalize(text.split()[0]) if text.split() else ""
    if not full or full in _TOO_BROAD or first in _TOO_BROAD:
        return None

    # อำเภอ first: "ชุมแพ" is both, and the อำเภอ contains the ตำบล.
    for kind in ("district", "subdistrict"):
        names = {normalize(p.get(kind)): p.get(kind) for p in places if p.get(kind)}
        names = {k: v for k, v in names.items() if k not in _TOO_BROAD}
        for key in (full, first):
            if key in names:
                return {"kind": kind, "name": names[key]}

    located = [p for p in places if p.get("lat") is not None and p.get("lng") is not None]
    cores = [(_core_name(p["name"]), p) for p in located]
    cores = [(c, p) for c, p in cores if len(c) >= MIN_LANDMARK_CHARS]
    exact = [p for c, p in cores if c in (full, first)]
    if exact:
        return {"kind": "landmark", "place": max(exact, key=_popularity)}
    prefixes = [(c, p) for c, p in cores if full.startswith(c)]
    if prefixes:
        longest = max(len(c) for c, _ in prefixes)
        return {"kind": "landmark", "place": max((p for c, p in prefixes if len(c) == longest), key=_popularity)}
    if len(first) >= MIN_LANDMARK_CHARS:
        starting = [p for c, p in cores if c.startswith(first)]
        if starting:
            return {"kind": "landmark", "place": max(starting, key=_popularity)}

    # Last resort: the question's tail ran into the name ("แถวในเมืองอะมีมั้ย"
    # gives "ในเมืองอะมี"), so take the longest ตำบล/อำเภอ the text starts with.
    best = None
    for kind in ("district", "subdistrict"):
        for p in places:
            n = p.get(kind)
            key = normalize(n) if n else ""
            if len(key) >= MIN_ADMIN_PREFIX_CHARS and key not in _TOO_BROAD and full.startswith(key):
                if best is None or len(key) > best[0]:
                    best = (len(key), kind, n)
    return {"kind": best[1], "name": best[2]} if best else None


def distance_km(a: dict, b: dict) -> float:
    """Straight-line (haversine) distance between two places' coordinates."""
    lat1, lng1, lat2, lng2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def _popularity(place: dict) -> tuple:
    return (place.get("review_count") or 0, place.get("rating") or 0)


def _located(place: dict) -> bool:
    return place.get("lat") is not None and place.get("lng") is not None


def area_candidates(area: dict, places: list[dict], limit: int) -> list[dict]:
    """Every place that counts as "in" the area, each copied with an
    `area_note` the answer prompt shows next to it (the model may not infer
    distances on its own, so it is told them) and an `area_tier`: 0 for the
    area proper, 1 for the ring added when the area proper is too thin.

    A ตำบล/อำเภอ: its own places, plus -- when it has fewer than `limit`,
    like ท่าพระ with two -- places within WIDER_RADIUS_KM of their centre
    (a thinly covered ตำบล is usually a rural one). A landmark: places within LANDMARK_RADIUS_KM, plus out to
    WIDER_RADIUS_KM when that finds fewer than `limit`; the landmark itself
    is left out (the question is about what is around it)."""
    if area["kind"] in ("subdistrict", "district"):
        kind, name = area["kind"], area["name"]
        label = f"{'ตำบล' if kind == 'subdistrict' else 'อำเภอ'}{name}"
        inside = [p for p in places if p.get(kind) == name]
        out = [{**p, "area_note": f"อยู่ใน{label}", "area_tier": 0} for p in inside]
        located = [p for p in inside if _located(p)]
        if len(inside) < limit and located:
            centre = {"lat": sum(p["lat"] for p in located) / len(located), "lng": sum(p["lng"] for p in located) / len(located)}
            ids = {p["id"] for p in inside}
            for p in places:
                d = distance_km(centre, p) if _located(p) and p["id"] not in ids else None
                if d is not None and d <= WIDER_RADIUS_KM:
                    out.append({**p, "area_note": f"ใกล้{label} (ห่างจากกลางย่านประมาณ {d:.1f} กม. วัดเป็นเส้นตรง)", "area_tier": 1})
        return out

    landmark = area["place"]
    near = [(distance_km(landmark, p), p) for p in places if _located(p) and p["id"] != landmark["id"]]
    close = sum(1 for d, _ in near if d <= LANDMARK_RADIUS_KM)
    radius = LANDMARK_RADIUS_KM if close >= limit else WIDER_RADIUS_KM
    return [
        {**p, "area_note": f"ห่างจาก {landmark['name']} ประมาณ {d:.1f} กม. (วัดเป็นเส้นตรง)", "area_tier": 0 if d <= LANDMARK_RADIUS_KM else 1}
        for d, p in sorted(near, key=lambda dp: dp[0]) if d <= radius
    ]


def rank_in_area(candidates: list[dict], what: str, ranked_ids: list[str] | None, limit: int) -> list[dict]:
    """The top `limit` of `candidates` for `what`.

    The kind of place asked for (CATEGORY_WORDS) filters first. For a
    specific ask, `ranked_ids` -- the normal search's order for the
    question -- decides, and only candidates that search found count: a
    noodle question gets the area's noodle shops or nothing, never its
    temples. For a generic ask ("มีอะไรบ้าง", "ร้านอาหาร") the area proper
    comes before the outer ring, most-reviewed first within each."""
    cats = wanted_categories(what)
    pool = [p for p in candidates if not cats or p.get("category") in cats]
    if ranked_ids is not None:
        by_id = {p["id"]: p for p in pool}
        return [by_id[i] for i in dict.fromkeys(ranked_ids) if i in by_id][:limit]
    return sorted(pool, key=lambda p: (p["area_tier"], *(-v for v in _popularity(p))))[:limit]
