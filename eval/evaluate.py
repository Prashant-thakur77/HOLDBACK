"""Turns per-address decisions into the published metrics. Pure: no network, no files.

Both the blocklist baseline and the Guardian run go through `split_metrics`, so the two are
scored by the same code on the same rows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Mapping, Optional, Sequence

import config
from dataset import FRESH, LEGIT, SCAM, Row, stated_amount
from metrics import Proportion, classification_metrics, median, percentile
from replay import Payment, payment_amount, replay_table
from splits import DEV, HELDOUT, UNDATED

# Policy 1.0.0: a score from 30 is SUSPICIOUS, and these signals set a tier on their own.
SUSPICIOUS_SCORE = 30
TIER_SETTING_SIGNALS = {
    ("blocklist", "ofac_sanctioned"),
    ("blocklist", "scam_list_address"),
    ("chainabuse", "confirmed_reports"),
}


def tier_at_least(tier: str, threshold: str = config.DETECTION_TIER) -> bool:
    return config.TIERS.index(tier) >= config.TIERS.index(threshold)


@dataclass(frozen=True)
class Assessment:
    """What the Guardian answered for one recipient."""

    address: str
    tier: str
    window_secs: int
    score: int
    latency_ms: float
    server_latency_ms: float
    unavailable: tuple[str, ...] = ()
    # (collector, signal, points) for every evidence item.
    evidence: tuple[tuple[str, str, int], ...] = field(default_factory=tuple)

    @property
    def flagged(self) -> bool:
        return tier_at_least(self.tier)


def independent_flag(assessment: Assessment, label_sources: Iterable[str]) -> bool:
    """Whether the recipient would still be caught without the collector that reads the
    very list its label came from.

    An address labelled a scam because it is on list L is trivially "caught" by a collector
    that looks it up on L. This drops that collector's evidence and asks whether what is
    left reaches the SUSPICIOUS score or carries a tier-setting signal. It re-applies two
    rules of the policy rather than calling it, so treat it as a close approximation.
    """
    excluded = {config.LABEL_COLLECTOR[s] for s in label_sources if s in config.LABEL_COLLECTOR}
    kept = [item for item in assessment.evidence if item[0] not in excluded]
    score = max(0, min(100, sum(points for _, _, points in kept)))
    return score >= SUSPICIOUS_SCORE or any(
        (source, signal) in TIER_SETTING_SIGNALS for source, signal, _ in kept
    )


def split_metrics(rows: Sequence[Row], flagged: Mapping[str, bool], split: str) -> dict:
    """Recall on the scam rows of `split`, false-positive rate on every legit row, and the
    precision of that pairing. Addresses without a decision are left out and counted."""
    scam = [row for row in rows if row.label == SCAM and row.split == split]
    legit = [row for row in rows if row.label == LEGIT]
    scored_scam = [flagged[row.address] for row in scam if row.address in flagged]
    scored_legit = [flagged[row.address] for row in legit if row.address in flagged]
    return {
        **classification_metrics(scored_scam, scored_legit),
        "scam_rows": len(scam),
        "legit_rows": len(legit),
        "not_scored": len(scam) + len(legit) - len(scored_scam) - len(scored_legit),
    }


def all_split_metrics(rows: Sequence[Row], flagged: Mapping[str, bool]) -> dict:
    return {split: split_metrics(rows, flagged, split) for split in (HELDOUT, DEV, UNDATED)}


def flag_rate(rows: Iterable[Row], flagged: Mapping[str, bool]) -> dict:
    """Share of the given rows that were flagged, among those with a decision."""
    decisions = [flagged[row.address] for row in rows if row.address in flagged]
    return Proportion(sum(decisions), len(decisions)).to_json()


def replay_for(rows: Iterable[Row], windows: Mapping[str, int]) -> dict:
    """The replay sensitivity table for the given scam rows under the assigned windows."""
    payments: list[Payment] = []
    stated = 0
    for row in rows:
        if row.address not in windows:
            continue
        amount, is_stated = payment_amount(stated_amount(row), config.ASSUMED_AMOUNT_USD)
        stated += is_stated
        payments.append(Payment(amount, windows[row.address]))
    return {
        "payments": len(payments),
        "amounts_stated_by_source": stated,
        "amounts_assumed": len(payments) - stated,
        "assumed_amount_usd": config.ASSUMED_AMOUNT_USD,
        "table": replay_table(payments, config.REPLAY_DELAYS_SECS),
    }


def latency_summary(values: Sequence[float]) -> dict:
    """Milliseconds, to one decimal: the clock is not better than that."""

    def tidy(value: Optional[float]) -> Optional[float]:
        return None if value is None else round(value, 1)

    return {
        "n": len(values),
        "median_ms": tidy(median(values)),
        "p95_ms": tidy(percentile(values, 95)),
        "min_ms": tidy(min(values)) if values else None,
        "max_ms": tidy(max(values)) if values else None,
    }


def tier_counts(rows: Iterable[Row], assessments: Mapping[str, Assessment]) -> dict[str, int]:
    counts = {tier: 0 for tier in config.TIERS}
    for row in rows:
        if row.address in assessments:
            counts[assessments[row.address].tier] += 1
    return counts


def negative_result(rows: Sequence[Row], assessments: Mapping[str, Assessment]) -> dict:
    """The fresh-wallet case: a recipient created within a day, with no reports.

    These wallets are not known scams. They show what the Guardian says about any wallet
    that new, which is what it would say about a scammer's brand-new wallet too.
    """
    fresh = [row for row in rows if row.label == FRESH and row.address in assessments]
    flagged = {row.address: assessments[row.address].flagged for row in fresh}
    windows = {row.address: assessments[row.address].window_secs for row in fresh}
    by_category: dict[str, dict] = {}
    for category in sorted({row.category for row in fresh}):
        subset = [row for row in fresh if row.category == category]
        by_category[category] = {
            "caught": flag_rate(subset, flagged),
            "tiers": tier_counts(subset, assessments),
        }
    table = replay_table(
        [Payment(config.ASSUMED_AMOUNT_USD, windows[row.address]) for row in fresh],
        config.REPLAY_DELAYS_SECS,
    )
    return {
        "n": len(fresh),
        "caught": flag_rate(fresh, flagged),
        "by_category": by_category,
        "tiers": tier_counts(fresh, assessments),
        "windows_secs": sorted({windows[row.address] for row in fresh}),
        "replay": table,
        "not_scored": sum(1 for row in rows if row.label == FRESH) - len(fresh),
    }


def window_for_delay(table: Sequence[dict], label: str) -> Optional[float]:
    for row in table:
        if row["delay"] == label:
            return row["share_of_value"]
    return None


__all__ = [
    "Assessment",
    "DEV",
    "HELDOUT",
    "UNDATED",
    "all_split_metrics",
    "flag_rate",
    "independent_flag",
    "latency_summary",
    "negative_result",
    "replay_for",
    "split_metrics",
    "tier_at_least",
    "tier_counts",
    "window_for_delay",
]
