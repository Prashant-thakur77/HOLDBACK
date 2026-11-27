"""Fixed choices of the evaluation. Changing any of these changes the published numbers.

Everything here was fixed before the first Guardian assessment was run. The cut-off was chosen
from the distribution of report dates alone (see `eval/README.md`), never from model output.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVAL_DIR.parent
DATA_DIR = EVAL_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
BENCH_RESULTS = REPO_ROOT / "bench" / "results.json"

DATASET_CSV = DATA_DIR / "dataset.csv"
SOURCES_CSV = DATA_DIR / "sources.csv"
DATASET_META = DATA_DIR / "dataset_meta.json"
BASELINE_CSV = DATA_DIR / "baseline_predictions.csv"
BASELINE_JSON = DATA_DIR / "baseline_metrics.json"
ASSESSMENTS_CSV = DATA_DIR / "assessments.csv"
EVAL_JSON = DATA_DIR / "eval_metrics.json"
INVARIANTS_JSON = EVAL_DIR / "program_invariants.json"
RESULTS_JSON = EVAL_DIR / "results.json"
RESULTS_MD = EVAL_DIR / "RESULTS.md"

# Rows reported before this day are dev; rows reported on or after it are held-out.
CUTOFF_DATE = date(2026, 7, 1)

# Seed for every random choice (block sampling, wallet sampling, fresh keypairs).
SEED = 20261127

# Tiers in the order the program stores them.
TIERS = ("TRUSTED", "UNKNOWN", "SUSPICIOUS", "FLAGGED", "SANCTIONED")
# A recipient counts as "caught" from this tier up.
DETECTION_TIER = "SUSPICIOUS"

# Undo-trigger delays for the replay sensitivity table: how long after paying the sender
# realises and presses Undo. No delay distribution is assumed; each delay is reported.
REPLAY_DELAYS_SECS = {"10 min": 600, "1 h": 3_600, "6 h": 21_600, "24 h": 86_400}

# ASSUMPTION, not a measurement: the size of a scam payment whose source states no amount.
# When no row has a stated amount the replay share does not depend on this value at all
# (every payment has the same weight); it only matters once stated amounts are mixed in.
ASSUMED_AMOUNT_USD = 1_000.0

# Legit wallets must have a transaction at least this old.
MIN_LEGIT_AGE_DAYS = 365
# Fresh wallets must have their whole history inside this many hours.
FRESH_MAX_AGE_HOURS = 24

# Target sample sizes. The builder records how many it actually obtained.
LEGIT_SAMPLED_WALLETS = 60
FRESH_SAMPLED_WALLETS = 30
FRESH_GENERATED_KEYPAIRS = 30

# Which Guardian collector reads the same data a dataset source is labelled from. A catch
# that rests only on that collector repeats the label; `independent_recall` excludes it.
LABEL_COLLECTOR = {"ofac": "blocklist", "scamsniffer": "blocklist", "chainabuse": "chainabuse"}
