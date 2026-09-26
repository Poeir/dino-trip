from src.services.rag.synonyms import SYNONYMS, expand_query


def test_query_without_a_keyword_is_unchanged():
    assert expand_query("แนะนำร้านกาแฟ") == "แนะนำร้านกาแฟ"


def test_keyword_appends_the_real_tag():
    assert expand_query("อยากกินซูชิ") == "อยากกินซูชิ อาหารญี่ปุ่น"


def test_grilled_beef_maps_to_the_grill_tag():
    assert "หมูกระทะ/ปิ้งย่าง" in expand_query("อยากกินเนื้อย่าง")


def test_english_keywords_match_case_insensitively():
    assert "หมูกระทะ/ปิ้งย่าง" in expand_query("BBQ")
    assert "บุฟเฟต์" in expand_query("Buffet")


def test_alternate_spelling_maps_to_the_db_tag_spelling():
    assert "บุฟเฟต์" in expand_query("อยากกินบุฟเฟ่ต์")


def test_multiple_tags_are_appended_without_duplicates():
    out = expand_query("ย่างเกาหลี ซัมกยอบซัล")
    assert out.count("อาหารเกาหลี") == 1
    assert "หมูกระทะ/ปิ้งย่าง" in out


def test_every_synonym_key_is_lowercase():
    # expand_query lowercases the query, so an uppercase key could never match.
    assert all(k == k.lower() for k in SYNONYMS)
