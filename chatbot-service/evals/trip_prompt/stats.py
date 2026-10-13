"""Small statistics helpers for report.py. Standard library only (scipy is used
for t quantiles when installed, otherwise the normal approximation).
"""
import random
import statistics
from statistics import NormalDist

BOOT_N = 10_000
BOOT_SEED = 20261007  # fixed so the same data always gives the same interval


def _mean(xs):
    return statistics.fmean(xs)


def paired_bootstrap(variant_reps, baseline_reps, n_boot=BOOT_N, seed=BOOT_SEED, alpha=0.05):
    """Two-level paired bootstrap of the mean case-level difference.

    variant_reps / baseline_reps: {case: [score per rep]}. Each draw resamples
    the cases with replacement, then resamples the reps inside each drawn case
    (separately for variant and baseline), so both the choice of cases and the
    rep-to-rep noise are reflected in the interval.
    Returns (point_delta, lo, hi) over the cases both sides have, or None.
    """
    cases = sorted(set(variant_reps) & set(baseline_reps))
    if not cases:
        return None
    point = _mean([_mean(variant_reps[c]) - _mean(baseline_reps[c]) for c in cases])
    rng = random.Random(seed)
    n = len(cases)
    draws = []
    for _ in range(n_boot):
        ds = []
        for _ in range(n):
            c = cases[rng.randrange(n)]
            v, b = variant_reps[c], baseline_reps[c]
            ds.append(_mean(rng.choices(v, k=len(v))) - _mean(rng.choices(b, k=len(b))))
        draws.append(_mean(ds))
    draws.sort()
    lo = draws[int(n_boot * alpha / 2)]
    hi = draws[int(n_boot * (1 - alpha / 2)) - 1]
    return point, lo, hi


def min_detectable_effect(case_diffs, power=0.8, alpha=0.05):
    """Smallest true mean case-level difference a paired test on these cases
    would detect with the given power (approximate; uses the observed spread of
    the case differences, so it is itself an estimate)."""
    n = len(case_diffs)
    if n < 2:
        return None
    sd = statistics.stdev(case_diffs)
    try:
        from scipy.stats import t
        crit = t.ppf(1 - alpha / 2, n - 1) + t.ppf(power, n - 1)
    except ImportError:
        nd = NormalDist()
        crit = nd.inv_cdf(1 - alpha / 2) + nd.inv_cdf(power)
    return crit * sd / n ** 0.5


def _ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def spearman(xs, ys):
    """Spearman rank correlation with average ranks for ties; None if undefined."""
    if len(xs) != len(ys) or len(xs) < 3:
        return None
    rx, ry = _ranks(xs), _ranks(ys)
    mx, my = _mean(rx), _mean(ry)
    sx = sum((a - mx) ** 2 for a in rx)
    sy = sum((b - my) ** 2 for b in ry)
    if sx == 0 or sy == 0:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(rx, ry)) / (sx * sy) ** 0.5
