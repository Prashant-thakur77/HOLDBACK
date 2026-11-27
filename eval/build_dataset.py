"""Builds the evaluation dataset from public sources fetched at run time.

    python eval/build_dataset.py            # uses the cache in eval/data/raw when present
    python eval/build_dataset.py --refresh  # downloads every list again

Writes, under eval/data/:
    dataset.csv            one row per address: label, source, URL, dates, split
    blocklist_history.csv  when each address first appeared on each static list
    sources.csv            every source: URL, retrieval date, sizes, availability
    dataset_meta.json      cut-off, seed, sampling record, counts

A source that cannot be reached or needs a key that is not set is written to sources.csv as
unavailable with the reason. The dataset is then smaller; it is never padded.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlsplit

import config
from addresses import address_from_seed
from chain_sample import SamplingReport, sample_wallets
from dataset import (
    FRESH,
    LEGIT,
    SCAM,
    Row,
    count_by,
    drop_conflicts,
    merge_scam_rows,
    with_split,
    write_rows,
)
from envfile import load_env
from net import FetchError, RpcClient, cached_get
from sources import (
    PHANTOM_NFT_BLOCKLIST_URL,
    PROGRAM_REGISTRY_URL,
    STATIC_LISTS,
    count_yaml_mints,
    fetch_chainabuse,
    first_published,
    list_history,
    parse_program_registry,
    retrieval_date,
    snapshot_reader,
    solana_only,
)

PUBLIC_MAINNET_RPC = "https://api.mainnet-beta.solana.com"
SOURCE_COLUMNS = [
    "source",
    "role",
    "url",
    "retrieved_at",
    "status",
    "entries_total",
    "entries_solana",
    "note",
]
OFAC_PAGE = "https://sanctionssearch.ofac.treas.gov/"


def mainnet_rpc_url(env: dict[str, str]) -> str:
    if env.get("MAINNET_RPC_URL"):
        return env["MAINNET_RPC_URL"]
    if env.get("HELIUS_API_KEY"):
        return f"https://mainnet.helius-rpc.com/?api-key={env['HELIUS_API_KEY']}"
    return PUBLIC_MAINNET_RPC


def static_list_rows(
    env: dict[str, str], refresh: bool
) -> tuple[list[Row], list[dict], list[dict]]:
    """Scam rows from the static lists, their per-address publication history, and the
    source records."""
    rows: list[Row] = []
    history_rows: list[dict] = []
    source_rows: list[dict] = []
    for source in STATIC_LISTS:
        record = {"source": source.name, "role": "scam list", "url": source.url}
        try:
            name = f"{source.name}/current"
            text = cached_get(config.RAW_DIR, name, source.url, refresh=refresh).decode()
            entries = source.parse(text)
            addresses = solana_only(entries)
            retrieved = retrieval_date(config.RAW_DIR, name)
            published: dict[str, Optional[object]] = {}
            if addresses:
                history = list_history(config.RAW_DIR, source, env.get("GITHUB_TOKEN"))
                published = first_published(
                    addresses, history, snapshot_reader(config.RAW_DIR, source)
                )
        except (FetchError, ValueError) as error:
            source_rows.append({**record, "status": "unavailable", "note": str(error)})
            continue
        for address in addresses:
            day = published.get(address)
            day_text = day.isoformat() if day else ""  # type: ignore[union-attr]
            history_rows.append(
                {
                    "address": address,
                    "list": source.name,
                    "first_published": day_text,
                    "list_url": source.url,
                }
            )
            rows.append(
                Row(
                    address=address,
                    label=SCAM,
                    category="sanctioned" if source.name == "ofac" else "reported_scam",
                    source=source.name,
                    source_url=source.url,
                    retrieved_at=retrieved,
                    report_date=day_text,
                    amount_usd="",
                    split="",
                    note="report date = first commit of the list file that contains the address",
                )
            )
        source_rows.append(
            {
                **record,
                "retrieved_at": retrieved,
                "status": "ok",
                "entries_total": len(entries),
                "entries_solana": len(addresses),
                "note": "" if addresses else "the list holds no Solana address",
            }
        )
    return rows, history_rows, source_rows


def chainabuse_rows(env: dict[str, str]) -> tuple[list[Row], dict]:
    record = {
        "source": "chainabuse",
        "role": "scam reports",
        "url": "https://api.chainabuse.com/v0/reports?chain=SOL",
    }
    key = env.get("CHAINABUSE_API_KEY")
    if not key:
        return [], {**record, "status": "unavailable", "note": "CHAINABUSE_API_KEY is not set"}
    pages = int(env.get("CHAINABUSE_DATASET_PAGES", "2"))
    try:
        reports = fetch_chainabuse(config.RAW_DIR, key, pages)
        retrieved = retrieval_date(config.RAW_DIR, "chainabuse/reports-page1.json")
    except (FetchError, ValueError) as error:
        return [], {**record, "status": "unavailable", "note": str(error)}
    rows = [
        Row(
            address=report.address,
            label=SCAM,
            category="reported_scam",
            source="chainabuse",
            source_url=f"https://www.chainabuse.com/address/{report.address}",
            retrieved_at=retrieved,
            report_date=report.report_date.isoformat() if report.report_date else "",
            amount_usd=f"{report.amount_usd:.2f}" if report.amount_usd else "",
            split="",
            note=f"report {report.report_id}",
        )
        for report in reports
    ]
    note = f"{pages} page(s) requested; each page is one call against the key's monthly quota"
    return rows, {
        **record,
        "retrieved_at": retrieved,
        "status": "ok",
        "entries_total": len(reports),
        "entries_solana": len({row.address for row in rows}),
        "note": note,
    }


def program_rows(rpc: RpcClient, refresh: bool) -> tuple[list[Row], dict]:
    """Well-known programs from the explorer's registry, kept only when the account exists
    on mainnet and is executable right now."""
    record = {"source": "explorer_programs", "role": "legit programs", "url": PROGRAM_REGISTRY_URL}
    try:
        name = "explorer_programs/programs.ts"
        text = cached_get(config.RAW_DIR, name, PROGRAM_REGISTRY_URL, refresh=refresh).decode()
        programs = parse_program_registry(text)
        retrieved = retrieval_date(config.RAW_DIR, name)
        addresses = sorted(programs)
        executable: set[str] = set()
        for start in range(0, len(addresses), 100):
            chunk = addresses[start : start + 100]
            no_data = {"encoding": "base64", "dataSlice": {"offset": 0, "length": 0}}
            result = rpc.call("getMultipleAccounts", [chunk, no_data])
            for address, account in zip(chunk, result["value"]):
                if account and account.get("executable"):
                    executable.add(address)
    except (FetchError, ValueError, KeyError) as error:
        return [], {**record, "status": "unavailable", "note": str(error)}
    rows = [
        Row(
            address=address,
            label=LEGIT,
            category="program",
            source="explorer_programs",
            source_url=PROGRAM_REGISTRY_URL,
            retrieved_at=retrieved,
            report_date="",
            amount_usd="",
            split="",
            note=programs[address],
        )
        for address in addresses
        if address in executable
    ]
    return rows, {
        **record,
        "retrieved_at": retrieved,
        "status": "ok",
        "entries_total": len(programs),
        "entries_solana": len(rows),
        "note": "kept when the account is executable on mainnet",
    }


def sampled_rows(
    rpc: RpcClient, rpc_host: str, listed: set[str], args: argparse.Namespace
) -> tuple[list[Row], SamplingReport, dict]:
    record = {
        "source": "mainnet_sample",
        "role": "legit wallets and fresh wallets",
        "url": f"https://{rpc_host}",
    }
    try:
        wallets, report = sample_wallets(
            rpc,
            config.RAW_DIR,
            seed=config.SEED,
            listed=listed,
            want_established=args.legit_wallets,
            want_fresh=args.fresh_wallets,
            min_age_days=config.MIN_LEGIT_AGE_DAYS,
            fresh_max_hours=config.FRESH_MAX_AGE_HOURS,
            max_candidates=args.max_candidates,
        )
    except FetchError as error:
        return [], SamplingReport(), {**record, "status": "unavailable", "note": str(error)}
    retrieved = retrieval_date(config.RAW_DIR, "anchor.json")
    rows = []
    for wallet in wallets:
        oldest = datetime.fromtimestamp(wallet.oldest_seen_time, tz=timezone.utc)
        if wallet.kind == "established":
            note = f"a transaction on {oldest.date().isoformat()} found; {wallet.signatures_seen} signatures read"
        else:
            hours = (report.anchor_time - wallet.oldest_seen_time) / 3600
            note = f"whole history: {wallet.signatures_seen} signatures, first {hours:.1f} h before the anchor block"
        rows.append(
            Row(
                address=wallet.address,
                label=LEGIT if wallet.kind == "established" else FRESH,
                category="sampled_wallet" if wallet.kind == "established" else "sampled_new_wallet",
                source="mainnet_sample",
                source_url=f"https://{rpc_host}",
                retrieved_at=retrieved,
                report_date="",
                amount_usd="",
                split="",
                note=f"fee payer in slot {wallet.sampled_from_slot}; {note}",
            )
        )
    status = "ok" if rows else "unavailable"
    return (
        rows,
        report,
        {
            **record,
            "retrieved_at": retrieved,
            "status": status,
            "entries_total": report.candidates_examined,
            "entries_solana": len(rows),
            "note": f"seed {config.SEED}, anchor slot {report.anchor_slot}; stopped: {report.stopped_because}",
        },
    )


def generated_rows(rpc: RpcClient, count: int) -> tuple[list[Row], dict]:
    """Never-used addresses of keypairs derived from the public seed.

    Their secret keys can be recomputed by anyone from this file, so they must never be
    funded. They stand for a wallet created seconds ago: no history, no reports.
    """
    rows: list[Row] = []
    unused = 0
    unchecked = 0
    for index in range(count):
        seed = hashlib.sha256(f"holdback-eval-fresh:{config.SEED}:{index}".encode()).digest()
        address = address_from_seed(seed)
        try:
            history = rpc.call("getSignaturesForAddress", [address, {"limit": 1}])
        except FetchError:
            history = None
            unchecked += 1
        if history:
            continue  # Someone used the address; it is no longer a never-used wallet.
        unused += history is not None
        rows.append(
            Row(
                address=address,
                label=FRESH,
                category="generated_keypair",
                source="generated",
                source_url="",
                retrieved_at="",  # generated here; nothing was downloaded
                report_date="",
                amount_usd="",
                split="",
                note="generated for this evaluation; never used on-chain"
                + ("" if history is not None else " (not verified: RPC unavailable)"),
            )
        )
    note = f"seeded keypairs; {unused} verified to have no mainnet history, {unchecked} not checked"
    return rows, {
        "source": "generated",
        "role": "fresh wallets",
        "url": "",
        "retrieved_at": "",
        "status": "ok",
        "entries_total": count,
        "entries_solana": len(rows),
        "note": note,
    }


def excluded_sources(refresh: bool) -> list[dict]:
    """Public lists that were examined and left out, with the reason and their size."""
    record = {
        "source": "phantom_nft_blocklist",
        "url": PHANTOM_NFT_BLOCKLIST_URL,
        "reason": "mints of spam NFTs, not wallets that receive payments",
    }
    try:
        name = "phantom_nft_blocklist/nft-blocklist.yaml"
        text = cached_get(config.RAW_DIR, name, PHANTOM_NFT_BLOCKLIST_URL, refresh=refresh).decode()
        return [
            {
                **record,
                "solana_addresses": count_yaml_mints(text),
                "retrieved_at": retrieval_date(config.RAW_DIR, name),
            }
        ]
    except FetchError as error:
        return [{**record, "solana_addresses": None, "retrieved_at": None, "error": str(error)}]


def write_csv(path, columns: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n", restval="")
        writer.writeheader()
        writer.writerows(rows)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--refresh", action="store_true", help="download every list again")
    parser.add_argument("--legit-wallets", type=int, default=config.LEGIT_SAMPLED_WALLETS)
    parser.add_argument("--fresh-wallets", type=int, default=config.FRESH_SAMPLED_WALLETS)
    parser.add_argument("--fresh-keypairs", type=int, default=config.FRESH_GENERATED_KEYPAIRS)
    parser.add_argument("--max-candidates", type=int, default=500)
    args = parser.parse_args(argv)

    env = load_env()
    rpc_url = mainnet_rpc_url(env)
    rpc_host = urlsplit(rpc_url).hostname or "unknown"
    rpc = RpcClient(rpc_url, config.RAW_DIR)

    list_rows, history_rows, source_rows = static_list_rows(env, args.refresh)
    abuse_rows, abuse_source = chainabuse_rows(env)
    source_rows.append(abuse_source)
    scam_rows = merge_scam_rows(list_rows + abuse_rows)
    scam_addresses = {row.address for row in scam_rows}
    print(f"scam rows: {len(scam_rows)}", flush=True)

    programs, program_source = program_rows(rpc, args.refresh)
    source_rows.append(program_source)
    print(f"program rows: {len(programs)}", flush=True)

    sampled, sampling, sample_source = sampled_rows(rpc, rpc_host, scam_addresses, args)
    source_rows.append(sample_source)
    print(f"sampled rows: {len(sampled)} ({sampling.stopped_because})", flush=True)

    generated, generated_source = generated_rows(rpc, args.fresh_keypairs)
    source_rows.append(generated_source)

    others, conflicts = drop_conflicts(programs + sampled + generated, scam_addresses)
    rows = [with_split(row, config.CUTOFF_DATE) for row in scam_rows + others]

    write_rows(config.DATASET_CSV, rows)
    write_csv(
        config.DATA_DIR / "blocklist_history.csv",
        ["address", "list", "first_published", "list_url"],
        history_rows,
    )
    write_csv(config.SOURCES_CSV, SOURCE_COLUMNS, source_rows)
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cutoff_date": config.CUTOFF_DATE.isoformat(),
        "seed": config.SEED,
        "mainnet_rpc_host": rpc_host,
        "rows": len(rows),
        "rows_by_label": count_by(rows, "label"),
        "rows_by_label_split": count_by(rows, "label", "split"),
        "rows_by_label_split_source": count_by(rows, "label", "split", "source"),
        "rows_by_label_category": count_by(rows, "label", "category"),
        "legit_rows_dropped_as_listed": conflicts,
        "sources": source_rows,
        "unavailable_sources": [row["source"] for row in source_rows if row["status"] != "ok"],
        "excluded_sources": excluded_sources(args.refresh),
        "exchange_labels": "none: no public, machine-readable list of labelled Solana exchange wallets was found",
        "sampling": sampling.to_json(),
        "rpc_calls_made_this_run": rpc.network_calls,
    }
    config.DATASET_META.write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta["rows_by_label_split_source"], indent=2))
    print(f"unavailable sources: {meta['unavailable_sources'] or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
