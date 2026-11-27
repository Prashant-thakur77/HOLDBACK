"""Replay arithmetic: how much of a scam payment could still be pulled back.

A HOLDBACK hold is all-or-nothing. Until `release_at` the sender can undo and the full amount
returns; from `release_at` on the recipient is owed all of it (the program checks
`now < release_at`). So a payment with window `w` whose sender presses Undo after delay `d` is
recovered in full when `d < w` and not at all otherwise. A plain transfer has no window.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Optional


@dataclass(frozen=True)
class Payment:
    """One replayed scam payment: its size and the window the Guardian assigned."""

    amount_usd: float
    window_secs: int


def reclaimable(window_secs: int, delay_secs: int) -> bool:
    """True when an undo pressed `delay_secs` after paying still lands inside the window."""
    return delay_secs < window_secs


def recovered_share(payments: Iterable[Payment], delay_secs: int) -> dict:
    """Share of value, and of payments, still reclaimable after `delay_secs`."""
    rows = list(payments)
    total = sum(payment.amount_usd for payment in rows)
    kept = [payment for payment in rows if reclaimable(payment.window_secs, delay_secs)]
    kept_value = sum(payment.amount_usd for payment in kept)
    return {
        "delay_secs": delay_secs,
        "payments": len(rows),
        "payments_reclaimable": len(kept),
        "share_of_payments": len(kept) / len(rows) if rows else None,
        "value_usd": total,
        "value_reclaimable_usd": kept_value,
        "share_of_value": kept_value / total if total > 0 else None,
        # A plain transfer settles at once; nothing can be pulled back at any delay.
        "plain_transfer_share_of_value": 0.0 if rows else None,
    }


def replay_table(payments: Iterable[Payment], delays: Mapping[str, int]) -> list[dict]:
    """One row per undo delay, in the order given."""
    rows = list(payments)
    return [{"delay": label, **recovered_share(rows, secs)} for label, secs in delays.items()]


def payment_amount(stated_usd: Optional[float], assumed_usd: float) -> tuple[float, bool]:
    """The amount to replay and whether it is the stated one (`False` means the assumption)."""
    if stated_usd is not None and stated_usd > 0:
        return stated_usd, True
    return assumed_usd, False
