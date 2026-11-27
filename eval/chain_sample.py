"""Sampling wallets from recent mainnet blocks through a public RPC endpoint.

Two groups come out of the same walk over fee payers of recent blocks:

* established wallets: a transaction at least `min_age_days` old is found in their history;
* fresh wallets: their complete history is shorter than one page and younger than
  `fresh_max_hours`.

The walk is reproducible: an anchor slot is recorded on the first run, block offsets and the
candidate order come from a seeded generator, and every RPC answer is cached on disk. "Now"
for every age is the anchor block's own time, not the clock of the machine.
"""

from __future__ import annotations

import json
import random
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

from net import FetchError, RpcClient

VOTE_PROGRAM = "Vote111111111111111111111111111111111111111"
PAGE = 1_000
# Signatures read first, to size a wallet up before paying for full pages.
PROBE = 25
# Skipped or pruned slots: not an error of ours, try the next one.
_SKIPPABLE = ("-32004", "-32007", "-32009", "-32011")
# Values tried for `maxSupportedTransactionVersion`, newest first.
TRANSACTION_VERSIONS = (1, 0)


@dataclass(frozen=True)
class SampledWallet:
    address: str
    kind: str  # "established" or "fresh"
    oldest_seen_time: int
    signatures_seen: int
    history_complete: bool
    sampled_from_slot: int


@dataclass
class SamplingReport:
    """What the walk did, so the dataset can say how its sample came about."""

    anchor_slot: int = 0
    anchor_time: int = 0
    blocks_requested: int = 0
    blocks_read: int = 0
    fee_payers_seen: int = 0
    candidates_examined: int = 0
    rejected_listed: int = 0
    rejected_too_active_to_date: int = 0
    rejected_age_not_proven: int = 0
    rejected_rpc_error: int = 0
    established: int = 0
    fresh: int = 0
    stopped_because: str = ""
    errors: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return asdict(self)


def fee_payers(block: Optional[dict]) -> list[str]:
    """Fee payers of the successful, non-vote transactions in a block (`accounts` detail)."""
    payers: list[str] = []
    for entry in (block or {}).get("transactions", []):
        meta = entry.get("meta") or {}
        if meta.get("err") is not None:
            continue
        keys = (entry.get("transaction") or {}).get("accountKeys") or []
        pubkeys = [key.get("pubkey") if isinstance(key, dict) else key for key in keys]
        if not pubkeys or VOTE_PROGRAM in pubkeys:
            continue
        payers.append(pubkeys[0])
    return payers


def classify_history(
    pages: list[list[dict]],
    anchor_time: int,
    min_age_days: int,
    fresh_max_hours: int,
) -> tuple[Optional[str], int, int, bool]:
    """Decides what a wallet's signature pages prove.

    Returns `(kind, oldest_time, signatures_seen, history_complete)`. `kind` is
    `"established"` when any transaction is at least `min_age_days` old, `"fresh"` when the
    whole history was read and is younger than `fresh_max_hours`, else `None`: the pages
    read prove neither, and the wallet is left out rather than guessed at.
    """
    times = [item["blockTime"] for page in pages for item in page if item.get("blockTime")]
    seen = sum(len(page) for page in pages)
    complete = bool(pages) and len(pages[-1]) < PAGE
    if not times:
        return None, 0, seen, complete
    oldest = min(times)
    if anchor_time - oldest >= min_age_days * 86_400:
        return "established", oldest, seen, complete
    if complete and anchor_time - oldest < fresh_max_hours * 3_600:
        return "fresh", oldest, seen, complete
    return None, oldest, seen, complete


def load_anchor(rpc: RpcClient, raw_dir: Path) -> tuple[int, int]:
    """The slot and block time every run of this dataset is anchored to."""
    path = raw_dir / "anchor.json"
    if path.exists():
        saved = json.loads(path.read_text())
        return saved["slot"], saved["time"]
    slot = rpc.call("getSlot", [{"commitment": "finalized"}], cache=False)
    # Step back a little so the anchor block is certainly finalized and has a time.
    for candidate in range(slot - 32, slot - 64, -1):
        try:
            time = rpc.call("getBlockTime", [candidate], cache=False)
        except FetchError:
            continue
        if time:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"slot": candidate, "time": time}))
            return candidate, time
    raise FetchError("could not find a finalized block with a time")


def _read_block(rpc: RpcClient, slot: int) -> Optional[list[str]]:
    """Fee payers of one block, or `None` for a skipped slot."""
    # Newest transaction version first; a node that does not know it gets the older one.
    last: Optional[FetchError] = None
    for version in TRANSACTION_VERSIONS:
        options = {
            "encoding": "json",
            "transactionDetails": "accounts",
            "rewards": False,
            "maxSupportedTransactionVersion": version,
            "commitment": "finalized",
        }
        try:
            return rpc.call("getBlock", [slot, options], transform=fee_payers)
        except FetchError as error:
            if any(code in str(error) for code in _SKIPPABLE):
                return None
            last = error
    raise last if last else FetchError("getBlock: no transaction version accepted")


