"""The public sources the dataset is built from, and the parsers for each.

Parsers are pure (text in, records out) so they can be tested without the network. Fetchers
go through the disk cache in `net.py`. A source that cannot be reached, or needs a key that is
not set, is reported as unavailable with its reason; nothing is substituted for it.
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Optional

from addresses import is_solana_address
from net import FetchError, cache_path, cached_get

GITHUB_RAW = "https://raw.githubusercontent.com"
GITHUB_API = "https://api.github.com"


@dataclass(frozen=True)
class GitList:
    """A list kept as one file in a public git repository."""

    name: str
    repo: str
    branch: str
    path: str
    parse: Callable[[str], list[str]]

    @property
    def url(self) -> str:
        return f"{GITHUB_RAW}/{self.repo}/{self.branch}/{self.path}"

    def url_at(self, ref: str) -> str:
        return f"{GITHUB_RAW}/{self.repo}/{ref}/{self.path}"


def parse_address_lines(text: str) -> list[str]:
    """One address per line; blank lines and `#` comments are skipped."""
    lines = (line.strip() for line in text.splitlines())
    return [line for line in lines if line and not line.startswith("#")]


def parse_json_string_array(text: str) -> list[str]:
    parsed = json.loads(text)
    if not isinstance(parsed, list):
        raise ValueError("expected a JSON array")
    return [item for item in parsed if isinstance(item, str)]


def solana_only(values: Iterable[str]) -> list[str]:
    """The valid Solana addresses among `values`, de-duplicated, in first-seen order."""
    seen: dict[str, None] = {}
    for value in values:
        candidate = value.strip()
        if is_solana_address(candidate):
            seen.setdefault(candidate, None)
    return list(seen)


# The two static address lists the Guardian's blocklist collector also loads.
OFAC_SOL = GitList(
    name="ofac",
    repo="0xB10C/ofac-sanctioned-digital-currency-addresses",
    branch="lists",
    path="sanctioned_addresses_SOL.txt",
    parse=parse_address_lines,
)
SCAMSNIFFER = GitList(
    name="scamsniffer",
    repo="scamsniffer/scam-database",
    branch="main",
    path="blacklist/address.json",
    parse=parse_json_string_array,
)
STATIC_LISTS = (OFAC_SOL, SCAMSNIFFER)

# Looked at and left out of the scam set: these are mints of spam NFTs, not wallets that
# receive payments. The builder still counts them so the exclusion is on record.
PHANTOM_NFT_BLOCKLIST_URL = f"{GITHUB_RAW}/phantom/blocklist/master/nft-blocklist.yaml"

PROGRAM_REGISTRY_URL = f"{GITHUB_RAW}/solana-foundation/explorer/master/app/utils/programs.ts"


def retrieval_date(raw_dir: Path, name: str) -> str:
    """The day the cached copy was downloaded (its mtime), so re-runs keep the same date."""
    stamp = cache_path(raw_dir, name).stat().st_mtime
    return datetime.fromtimestamp(stamp, tz=timezone.utc).date().isoformat()


def _github_headers(token: Optional[str]) -> dict[str, str]:
    headers = {"accept": "application/vnd.github+json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    return headers


@dataclass(frozen=True)
class Commit:
    sha: str
    day: date


def parse_commits(text: str) -> list[Commit]:
    """Commits from the GitHub commits API, oldest first."""
    commits = [
        Commit(item["sha"], date.fromisoformat(item["commit"]["committer"]["date"][:10]))
        for item in json.loads(text)
    ]
    return sorted(commits, key=lambda commit: (commit.day, commit.sha))


def list_history(
    raw_dir: Path, source: GitList, token: Optional[str], max_pages: int = 30
) -> list[Commit]:
    """Every commit that changed the list file, oldest first."""
    commits: list[Commit] = []
    for page in range(1, max_pages + 1):
        url = (
            f"{GITHUB_API}/repos/{source.repo}/commits"
            f"?sha={source.branch}&path={source.path}&per_page=100&page={page}"
        )
        name = f"{source.name}/commits-page{page}.json"
        batch = parse_commits(
            cached_get(raw_dir, name, url, headers=_github_headers(token)).decode()
        )
        commits.extend(batch)
        if len(batch) < 100:
            break
    return sorted(commits, key=lambda commit: (commit.day, commit.sha))


def first_published(
    addresses: Iterable[str],
    history: list[Commit],
    snapshot: Callable[[Commit], set[str]],
) -> dict[str, Optional[date]]:
    """For each address, the day of the first commit whose file contains it.

    Lists only grow in practice, so presence is treated as monotone and found by bisection:
    a handful of snapshots are read however long the history is. An address already in the
    oldest snapshot gets that commit's day, which is then an upper bound on its real
    publication day. An address in no snapshot gets `None`.
    """
    result: dict[str, Optional[date]] = {}
    for address in addresses:
        if not history or address not in snapshot(history[-1]):
            result[address] = None
            continue
        low, high = 0, len(history) - 1
        while low < high:
            middle = (low + high) // 2
            if address in snapshot(history[middle]):
                high = middle
            else:
                low = middle + 1
        result[address] = history[low].day
    return result


def snapshot_reader(raw_dir: Path, source: GitList) -> Callable[[Commit], set[str]]:
    """Reads (and caches) the Solana addresses in the list file as of a commit."""
    memo: dict[str, set[str]] = {}

    def read(commit: Commit) -> set[str]:
        if commit.sha not in memo:
            name = f"{source.name}/at-{commit.sha[:12]}"
            text = cached_get(raw_dir, name, source.url_at(commit.sha)).decode()
            memo[commit.sha] = set(solana_only(source.parse(text)))
        return memo[commit.sha]

    return read


# --- Chainabuse ------------------------------------------------------------------------

CHAINABUSE_ENDPOINT = "https://api.chainabuse.com/v0/reports"
# Field names a report may use for the reported loss in USD. The reports API was not
# reachable without a key when this was written, so the parser accepts the plausible
# spellings and leaves the amount empty when none is present. It never guesses a value.
_LOSS_FIELDS = ("lostAmountUsd", "amountLostUsd", "lossUsd")


@dataclass(frozen=True)
class AbuseReport:
    address: str
    report_date: Optional[date]
    amount_usd: Optional[float]
    report_id: str


def parse_chainabuse_reports(text: str) -> list[AbuseReport]:
    """Solana addresses named in a page of Chainabuse reports, one record per address."""
    payload = json.loads(text)
    reports = payload.get("reports", []) if isinstance(payload, dict) else payload
    found: list[AbuseReport] = []
    for report in reports if isinstance(reports, list) else []:
        if not isinstance(report, dict):
            continue
        created = report.get("createdAt")
        day = None
        if isinstance(created, str):
            try:
                day = date.fromisoformat(created[:10])
            except ValueError:
                day = None
        amount = next(
            (
                float(report[field])
                for field in _LOSS_FIELDS
                if isinstance(report.get(field), (int, float)) and report[field] > 0
            ),
            None,
        )
        for entry in report.get("addresses", []) or []:
            address = entry.get("address") if isinstance(entry, dict) else None
            if isinstance(address, str) and is_solana_address(address.strip()):
                found.append(AbuseReport(address.strip(), day, amount, str(report.get("id", ""))))
    return found


def fetch_chainabuse(raw_dir: Path, api_key: str, pages: int) -> list[AbuseReport]:
    """Up to `pages` pages of Solana reports. Each page is one call against the key's quota,
    and is cached on disk so a re-run spends nothing."""
    credentials = base64.b64encode(f"{api_key}:{api_key}".encode()).decode()
    headers = {"accept": "application/json", "authorization": f"Basic {credentials}"}
    reports: list[AbuseReport] = []
    for page in range(1, pages + 1):
        url = f"{CHAINABUSE_ENDPOINT}?chain=SOL&perPage=50&page={page}"
        body = cached_get(raw_dir, f"chainabuse/reports-page{page}.json", url, headers=headers)
        batch = parse_chainabuse_reports(body.decode())
        reports.extend(batch)
        if not batch:
            break
    return reports


# --- well-known programs ---------------------------------------------------------------

_ENUM_ENTRY = re.compile(r"^\s+(\w+)\s*=\s*'([^']+)',", re.MULTILINE)
_PROGRAM_ENTRY = re.compile(
    r"^\s+'?([1-9A-HJ-NP-Za-km-z]{32,44})'?:\s*\{\s*\n"
    r"\s+deployments:\s*([^\n]+?),\s*\n"
    r"\s+name:\s*PROGRAM_NAMES\.(\w+)",
    re.MULTILINE,
)
_LOADER_ENTRY = re.compile(r"^\s+'?([1-9A-HJ-NP-Za-km-z]{32,44})'?:\s*'([^']+)',", re.MULTILINE)


def parse_program_registry(text: str) -> dict[str, str]:
    """Address -> program name for entries the registry marks as deployed on mainnet."""
    names = dict(_ENUM_ENTRY.findall(text))
    programs: dict[str, str] = {}
    for address, deployments, key in _PROGRAM_ENTRY.findall(text):
        on_mainnet = "Mainnet" in deployments or "_CLUSTERS" in deployments
        if on_mainnet and is_solana_address(address):
            programs[address] = names.get(key, key)
    loader_block = re.search(r"LOADER_IDS[^=]*=\s*\{(.*?)\}", text, re.DOTALL)
    if loader_block:
        for address, name in _LOADER_ENTRY.findall(loader_block.group(1)):
            if is_solana_address(address):
                programs.setdefault(address, name)
    return programs


def count_yaml_mints(text: str) -> int:
    """How many valid Solana addresses a YAML list of `- mint: <address>` style lines holds."""
    tokens = re.findall(r"[1-9A-HJ-NP-Za-km-z]{32,44}", text)
    return len(solana_only(tokens))


__all__ = [
    "AbuseReport",
    "Commit",
    "FetchError",
    "GitList",
    "OFAC_SOL",
    "PHANTOM_NFT_BLOCKLIST_URL",
    "PROGRAM_REGISTRY_URL",
    "SCAMSNIFFER",
    "STATIC_LISTS",
    "count_yaml_mints",
    "fetch_chainabuse",
    "first_published",
    "list_history",
    "parse_address_lines",
    "parse_chainabuse_reports",
    "parse_commits",
    "parse_json_string_array",
    "parse_program_registry",
    "retrieval_date",
    "snapshot_reader",
    "solana_only",
]
