"""Puts the eval scripts on the import path, so `python -m pytest eval` works from the repo root."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