def _slim_page(page: list[dict]) -> list[dict]:
    """Block times only, plus the last signature, which is the cursor for the next page."""
    slim: list[dict] = [{"blockTime": item.get("blockTime")} for item in page]
    if page:
        slim[-1]["signature"] = page[-1]["signature"]
    return slim


def projected_pages(newest_page: list[dict], anchor_time: int, min_age_days: int) -> float:
    """How many full pages lie between now and `min_age_days` ago at the wallet's recent
    rate of activity. Used only to give up early on wallets too busy to date."""
    times = [item["blockTime"] for item in newest_page if item.get("blockTime")]
    if not times:
        return float("inf")
    span = max(1, anchor_time - min(times))
    return len(newest_page) * (min_age_days * 86_400 / span) / PAGE


def _history_pages(
    rpc: RpcClient, address: str, anchor_time: int, min_age_days: int, max_pages: int
) -> Optional[list[list[dict]]]:
    """Signature pages, newest first, read until they prove the wallet's age.

    A small probe comes first. A wallet with fewer signatures than the probe is fully
    read by it. A wallet whose recent rate would need more than `max_pages` pages to reach
    back `min_age_days` is abandoned (`None`): reading on would cost minutes per wallet
    on a public endpoint. Otherwise full pages are read until one holds a transaction old
    enough, the history ends, or the page budget is spent.
    """
    recent = {"limit": PROBE, "commitment": "finalized"}
    probe = rpc.call("getSignaturesForAddress", [address, recent], transform=_slim_page)
    if len(probe) < PROBE:
        return [probe]
    if projected_pages(probe, anchor_time, min_age_days) > max_pages:
        return None
    pages: list[list[dict]] = []
    before: Optional[str] = None
    for _ in range(max_pages):
        options: dict = {"limit": PAGE, "commitment": "finalized"}
        if before:
            options["before"] = before
        page = rpc.call("getSignaturesForAddress", [address, options], transform=_slim_page)
        pages.append(page)
        times = [item["blockTime"] for item in page if item.get("blockTime")]
        old_enough = bool(times) and anchor_time - min(times) >= min_age_days * 86_400
        if len(page) < PAGE or old_enough:
            break
        before = page[-1]["signature"]
    return pages


def sample_wallets(
    rpc: RpcClient,
    raw_dir: Path,
    *,
    seed: int,
    listed: set[str],
    want_established: int,
    want_fresh: int,
    min_age_days: int,
    fresh_max_hours: int,
    blocks: int = 12,
    block_range: int = 3_000,
    max_candidates: int = 500,
    max_pages: int = 4,
) -> tuple[list[SampledWallet], SamplingReport]:
    """Walks seeded recent blocks and classifies fee payers until both targets are met,
    the candidates run out, or `max_candidates` have been examined."""
    report = SamplingReport()
    rng = random.Random(seed)
    report.anchor_slot, report.anchor_time = load_anchor(rpc, raw_dir)

    origin: dict[str, int] = {}
    offsets = rng.sample(range(block_range), blocks)
    for offset in offsets:
        slot = report.anchor_slot - offset
        report.blocks_requested += 1
        try:
            block = _read_block(rpc, slot)
        except FetchError as error:
            report.errors.append(f"getBlock: {error}")
            continue
        if block is None:
            continue
        report.blocks_read += 1
        for payer in block:
            origin.setdefault(payer, slot)
    report.fee_payers_seen = len(origin)

    candidates = sorted(origin)
    rng.shuffle(candidates)
    wallets: list[SampledWallet] = []
    report.stopped_because = "candidates exhausted"
    for address in candidates:
        if report.established >= want_established and report.fresh >= want_fresh:
            report.stopped_because = "targets met"
            break
        if report.candidates_examined >= max_candidates:
            report.stopped_because = "candidate budget spent"
            break
        report.candidates_examined += 1
        if address in listed:
            report.rejected_listed += 1
            continue
        try:
            pages = _history_pages(rpc, address, report.anchor_time, min_age_days, max_pages)
        except FetchError as error:
            report.rejected_rpc_error += 1
            report.errors.append(f"{address[:6]}: {error}")
            continue
        if pages is None:
            report.rejected_too_active_to_date += 1
            continue
        kind, oldest, seen, complete = classify_history(
            pages, report.anchor_time, min_age_days, fresh_max_hours
        )
        if kind == "established" and report.established < want_established:
            report.established += 1
        elif kind == "fresh" and report.fresh < want_fresh:
            report.fresh += 1
        else:
            if kind is None:
                report.rejected_age_not_proven += 1
            continue
        wallets.append(SampledWallet(address, kind, oldest, seen, complete, origin[address]))
    return wallets, report
