"""The baseline most wallets ship: a static blocklist.

An address is flagged when it was on a published address list before the cut-off. Lists as
they stand today would include the held-out addresses, which is hindsight; the baseline gets
only what a wallet could have downloaded on the cut-off day.

    python eval/baseline.py

Reads eval/data/dataset.csv and blocklist_history.csv; writes baseline_predictions.csv and
baseline_metrics.json.
"""

from __future__ import annotations

import csv
import json
import sys
from datetime import date
from typing import Mapping, Optional

import config
from dataset import SCAM, read_rows, require_current_cutoff
from evaluate import all_split_metrics
from splits import HELDOUT, DEV, UNDATED, parse_date


def published_before(first_published: Mapping[str, Optional[date]], cutoff: date) -> set[str]:
    """Addresses a list had published strictly before `cutoff`. An address whose
    publication day is unknown is not assumed to have been there."""
    return {address for address, day in first_published.items() if day is not None and day < cutoff}


def load_history(path=None) -> dict[str, Optional[date]]:
    """Earliest publication day of each address across the static lists."""
    path = path or config.DATA_DIR / "blocklist_history.csv"
    earliest: dict[str, Optional[date]] = {}
    with path.open(newline="") as handle:
        for record in csv.DictReader(handle):
            day = parse_date(record["first_published"])
            known = earliest.get(record["address"])
            earliest[record["address"]] = (
                min(d for d in (day, known) if d) if (day or known) else None
            )
    return earliest


def main() -> int:
    require_current_cutoff(config.DATASET_META, config.CUTOFF_DATE)
    rows = read_rows(config.DATASET_CSV)
    blocklist = published_before(load_history(), config.CUTOFF_DATE)
    flagged = {row.address: row.address in blocklist for row in rows}

    with config.BASELINE_CSV.open("w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["address", "label", "split", "flagged"])
        for row in rows:
            writer.writerow([row.address, row.label, row.split, int(flagged[row.address])])

    splits = all_split_metrics(rows, flagged)
    for name in (HELDOUT, DEV, UNDATED):
        scam = [row for row in rows if row.label == SCAM and row.split == name]
        # A wallet that blocks every flagged payment protects exactly the flagged share,
        # whatever the delay; every other payment is a plain transfer and is gone.
        splits[name]["share_of_scam_payments_blocked"] = splits[name]["recall"]["value"]
        splits[name]["scam_rows_flagged"] = sum(flagged[row.address] for row in scam)
    result = {
        "method": "address was on a static list (OFAC SOL mirror, ScamSniffer) published before the cut-off",
        "cutoff_date": config.CUTOFF_DATE.isoformat(),
        "blocklist_size_before_cutoff": len(blocklist),
        "splits": splits,
    }
    config.BASELINE_JSON.write_text(json.dumps(result, indent=2) + "\n")
    for name in (HELDOUT, DEV, UNDATED):
        recall = splits[name]["recall"]
        print(f"baseline {name}: recall {recall['successes']}/{recall['n']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
