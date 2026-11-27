"""The dataset's row format and the pure steps that shape it: merge, de-duplicate, split."""

from __future__ import annotations

import csv
import json
from dataclasses import asdict, dataclass, fields, replace
from datetime import date
from pathlib import Path
from typing import Iterable, Optional

from splits import assign_split, parse_date

SCAM = "scam"
LEGIT = "legit"
FRESH = "fresh"
# Legit rows are shared by every split (they have no report date); fresh rows are their own.
SPLIT_SHARED = "all"
SPLIT_FRESH = "fresh"


@dataclass(frozen=True)
class Row:
    address: str
    label: str  # scam | legit | fresh
    category: str  # e.g. sanctioned, reported_scam, program, sampled_wallet, generated_keypair
    source: str  # source ids joined with "|"
    source_url: str  # URLs joined with " "
    retrieved_at: str  # day the source was downloaded
    report_date: str  # day the address was first published by the source, or ""
    amount_usd: str  # stated loss in USD, or "" when the source states none
    split: str  # dev | heldout | undated | all | fresh
    note: str = ""


COLUMNS = [f.name for f in fields(Row)]


def merge_scam_rows(rows: Iterable[Row]) -> list[Row]:
    """One row per scam address: sources joined, the earliest report date and the first
    stated amount kept. An address reported twice is one recipient, not two."""
    merged: dict[str, Row] = {}
    for row in rows:
        current = merged.get(row.address)
        if current is None:
            merged[row.address] = row
            continue
        dates = [d for d in (parse_date(current.report_date), parse_date(row.report_date)) if d]
        sources = sorted(set(current.source.split("|")) | set(row.source.split("|")))
        urls = sorted(set(current.source_url.split(" ")) | set(row.source_url.split(" ")))
        merged[row.address] = replace(
            current,
            source="|".join(sources),
            source_url=" ".join(urls),
            report_date=min(dates).isoformat() if dates else "",
            amount_usd=current.amount_usd or row.amount_usd,
            category=min(current.category, row.category),
        )
    return sorted(merged.values(), key=lambda row: row.address)


def drop_conflicts(rows: Iterable[Row], scam_addresses: set[str]) -> tuple[list[Row], int]:
    """Removes non-scam rows whose address is in the scam set, and repeated addresses.

    Returns the kept rows and how many were dropped for being listed as a scam.
    """
    kept: dict[str, Row] = {}
    conflicts = 0
    for row in rows:
        if row.address in scam_addresses:
            conflicts += 1
        else:
            kept.setdefault(row.address, row)
    return sorted(kept.values(), key=lambda row: (row.label, row.category, row.address)), conflicts


def with_split(row: Row, cutoff: date) -> Row:
    """Scam rows are split by report date; the other labels keep their fixed split."""
    if row.label == SCAM:
        return replace(row, split=assign_split(parse_date(row.report_date), cutoff))
    return replace(row, split=SPLIT_FRESH if row.label == FRESH else SPLIT_SHARED)


def write_rows(path: Path, rows: Iterable[Row]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))


def read_rows(path: Path) -> list[Row]:
    with path.open(newline="") as handle:
        return [
            Row(**{name: record.get(name, "") for name in COLUMNS})
            for record in csv.DictReader(handle)
        ]


def require_current_cutoff(meta_path: Path, cutoff: date) -> None:
    """Stops when the dataset on disk was split with a different cut-off than the one in
    `config.py`; mixing the two would score the baseline and the splits against each other."""
    built_with = json.loads(meta_path.read_text())["cutoff_date"]
    if built_with != cutoff.isoformat():
        raise SystemExit(
            f"dataset was built with cut-off {built_with}, config says {cutoff.isoformat()}: "
            "run eval/build_dataset.py again"
        )


def stated_amount(row: Row) -> Optional[float]:
    try:
        return float(row.amount_usd) if row.amount_usd else None
    except ValueError:
        return None


def count_by(rows: Iterable[Row], *keys: str) -> dict[str, int]:
    """Row counts keyed by the given columns joined with "/"."""
    counts: dict[str, int] = {}
    for row in rows:
        key = "/".join(getattr(row, name) for name in keys)
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))
