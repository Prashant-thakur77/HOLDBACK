"""Proportions with Wilson intervals, the three classification metrics, and percentiles."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence

# Two-sided 95% normal quantile.
Z_95 = 1.959963984540054


def wilson_interval(successes: int, n: int, z: float = Z_95) -> Optional[tuple[float, float]]:
    """Wilson score interval for a binomial proportion; `None` when there is nothing to count.

    Chosen over the normal approximation because it stays inside [0, 1] and behaves at
    0/n and n/n, which is where small evaluation sets end up.
    """
    if n < 0 or successes < 0 or successes > n:
        raise ValueError("need 0 <= successes <= n")
    if n == 0:
        return None
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    # At 0/n and n/n the outer bound is exactly 0 or 1; say so instead of 0.9999999999999999.
    low = 0.0 if successes == 0 else max(0.0, centre - half)
    high = 1.0 if successes == n else min(1.0, centre + half)
    return (low, high)


@dataclass(frozen=True)
class Proportion:
    """`successes` out of `n`, with its 95% Wilson interval. `value` is `None` when n is 0."""

    successes: int
    n: int

    @property
    def value(self) -> Optional[float]:
        return self.successes / self.n if self.n else None

    @property
    def interval(self) -> Optional[tuple[float, float]]:
        return wilson_interval(self.successes, self.n)

    def to_json(self) -> dict:
        interval = self.interval
        return {
            "successes": self.successes,
            "n": self.n,
            "value": self.value,
            "ci95_low": interval[0] if interval else None,
            "ci95_high": interval[1] if interval else None,
        }


def classification_metrics(scam_flagged: Sequence[bool], legit_flagged: Sequence[bool]) -> dict:
    """Recall, false-positive rate and precision from per-address decisions.

    `scam_flagged[i]` is whether scam address i was flagged; likewise for legit addresses.
    Precision depends on the scam:legit ratio of the set it is computed on, so it describes
    this dataset, not real traffic.
    """
    tp = sum(1 for flagged in scam_flagged if flagged)
    fp = sum(1 for flagged in legit_flagged if flagged)
    return {
        "recall": Proportion(tp, len(scam_flagged)).to_json(),
        "false_positive_rate": Proportion(fp, len(legit_flagged)).to_json(),
        "precision": Proportion(tp, tp + fp).to_json(),
    }


def percentile(values: Sequence[float], q: float) -> Optional[float]:
    """The q-th percentile (0..100) with linear interpolation; `None` for no values."""
    if not 0 <= q <= 100:
        raise ValueError("q must be within 0..100")
    if not values:
        return None
    ordered = sorted(values)
    rank = (len(ordered) - 1) * q / 100
    low = math.floor(rank)
    high = math.ceil(rank)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


def median(values: Sequence[float]) -> Optional[float]:
    return percentile(values, 50)
