// Plain `rating desc` lets a place with a single 5-star review outrank one
// with hundreds of reviews averaging 4.8. Rank by a Bayesian-weighted score
// instead: pull each place's rating toward the sitewide mean, weighted by
// how many reviews it has relative to `m` (the votes a place needs before
// its own rating outweighs the sitewide mean). Raising `m` above the plain
// sitewide-average review count makes review volume count for more --
// places need more reviews before their rating is trusted at face value,
// so a heavily-reviewed 4.7 can outrank a lightly-reviewed 5.0.
// https://en.wikipedia.org/wiki/Bayes_estimator#Practical_example_of_Bayes_estimators
const REVIEW_VOLUME_WEIGHT = 5

export function sortPlacesByWeightedRating(rows) {
  const rated = rows.filter((r) => r.rating != null)
  const siteMeanRating = rated.length
    ? rated.reduce((sum, r) => sum + r.rating, 0) / rated.length
    : 0
  const avgReviewCount = rated.length
    ? rated.reduce((sum, r) => sum + (r.review_count || 0), 0) / rated.length
    : 0
  const m = Math.max(avgReviewCount * REVIEW_VOLUME_WEIGHT, 1)

  const score = (r) => {
    if (r.rating == null) return -Infinity
    const v = r.review_count || 0
    return (v / (v + m)) * r.rating + (m / (v + m)) * siteMeanRating
  }

  return [...rows].sort((a, b) => score(b) - score(a))
}
