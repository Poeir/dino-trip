// Default public ordering ("recommended"): admin-featured places first, then
// by a popularity score -- rating x ln(1 + reviews) -- so well-known places
// (thousands of reviews) outrank a 4.9 with a few hundred. Restaurants and
// cafes (~70% of the catalogue) are down-weighted so that, in the mixed
// "all" view, sights and landmarks aren't buried under food.
// Other modes: 'popular' (review count) and 'topRated' (Bayesian-weighted
// rating: pulls each rating toward the sitewide mean by review volume, so a
// single 5-star review can't outrank hundreds averaging 4.8).
// https://en.wikipedia.org/wiki/Bayes_estimator#Practical_example_of_Bayes_estimators
const REVIEW_VOLUME_WEIGHT = 5

const CATEGORY_WEIGHT = { 'ร้านอาหาร': 0.7, 'คาเฟ่': 0.7 }

function bayesianScorer(rows) {
  const rated = rows.filter((r) => r.rating != null)
  const siteMeanRating = rated.length
    ? rated.reduce((sum, r) => sum + r.rating, 0) / rated.length
    : 0
  const avgReviewCount = rated.length
    ? rated.reduce((sum, r) => sum + (r.review_count || 0), 0) / rated.length
    : 0
  const m = Math.max(avgReviewCount * REVIEW_VOLUME_WEIGHT, 1)
  return (r) => {
    if (r.rating == null) return -Infinity
    const v = r.review_count || 0
    return (v / (v + m)) * r.rating + (m / (v + m)) * siteMeanRating
  }
}

const popularityScore = (r) => (r.rating == null ? 0 : r.rating * Math.log(1 + (r.review_count || 0))) * (CATEGORY_WEIGHT[r.category] ?? 1)

export function sortPlacesByRanking(rows, query = {}) {
  if (query.sort === 'popular') {
    return [...rows].sort((a, b) => (b.review_count || 0) - (a.review_count || 0))
  }
  if (query.sort === 'topRated') {
    const score = bayesianScorer(rows)
    return [...rows].sort((a, b) => score(b) - score(a))
  }
  return [...rows].sort((a, b) => (Number(!!b.is_featured) - Number(!!a.is_featured)) || (popularityScore(b) - popularityScore(a)))
}
