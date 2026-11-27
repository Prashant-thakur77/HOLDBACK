"""Reads settings from the process environment, then the repo-root `.env`. Values are never
printed; callers report only whether a name is set."""

from __future__ import annotations

import os
import re
from pathlib import Path

from config import REPO_ROOT

_LINE = re.compile(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$")


def parse_dotenv(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        if line.lstrip().startswith("#"):
            continue
        match = _LINE.match(line)
        if match:
            value = match.group(2)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                value = value[1:-1]
            values[match.group(1)] = value
    return values


def load_env(root: Path = REPO_ROOT) -> dict[str, str]:
    """Process environment over the root `.env`; empty values count as unset."""
    path = root / ".env"
    from_file = parse_dotenv(path.read_text()) if path.exists() else {}
    merged = {**from_file, **os.environ}
    return {name: value for name, value in merged.items() if value != ""}
