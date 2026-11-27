"""Assesses every address in the dataset with the Guardian and computes the metrics.

    python eval/run_eval.py                 # full run
    python eval/run_eval.py --resume        # keep answers already in assessments.csv
    python eval/run_eval.py --metrics-only  # recompute metrics from assessments.csv

The Guardian is the one at `GUARDIAN_URL`. When that is not set, the service is started
locally under Node (`bench/src/guardian-server.ts`) with whatever keys are configured, and
stopped at the end. Each answer is appended to eval/data/assessments.csv as it arrives, so an
interrupted run loses nothing.

One request per address, no sender note: the dataset has recipients, not conversations, so
the `context` collector has nothing to read and the result measures recipient evidence only.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlsplit

import config
from addresses import address_from_seed
from dataset import LEGIT, SCAM, Row, read_rows, require_current_cutoff
from envfile import load_env
from evaluate import (
    Assessment,
    all_split_metrics,
    flag_rate,
    independent_flag,
    latency_summary,
    negative_result,
    replay_for,
    tier_counts,
)
from splits import DEV, HELDOUT, UNDATED

COLLECTORS = (
    "onchain_reputation",
    "helius",
    "blocklist",
    "chainabuse",
    "web_reports",
    "sns",
    "context",
    "baseline",
)
COLUMNS = [
    "address",
    "label",
    "split",
    "ok",
    "error",
    "tier",
    "window_secs",
    "score",
    "latency_ms",
    "server_latency_ms",
    "unavailable",
    "evidence",
    "policy_version",
    "evidence_hash",
    "assessed_at",
]
# The payer in every request: a never-used address, so no sender history colours the result.
SENDER = address_from_seed(hashlib.sha256(b"holdback-eval-sender").digest())
# 1 SOL in lamports. The amount only matters to the sender-habit collector.
AMOUNT = "1000000000"
START_TIMEOUT_SECS = 90
# Waited between addresses and not part of any timing. A burst of assessments trips the rate
# limit of a public RPC endpoint, and the retries would then be measured as time to verdict.
PAUSE_SECS = 1.0


def start_local_guardian() -> tuple[str, subprocess.Popen]:
    """Starts the Guardian under Node and returns its URL once it is listening."""
    process = subprocess.Popen(
        ["npx", "tsx", "bench/src/guardian-server.ts"],
        cwd=config.REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        start_new_session=True,
    )
    deadline = time.monotonic() + START_TIMEOUT_SECS
    assert process.stdout is not None
    while time.monotonic() < deadline:
        line = process.stdout.readline()
        if line.startswith("GUARDIAN_URL="):
            return line.strip().split("=", 1)[1], process
        if not line and process.poll() is not None:
            break
    stop_guardian(process)
    raise RuntimeError("the local Guardian did not start; run `npm install` at the repo root")


def stop_guardian(process: Optional[subprocess.Popen]) -> None:
    if process and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=10)


def http_json(url: str, body: Optional[dict] = None, timeout: float = 60.0) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def assess_once(base_url: str, recipient: str) -> tuple[dict, float]:
    """One `/v1/assess` call and the wall-clock milliseconds it took from the client."""
    body = {"sender": SENDER, "recipient": recipient, "mint": None, "amount": AMOUNT, "lang": "en"}
    started = time.perf_counter()
    payload = http_json(f"{base_url}/v1/assess", body)
    return payload, (time.perf_counter() - started) * 1000


def assess_row(base_url: str, row: Row, attempts: int = 3) -> dict:
    record = {"address": row.address, "label": row.label, "split": row.split}
    error = "unknown"
    for attempt in range(attempts):
        try:
            payload, latency = assess_once(base_url, row.address)
            evidence = [f"{e['source']}.{e['signal']}:{e['weight']}" for e in payload["evidence"]]
            return {
                **record,
                "ok": 1,
                "error": "",
                "tier": payload["tier"],
                "window_secs": payload["windowSecs"],
                "score": payload["score"],
                "latency_ms": round(latency, 1),
                "server_latency_ms": payload["latencyMs"],
                "unavailable": ";".join(payload["unavailable"]),
                "evidence": ";".join(evidence),
                "policy_version": payload["document"]["policyVersion"],
                "evidence_hash": payload["evidenceHash"],
                "assessed_at": payload["document"]["assessedAt"],
            }
        except urllib.error.HTTPError as http_error:
            error = f"HTTP {http_error.code}"
            if http_error.code < 500 and http_error.code != 429:
                break
        except (urllib.error.URLError, TimeoutError, OSError, KeyError, ValueError) as other:
            error = type(other).__name__
        time.sleep(2 * (attempt + 1))
    return {**record, "ok": 0, "error": error}


def read_assessment_records() -> list[dict]:
    if not config.ASSESSMENTS_CSV.exists():
        return []
    with config.ASSESSMENTS_CSV.open(newline="") as handle:
        return list(csv.DictReader(handle))


def to_assessment(record: dict) -> Assessment:
    evidence = []
    for item in filter(None, record["evidence"].split(";")):
        name, points = item.rsplit(":", 1)
        source, signal_name = name.split(".", 1)
        evidence.append((source, signal_name, int(float(points))))
    return Assessment(
        address=record["address"],
        tier=record["tier"],
        window_secs=int(record["window_secs"]),
        score=int(float(record["score"])),
        latency_ms=float(record["latency_ms"]),
        server_latency_ms=float(record["server_latency_ms"]),
        unavailable=tuple(filter(None, record["unavailable"].split(";"))),
        evidence=tuple(evidence),
    )


def run_assessments(base_url: str, rows: list[Row], resume: bool) -> None:
    done = {r["address"]: r for r in read_assessment_records() if resume and r["ok"] == "1"}
    with config.ASSESSMENTS_CSV.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, lineterminator="\n", restval="")
        writer.writeheader()
        for index, row in enumerate(rows, start=1):
            record = done.get(row.address)
            if record is None:
                record = assess_row(base_url, row)
                time.sleep(PAUSE_SECS)
            writer.writerow(record)
            handle.flush()
            if index % 20 == 0 or index == len(rows):
                print(f"assessed {index}/{len(rows)}", flush=True)


def environment(records: list[dict], guardian: dict) -> dict:
    """Which collectors actually answered, counted over the assessments that succeeded."""
    ok = [record for record in records if record["ok"] == "1"]
    missing = {name: 0 for name in COLLECTORS}
    for record in ok:
        for name in filter(None, record["unavailable"].split(";")):
            missing[name] = missing.get(name, 0) + 1
    return {
        "guardian": guardian,
        "assessments": len(ok),
        "assessments_failed": len(records) - len(ok),
        "policy_versions": sorted({record["policy_version"] for record in ok}),
        "collectors_unavailable_in_every_assessment": sorted(
            name for name, count in missing.items() if ok and count == len(ok)
        ),
        "collectors_unavailable_in_some_assessments": {
            name: count for name, count in sorted(missing.items()) if 0 < count < len(ok)
        },
        "collectors_answering_in_every_assessment": sorted(
            name for name, count in missing.items() if ok and count == 0
        ),
        "context_note_sent": False,
    }


def compute_metrics(rows: list[Row], records: list[dict], guardian: dict) -> dict:
    assessments = {r["address"]: to_assessment(r) for r in records if r["ok"] == "1"}
    flagged = {address: assessment.flagged for address, assessment in assessments.items()}
    windows = {address: assessment.window_secs for address, assessment in assessments.items()}
    sources = {row.address: row.source.split("|") for row in rows}
    independent = {
        address: independent_flag(assessment, sources.get(address, []))
        for address, assessment in assessments.items()
    }
    splits = all_split_metrics(rows, flagged)
    independent_splits = all_split_metrics(rows, independent)
    legit = [row for row in rows if row.label == LEGIT]
    for name in (HELDOUT, DEV, UNDATED):
        scam = [row for row in rows if row.label == SCAM and row.split == name]
        splits[name]["independent_recall"] = independent_splits[name]["recall"]
        splits[name]["tiers"] = tier_counts(scam, assessments)
        splits[name]["replay"] = replay_for(scam, windows)
    return {
        "computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "detection_rule": f"tier is {config.DETECTION_TIER} or higher",
        "environment": environment(records, guardian),
        "splits": splits,
        "legit": {
            "tiers": tier_counts(legit, assessments),
            "false_positive_rate_by_category": {
                category: flag_rate([row for row in legit if row.category == category], flagged)
                for category in sorted({row.category for row in legit})
            },
        },
        "time_to_verdict": {
            "client_ms": latency_summary([a.latency_ms for a in assessments.values()]),
            "server_ms": latency_summary([a.server_latency_ms for a in assessments.values()]),
            "note": "first assessment of each recipient, one request at a time",
        },
        "negative_result": negative_result(rows, assessments),
        "fresh_label_note": "fresh wallets are unlabelled new wallets, not known scams",
    }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--metrics-only", action="store_true")
    args = parser.parse_args(argv)

    require_current_cutoff(config.DATASET_META, config.CUTOFF_DATE)
    rows = read_rows(config.DATASET_CSV)
    guardian_path = config.DATA_DIR / "guardian_environment.json"
    if not args.metrics_only:
        base_url = load_env().get("GUARDIAN_URL", "").rstrip("/")
        process = None
        try:
            if base_url:
                guardian = {"mode": "remote", "host": urlsplit(base_url).hostname}
            else:
                base_url, process = start_local_guardian()
                described = http_json(f"{base_url}/__environment")
                guardian = {"mode": "local Node process", "host": "127.0.0.1", **described}
            guardian_path.write_text(json.dumps(guardian, indent=2) + "\n")
            run_assessments(base_url, rows, args.resume)
        finally:
            stop_guardian(process)
    guardian = json.loads(guardian_path.read_text()) if guardian_path.exists() else {}
    result = compute_metrics(rows, read_assessment_records(), guardian)
    config.EVAL_JSON.write_text(json.dumps(result, indent=2) + "\n")

    for name in (HELDOUT, DEV, UNDATED):
        recall = result["splits"][name]["recall"]
        print(f"{name}: recall {recall['successes']}/{recall['n']}")
    fpr = result["splits"][HELDOUT]["false_positive_rate"]
    print(f"false positives {fpr['successes']}/{fpr['n']}")
    fresh = result["negative_result"]["caught"]
    print(f"fresh wallets caught {fresh['successes']}/{fresh['n']}")
    print(
        f"unavailable in every assessment: {result['environment']['collectors_unavailable_in_every_assessment']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
