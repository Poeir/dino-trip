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
    "ซูชิ": ["อาหารญี่ปุ่น"],
    "ปลาดิบ": ["อาหารญี่ปุ่น"],
    "ชาบู": ["อาหารญี่ปุ่น"],
    "กิมจิ": ["อาหารเกาหลี"],
    "ต๊อกบกกี": ["อาหารเกาหลี"],
    "เบียร์": ["บาร์"],
    "ค็อกเทล": ["บาร์"],
}


def expand_query(query: str) -> str:
    """Appends any matched synonym tags onto the query text, so both the
    embedding step and the hybrid-search tag-substring check benefit --
    neither needs to know about the mapping itself, they just see a query
    that already contains the real tag word."""
    extra_tags = [tag for keyword, tags in SYNONYMS.items() if keyword in query for tag in tags]
    if not extra_tags:
        return query
    return query + " " + " ".join(dict.fromkeys(extra_tags))
