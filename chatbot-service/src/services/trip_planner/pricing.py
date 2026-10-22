"""Price tiers of restaurants and cafes, and which tiers each budget level takes.

Google's price_level is too coarse for this: level 2 covers both ฿200-400
places (160 of them) and ฿800-1,000 steak houses, and nothing in `places`
is rated 3 or 4 (live 2026-10-22). The `price` column has Google's range
per person ("฿600-800 ต่อคน"), so a tier comes from that, and from
price_level only when there's no range.

Budget only applies to food and drink (PRICED_CATEGORIES): a temple or park
costs the same on every budget, so other categories pass on any budget
(apart from orchestrator.BUDGET_EXCLUDED_CATEGORIES).
"""
import re
from typing import Optional, Tuple

PRICED_CATEGORIES = ("ร้านอาหาร", "คาเฟ่")
BREAKFAST_SUBCATEGORY = "อาหารเช้า"

PREMIUM = "premium"
MID = "mid"
CHEAP = "cheap"

# A range starting at ฿400+, or from ฿200 reaching ฿800+, is a premium place
# ("฿1-800" is a cheap shop with a few dear items, not premium); one that
# tops out at ฿200 is cheap; the rest are mid.
PREMIUM_MIN_FROM = 400
PREMIUM_MIN_UPTO = 800
PREMIUM_WIDE_MIN_FROM = 200
CHEAP_MAX_UPTO = 200

_RANGE = re.compile(r"(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)")

# Tiers each budget takes, best first (None = price unknown).
# "strict" is for the candidates the LLM picks from; "meal" is the fallback
# for meals, which every day must have even when the strict tiers can't
# supply one nearby and open at the right time.
LUXURY = "หรูหรา"
_BUDGET_TIERS = {
    "ประหยัด": {"strict": (CHEAP, None), "meal": (CHEAP, None)},
    LUXURY: {"strict": (PREMIUM,), "meal": (PREMIUM, MID, None)},
}


def price_range(price: Optional[str]) -> Optional[Tuple[int, int]]:
    """(from, upto) baht per person from text like "฿600-800 ต่อคน"."""
    if not price:
        return None
    m = _RANGE.search(price)
    if not m:
        return None
    lo, hi = (int(g.replace(",", "")) for g in m.groups())
    return (lo, hi) if lo <= hi else (hi, lo)


def price_tier(place) -> Optional[str]:
    rng = price_range(getattr(place, "price", None))
    if rng:
        lo, hi = rng
        if lo >= PREMIUM_MIN_FROM or (lo >= PREMIUM_WIDE_MIN_FROM and hi >= PREMIUM_MIN_UPTO):
            return PREMIUM
        if hi <= CHEAP_MAX_UPTO:
            return CHEAP
        return MID
    level = getattr(place, "price_level", None)
    if level is None:
        return None
    if level <= 1:
        return CHEAP
    return MID if level == 2 else PREMIUM


def fits_budget(place, budget_level: str, meal: bool = False) -> bool:
    """Whether `place` may be in a trip of this budget. `meal=True` is the
    looser rule for restaurants brought in to serve a meal. Breakfast shops
    are always allowed for a meal: they're cheap by nature, and a premium
    trip still eats breakfast."""
    if place.category not in PRICED_CATEGORIES:
        return True
    tiers = _BUDGET_TIERS.get(budget_level)
    if tiers is None:
        return True
    if meal and place.subcategory == BREAKFAST_SUBCATEGORY:
        return True
    return price_tier(place) in tiers["meal" if meal else "strict"]


def budget_rank(place, budget_level: str) -> int:
    """0 for the tier this budget wants most, higher for worse fits."""
    tiers = _BUDGET_TIERS.get(budget_level)
    if tiers is None or place.category not in PRICED_CATEGORIES:
        return 0
    order = tiers["meal"]
    tier = price_tier(place)
    return order.index(tier) if tier in order else len(order)


def budget_sort_key(place, budget_level: str) -> Tuple[int, int, int]:
    """budget_rank, then for หรูหรา the dearest first (by where the range
    starts, then ends): "฿800-1000" before "฿200-1200". Without it a luxury
    trip took the first premium restaurants in search order, mostly
    wide-range ones (live 2026-10-22)."""
    rank = budget_rank(place, budget_level)
    if budget_level != LUXURY or place.category not in PRICED_CATEGORIES:
        return (rank, 0, 0)
    lo, hi = price_range(getattr(place, "price", None)) or (0, 0)
    return (rank, -lo, -hi)


def visit_price(place) -> Optional[int]:
    """Estimated baht per person: the middle of the price range, if any."""
    rng = price_range(getattr(place, "price", None))
    if not rng:
        return None
    return round(sum(rng) / 2)
