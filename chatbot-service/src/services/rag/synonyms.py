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
    # "ร้านกินดื่มกลางคืน" / "ร้านนั่งดื่มตอนกลางคืน" returned a late-night
    # restaurant and a milk shop but none of the 9 places tagged บาร์.
    "กินดื่ม": ["บาร์"],
    "นั่งดื่ม": ["บาร์"],
    "ร้านเหล้า": ["บาร์"],
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
    # ผ้าไหม: the knowledge-base article on Khon Kaen silk is the one
    # souvenir answer the KB has, and "ซื้อของฝากที่ไหนดี" alone didn't reach it.
    "ของฝาก": ["ช้อปปิ้ง/หัตถกรรม", "ผ้าไหม"],
    # Same short-name-vs-long-name gap as "วัด" above, found by probing every
    # place `category` value the same way: "อุทยานแห่งชาติ" (the category)
    # isn't itself in any place's `tags` (those places are tagged "ธรรมชาติ"),
    # so a generic "ขออุทยานแห่งชาติ..." query missed all of them even though
    # asking for a specific park by name ("อุทยานแห่งชาติภูเวียง") works fine.
    "อุทยานแห่งชาติ": ["ธรรมชาติ"],
}

# Local nicknames that resolve to one specific place *name*, not a tag --
# unlike SYNONYMS above, blending the real name into the original (longer)
# query text wasn't enough: word_similarity(p.name, query_text) still has to
# win greatest(embedding_similarity, word_similarity, tag_match) against
# every other row, and confirmed testing showed "วัดเก้าชั้นในขอนแก่น
# วัฒนธรรม/ศาสนา พระมหาธาตุแก่นนคร" still ranked พระมหาธาตุแก่นนคร dead last
# (15th) even though it cleared the match threshold -- while searching
# "พระมหาธาตุแก่นนคร" alone ranks it #1. So these run as their own clean
# search variant (see retriever.search_and_expand) instead of being appended.
ALIASES: dict[str, str] = {
    "วัดเก้าชั้น": "พระมหาธาตุแก่นนคร",
    "พระธาตุเก้าชั้น": "พระมหาธาตุแก่นนคร",
}


# Questions that name a *kind* of place by the situation rather than by a
# word any place carries -- no place is tagged "ฝนตก" -- mapped to the
# `category` values that answer them. Unlike SYNONYMS these restrict the
# chatbot's place results to those categories (retriever.search_chat_places):
# confirmed against the live retriever, "ฝนตกควรไปเที่ยวไหนดี" returned
# three parks and "ที่เที่ยวในร่ม" three hillside spots at ภูผาม่าน, and
# "ซื้อของฝากที่ไหนดี" a market and two hot-pot restaurants instead of
# the souvenir shops.
_INDOOR = ("พิพิธภัณฑ์", "ห้างสรรพสินค้า")
INTENT_CATEGORIES: dict[str, tuple[str, ...]] = {
    "ฝนตก": _INDOOR,
    "หลบฝน": _INDOOR,
    "ในร่ม": _INDOOR,
    "indoor": _INDOOR,
    "rainy": _INDOOR,
    "ของฝาก": ("ร้านของฝาก",),
    "souvenir": ("ร้านของฝาก",),
}


# Same idea for a need an `amenities` value answers. "ร้านอาหารมังสวิรัติ"
# came back with a beef noodle shop and two grills: 17 places carry
# "มีเมนูมังสวิรัติ" (Google's servesVegetarianFood), but only in amenities
# and deep in the description, which the search doesn't weigh.
VEGETARIAN = "มีเมนูมังสวิรัติ"
INTENT_AMENITIES: dict[str, str] = {
    "มังสวิรัติ": VEGETARIAN,
    "วีแกน": VEGETARIAN,
    "vegan": VEGETARIAN,
    "vegetarian": VEGETARIAN,
    "อาหารเจ": VEGETARIAN,
    "กินเจ": VEGETARIAN,
    "ไม่กินเนื้อ": VEGETARIAN,
    "ไม่ทานเนื้อ": VEGETARIAN,
}


def intent_amenities(query: str) -> list[str]:
    lowered = query.lower()
    return list(dict.fromkeys(a for keyword, a in INTENT_AMENITIES.items() if keyword in lowered))


def intent_categories(query: str) -> list[str]:
    lowered = query.lower()
    return list(dict.fromkeys(c for keyword, cats in INTENT_CATEGORIES.items() if keyword in lowered for c in cats))


def alias_variants(query: str) -> list[str]:
    lowered = query.lower()
    return list(dict.fromkeys(name for keyword, name in ALIASES.items() if keyword in lowered))

# Generic filler words that dilute both the keyword match (word_similarity
# against the place's *name*) and the embedding -- confirmed by testing
# against the live retriever: "ร้านก๋วยเตี๋ยวแถวท่าพระ" returned 5 วัด results
# and zero ก๋วยเตี๋ยว, while the stripped "ก๋วยเตี๋ยวท่าพระ" alone returned the
# right ones. Substring removal, same style as the keyword check above --
# there's no Thai word-tokenizer here, and these are distinctive enough
# multi-character strings that an accidental mid-word match is unlikely.
# Never used to *replace* the original query, only to add a second search
# variant that callers merge in, so a bad strip can only add candidates,
# never drop ones the original query already found.
FILLER_WORDS = ("อยากกิน", "อยากไป", "อยาก", "ร้าน", "แถว", "บริเวณ", "ใกล้ๆ", "ใกล้", "หน่อย")


def strip_filler(query: str) -> str | None:
    """None if stripping had no effect (nothing to search a second time for)."""
    stripped = query
    for w in FILLER_WORDS:
        stripped = stripped.replace(w, " ")
    stripped = " ".join(stripped.split())
    return stripped if stripped and stripped != query else None


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
