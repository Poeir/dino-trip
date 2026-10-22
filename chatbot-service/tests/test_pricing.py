"""pricing.py: price tiers from Google's per-person range, and budget rules."""
import pytest

from src.services.trip_planner import pricing
from src.services.trip_planner.models import Place


def place(category="ร้านอาหาร", price=None, price_level=None, subcategory=None):
    return Place(id="p", name="p", category=category, price=price, price_level=price_level, subcategory=subcategory)


@pytest.mark.parametrize("price, price_level, tier", [
    ("฿800-1000 ต่อคน", 2, pricing.PREMIUM),
    ("฿400-600 ต่อคน", 2, pricing.PREMIUM),
    ("฿200-800 ต่อคน", 2, pricing.PREMIUM),
    ("฿1-800 ต่อคน", 2, pricing.MID),       # a cheap shop with a few dear items
    ("฿200-400 ต่อคน", 2, pricing.MID),     # price_level 2, but not premium
    ("฿1-400 ต่อคน", 1, pricing.MID),
    ("฿1-200 ต่อคน", 1, pricing.CHEAP),
    ("สอบถามราคาหน้าร้าน", 1, pricing.CHEAP),  # no range: falls back to price_level
    ("สอบถามราคาหน้าร้าน", 2, pricing.MID),
    (None, None, None),
])
def test_price_tier(price, price_level, tier):
    assert pricing.price_tier(place(price=price, price_level=price_level)) == tier


def test_luxury_takes_only_premium_food_for_candidates():
    assert pricing.fits_budget(place(price="฿600-800 ต่อคน"), "หรูหรา")
    assert not pricing.fits_budget(place(price="฿200-400 ต่อคน"), "หรูหรา")
    assert not pricing.fits_budget(place(category="คาเฟ่"), "หรูหรา")  # unknown price


def test_luxury_meals_fall_back_to_mid_and_unknown_but_never_cheap():
    assert pricing.fits_budget(place(price="฿200-400 ต่อคน"), "หรูหรา", meal=True)
    assert pricing.fits_budget(place(), "หรูหรา", meal=True)
    assert not pricing.fits_budget(place(price="฿1-200 ต่อคน"), "หรูหรา", meal=True)


def test_breakfast_shops_serve_breakfast_on_any_budget():
    shop = place(price="฿1-200 ต่อคน", subcategory="อาหารเช้า")
    assert pricing.fits_budget(shop, "หรูหรา", meal=True)


def test_economy_drops_mid_and_premium_food():
    assert pricing.fits_budget(place(price="฿1-200 ต่อคน"), "ประหยัด")
    assert pricing.fits_budget(place(), "ประหยัด")
    assert not pricing.fits_budget(place(price="฿200-400 ต่อคน"), "ประหยัด")
    assert not pricing.fits_budget(place(price="฿600-800 ต่อคน"), "ประหยัด")


@pytest.mark.parametrize("budget", ["ประหยัด", "ปานกลาง", "หรูหรา"])
def test_non_food_places_pass_every_budget(budget):
    assert pricing.fits_budget(place(category="วัด", price="฿200-400 ต่อคน", price_level=2), budget)
    assert pricing.fits_budget(place(category="ห้างสรรพสินค้า"), budget)


def test_standard_budget_takes_everything_unranked():
    for p in (place(price="฿1-200 ต่อคน"), place(price="฿600-800 ต่อคน"), place()):
        assert pricing.fits_budget(p, "ปานกลาง")
        assert pricing.budget_rank(p, "ปานกลาง") == 0


def test_luxury_rank_puts_premium_first():
    ranks = [pricing.budget_rank(place(price=p), "หรูหรา") for p in ("฿600-800 ต่อคน", "฿200-400 ต่อคน", None, "฿1-200 ต่อคน")]
    assert ranks == sorted(ranks) and len(set(ranks)) == 4


def test_luxury_sorts_the_dearest_first():
    prices = ["฿200-1200 ต่อคน", "฿200-400 ต่อคน", "฿800-1000 ต่อคน", "฿400-600 ต่อคน"]
    ordered = sorted((place(price=p) for p in prices), key=lambda p: pricing.budget_sort_key(p, "หรูหรา"))
    assert [p.price for p in ordered] == ["฿800-1000 ต่อคน", "฿400-600 ต่อคน", "฿200-1200 ต่อคน", "฿200-400 ต่อคน"]


def test_visit_price_is_the_middle_of_the_range():
    assert pricing.visit_price(place(price="฿800-1000 ต่อคน")) == 900
    assert pricing.visit_price(place(price="ไม่มีค่าเข้า")) is None
