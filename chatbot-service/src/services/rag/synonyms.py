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
    # Trip-planner interest categories (TripFormPage) reuse this same tag
    # vocabulary, so these gaps affect both the chatbot and "what places match
    # my interests" trip planning -- found by probing each of the 7 interest
    # tags with colloquial phrasings a user might actually type.
    "สายมู": ["วัฒนธรรม/ศาสนา"],  # fortune-telling/spiritual-tourism slang
    "ซากดึกดำบรรพ์": ["ไดโนเสาร์"],
    "dino": ["ไดโนเสาร์"],
    "งานฝีมือ": ["ช้อปปิ้ง/หัตถกรรม"],
    # Culture / shopping
    # Regression: "ขอวัดในเมือง" retrieved none of the ~10 วัด-category
    # places despite word_similarity(name, query_text) -- "วัด" is too short
    # relative to a name like "วัดป่าธรรมอุทยาน" to clear the 0.3 threshold,
    # and the tag substring check only ever saw "วัฒนธรรม"/"ศาสนา", never "วัด".
    "วัด": ["วัฒนธรรม/ศาสนา"],
    "ทำบุญ": ["วัฒนธรรม/ศาสนา"],
    "ขอพร": ["วัฒนธรรม/ศาสนา"],
    "ไหว้พระ": ["วัฒนธรรม/ศาสนา"],
    "ของฝาก": ["ช้อปปิ้ง/หัตถกรรม"],
    # Same short-name-vs-long-name gap as "วัด" above, found by probing every
    # place `category` value the same way: "อุทยานแห่งชาติ" (the category)
    # isn't itself in any place's `tags` (those places are tagged "ธรรมชาติ"),
    # so a generic "ขออุทยานแห่งชาติ..." query missed all of them even though
    # asking for a specific park by name ("อุทยานแห่งชาติภูเวียง") works fine.
    "อุทยานแห่งชาติ": ["ธรรมชาติ"],
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
