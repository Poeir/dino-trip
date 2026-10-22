// Prices used to show "this click costs about ฿X" next to the admin buttons that call
// a paid API. Estimates only: Google Cloud Billing is the source of truth, and nothing
// here is stored. These are the first paid tier of each SKU from Google's Places API
// (New) price list, checked 2026-10-20. Each Google SKU also has a monthly free
// allowance (`freePerMonth`) that the per-click figures do NOT deduct.
export const PRICING_CHECKED_AT = '2026-10-20'

export const THB_PER_USD = Number(process.env.THB_PER_USD) || 35

const num = (v, fallback) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback)

export const SKUS = {
  'places.text_search.pro': { usdPer1000: 32, freePerMonth: 5000 },
  'places.nearby.enterprise': { usdPer1000: 35, freePerMonth: 1000 },
  // chatbot-service's Google fallback (rag/google_fallback.py): Text Search with
  // hours/reviews/price fields, the Enterprise + Atmosphere tier.
  'places.text_search.enterprise_atmosphere': { usdPer1000: 40, freePerMonth: 1000 },
  'places.details.enterprise': {
    usdPer1000: num(process.env.PLACES_DETAILS_USD_PER_1000, 20),
    freePerMonth: num(process.env.PLACES_FREE_CALLS_PER_MONTH, 1000),
  },
  'places.details.enterprise_atmosphere': { usdPer1000: 25, freePerMonth: 1000 },
  'places.photo': { usdPer1000: 7, freePerMonth: 1000 },
  // Serper sells prepaid packs ($1.00 per 1,000 at the smallest pack, cheaper in bulk) and its
  // own site doesn't publish them; that figure comes from third-party write-ups, so treat it as unverified.
  'serper.search': { usdPer1000: num(process.env.SERPER_USD_PER_1000, 1), freePerMonth: 0 },
  // The LLM gateway's price is unknown here (it may be a free university quota): 0 until LLM_USD_PER_1000 is set.
  'llm.request': { usdPer1000: num(process.env.LLM_USD_PER_1000, 0), freePerMonth: 0 },
}

// Photos per imported place (placeImport.js MAX_PHOTOS_PER_PLACE): the ceiling used for "up to" estimates.
export const MAX_PHOTOS_PER_PLACE = 5

// Gross: no monthly free allowance deducted -- what an action costs "on paper".
export function grossCostThb(unitsBySku) {
  const usd = Object.entries(unitsBySku).reduce((sum, [sku, units]) => sum + (units / 1000) * (SKUS[sku]?.usdPer1000 ?? 0), 0)
  return Math.round(usd * THB_PER_USD * 100) / 100
}

// "Up to" cost of importing one new place: Details (Atmosphere) + every photo.
export const importPerPlaceThb = () =>
  grossCostThb({ 'places.details.enterprise_atmosphere': 1, 'places.photo': MAX_PHOTOS_PER_PLACE })

// Per-click ceilings the admin UI shows (GET /api/admin/cost-estimates), one source of truth.
export function getCostEstimates() {
  return {
    syncPerPlaceThb: grossCostThb({ 'places.details.enterprise': 1 }),
    importPerPlaceThb: importPerPlaceThb(),
    describePerPlaceThb: grossCostThb({ 'serper.search': 1, 'llm.request': 1 }),
    textSearchThb: grossCostThb({ 'places.text_search.pro': 1 }),
    nearbySearchThb: grossCostThb({ 'places.nearby.enterprise': 1 }),
    chatFallbackSearchThb: grossCostThb({ 'places.text_search.enterprise_atmosphere': 1 }),
    thbPerUsd: THB_PER_USD,
    checkedAt: PRICING_CHECKED_AT,
    freeCallsPerMonth: SKUS['places.details.enterprise'].freePerMonth,
  }
}
