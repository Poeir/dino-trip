"""Curated synonyms for retrieval gaps where neither vector similarity nor
keyword/tag matching (see 20260728000007+ hybrid-search migrations) connects
a colloquial query to the actual tag vocabulary populated by
backend/scripts/import-places*.js. These are real relationships (e.g. sushi
IS Japanese food), not something a string-matching or embedding-similarity
approach can be expected to infer on its own.

Found by directly testing category-style queries against the live retriever
(confirmed zero/wrong results before this table existed) rather than
speculatively guessing entries -- see the session notes in the phase plan.
Extend this list the same way: test first, only add a confirmed gap.
"""

SYNONYMS: dict[str, list[str]] = {
    # Japanese
    "ซูชิ": ["อาหารญี่ปุ่น"],
    "ซาชิมิ": ["อาหารญี่ปุ่น"],
    "ปลาดิบ": ["อาหารญี่ปุ่น"],
    "ชาบู": ["อาหารญี่ปุ่น"],
    "ราเมน": ["อาหารญี่ปุ่น"],
    "อุด้ง": ["อาหารญี่ปุ่น"],
    "เทมปุระ": ["อาหารญี่ปุ่น"],
    # Korean
    "กิมจิ": ["อาหารเกาหลี"],
    "ต๊อกบกกี": ["อาหารเกาหลี"],
    "ซัมกยอบซัล": ["อาหารเกาหลี", "หมูกระทะ/ปิ้งย่าง"],
    "ย่างเกาหลี": ["อาหารเกาหลี", "หมูกระทะ/ปิ้งย่าง"],
    "บิบิมบับ": ["อาหารเกาหลี"],
    "ไก่ทอดเกาหลี": ["อาหารเกาหลี"],
    "หม้อไฟเกาหลี": ["อาหารเกาหลี"],
    # Grill / BBQ
    "เนื้อย่าง": ["หมูกระทะ/ปิ้งย่าง"],
    "บาร์บีคิว": ["หมูกระทะ/ปิ้งย่าง"],
    "bbq": ["หมูกระทะ/ปิ้งย่าง"],
    # Other cuisines / food types
    "ตำลาว": ["ส้มตำ"],
    "ตำไทย": ["ส้มตำ"],
    "ตำปูปลาร้า": ["ส้มตำ"],
    "จิ้มจุ่ม": ["สุกี้"],
    "หม้อไฟ": ["สุกี้"],
    "บุฟเฟ่ต์": ["บุฟเฟต์"],
    "buffet": ["บุฟเฟต์"],
    "กินไม่อั้น": ["บุฟเฟต์"],
    "โจ๊ก": ["อาหารเช้า"],
    "ติ่มซำ": ["อาหารเช้า"],
    "ปาท่องโก๋": ["อาหารเช้า"],
    "กาแฟโบราณ": ["อาหารเช้า"],
    "พาสต้า": ["อาหารอิตาเลียน"],
    "เฝอ": ["อาหารเวียดนาม"],
    "burger": ["เบอร์เกอร์"],
    "ซีฟู้ด": ["อาหารทะเล"],
    "seafood": ["อาหารทะเล"],
    "ปูนึ่ง": ["อาหารทะเล"],
    "ขนมหวาน": ["ของหวาน"],
    "ขนมไทย": ["ของหวาน"],
    "บิงซู": ["ของหวาน"],
    "เครป": ["ของหวาน"],
    "ครัวซองต์": ["เบเกอรี่"],
    "อาหารตามสั่ง": ["อาหารไทย"],
    "ผัดกะเพรา": ["อาหารไทย"],
    # Bars
    "เบียร์": ["บาร์"],
    "ค็อกเทล": ["บาร์"],
    # Culture / shopping
    "ทำบุญ": ["วัฒนธรรม/ศาสนา"],
    "ขอพร": ["วัฒนธรรม/ศาสนา"],
    "ของฝาก": ["ช้อปปิ้ง/หัตถกรรม"],
}


def expand_query(query: str) -> str:
    """Appends any matched synonym tags onto the query text, so both the
    embedding step and the hybrid-search tag-substring check benefit --
    neither needs to know about the mapping itself, they just see a query
    that already contains the real tag word."""
    lowered = query.lower()  # so "BBQ"/"Buffet" match the lowercase English keys
    extra_tags = [tag for keyword, tags in SYNONYMS.items() if keyword in lowered for tag in tags]
    if not extra_tags:
        return query
    return query + " " + " ".join(dict.fromkeys(extra_tags))
