"""The time split. A row's split depends only on its report date and the fixed cut-off."""

from __future__ import annotations

from datetime import date
from typing import Optional

DEV = "dev"
HELDOUT = "heldout"
UNDATED = "undated"
SPLITS = (DEV, HELDOUT, UNDATED)


def parse_date(text: Optional[str]) -> Optional[date]:
    """`YYYY-MM-DD` (or a longer ISO timestamp) to a date; empty or malformed gives `None`."""
    if not text:
        return None
    try:
        return date.fromisoformat(text.strip()[:10])
    except ValueError:
        return None


def assign_split(report_date: Optional[date], cutoff: date) -> str:
    """Before the cut-off is dev, on or after it is held-out, no date is its own split.

    Undated rows are never folded into dev or held-out: without a date nobody can say
    whether a list published before the cut-off could have contained them.
    """
    if report_date is None:
        return UNDATED
    return DEV if report_date < cutoff else HELDOUT
