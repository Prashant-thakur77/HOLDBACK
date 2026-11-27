"""Merges every measured number into eval/results.json and renders eval/RESULTS.md.

    python eval/merge_results.py

Inputs (each written by its own script; a missing one is recorded as missing, never filled):
    eval/data/dataset_meta.json      build_dataset.py
    eval/data/baseline_metrics.json  baseline.py
    eval/data/eval_metrics.json      run_eval.py
    bench/results.json               bench/src/run.ts
    eval/program_invariants.json     the program's property test

results.json is the only place the README, the video and the deck may take numbers from.
"""

from __future__ import annotations

import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import config

SCHEMA_VERSION = 1
SPLIT_TITLES = {"heldout": "Held-out", "dev": "Dev", "undated": "Undated"}
# What a missing collector takes away, in plain words, for the limitations section.
COLLECTOR_EFFECT = {
    "blocklist": "no sanctions-list or scam-list lookup, so listed addresses are not recognised (needs Supabase with the lists loaded)",
    "helius": "no wallet age, history or behaviour heuristics (needs HELIUS_API_KEY)",
    "chainabuse": "no abuse-report lookup (needs CHAINABUSE_API_KEY)",
    "web_reports": "no web search for reports naming the address (needs FIRECRAWL_API_KEY)",
    "baseline": "no sender history, which only affects the trusted fast path (needs Supabase)",
    "onchain_reputation": "no on-chain flags or undo counts (needs a reachable devnet RPC)",
    "sns": "no .sol name look-alike check",
    "context": "no reading of the sender's note",
}


def read_json(path: Path) -> Optional[Any]:
    return json.loads(path.read_text()) if path.exists() else None


def git_state(root: Path) -> dict:
    """The commit the numbers were produced at. Read-only git commands."""

    def run(*args: str) -> Optional[str]:
        try:
            done = subprocess.run(
                ["git", *args], cwd=root, capture_output=True, text=True, timeout=20
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        return done.stdout.strip() if done.returncode == 0 else None

    status = run("status", "--porcelain")
    return {
        "commit": run("rev-parse", "HEAD"),
        "uncommitted_changes": bool(status) if status is not None else None,
    }


def limitations(
    dataset: Optional[dict], evaluation: Optional[dict], bench: Optional[dict]
) -> list[str]:
    """Limits of this particular run, derived from what was and was not available."""
    notes: list[str] = []
    if evaluation:
        env = evaluation["environment"]
        for name in env["collectors_unavailable_in_every_assessment"]:
            notes.append(
                f"Collector `{name}` was unavailable in every assessment: {COLLECTOR_EFFECT.get(name, 'no signal from it')}."
            )
        for name, count in env["collectors_unavailable_in_some_assessments"].items():
            notes.append(
                f"Collector `{name}` was unavailable in {count} of {env['assessments']} assessments."
            )
        if env["collectors_unavailable_in_every_assessment"]:
            notes.append(
                "Missing collectors add no points, and nearly every rule adds risk. Recall and the false-positive "
                "rate below are therefore expected to be lower than a fully configured service would show. That "
                "expectation is not a measurement."
            )
        if env["assessments_failed"]:
            notes.append(
                f"{env['assessments_failed']} assessment(s) failed and are left out of every metric."
            )
        heldout = evaluation["splits"]["heldout"]["recall"]["n"]
        notes.append(
            f"The held-out scam set has n = {heldout}. Intervals this wide support no claim about a rate."
        )
        notes.append(
            "No sender note is sent, so social-engineering cues, the signal HOLDBACK reads from the sender's own words, are not exercised."
        )
    else:
        notes.append("The Guardian evaluation has not been run; there are no HOLDBACK metrics.")
    if dataset:
        for name in dataset["unavailable_sources"]:
            reason = next(
                (s.get("note", "") for s in dataset["sources"] if s["source"] == name), ""
            )
            notes.append(
                f"Dataset source `{name}` was unavailable ({reason}); its rows are absent, not estimated."
            )
        notes.append(
            "Scam labels come from the same public lists the `blocklist` collector reads. When that collector is "
            "available, catching a listed address repeats the label; `independent_recall` excludes it."
        )
        notes.append(
            "The baseline's held-out recall on list-sourced rows is zero by construction: those addresses were "
            "published after the cut-off. It becomes informative only with dated reports from another source."
        )
        notes.append(
            "Sampled legit wallets are presumed legitimate (a transaction over a year old, on no list); they are not "
            "verified. Very active wallets are excluded because their age cannot be read cheaply."
        )
        notes.append(
            "Fresh wallets are unlabelled new wallets and generated keypairs, not known scams."
        )
        notes.append(f"Exchange wallets: {dataset['exchange_labels']}.")
    else:
        notes.append("The dataset has not been built.")
    if not bench:
        notes.append("The latency benchmark has not been run.")
    elif not bench.get("chain", {}).get("available"):
        notes.append(
            f"On-chain timings are missing: {bench.get('chain', {}).get('reason', 'not run')}."
        )
    return notes


def build_results(
    dataset: Optional[dict],
    baseline: Optional[dict],
    evaluation: Optional[dict],
    bench: Optional[dict],
    invariants: Optional[dict],
    git: dict,
    generated_at: str,
) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "git": git,
        "environment": {
            "python": platform.python_version(),
            "guardian": evaluation["environment"] if evaluation else None,
            "dataset_sources_unavailable": dataset["unavailable_sources"] if dataset else None,
            "mainnet_rpc_host": dataset["mainnet_rpc_host"] if dataset else None,
            "bench": bench.get("environment") if bench else None,
        },
        "config": {
            "cutoff_date": config.CUTOFF_DATE.isoformat(),
            "seed": config.SEED,
            "detection_tier": config.DETECTION_TIER,
            "replay_delays_secs": config.REPLAY_DELAYS_SECS,
            "assumed_amount_usd": config.ASSUMED_AMOUNT_USD,
            "assumed_amount_is_an_assumption": True,
            "min_legit_age_days": config.MIN_LEGIT_AGE_DAYS,
            "fresh_max_age_hours": config.FRESH_MAX_AGE_HOURS,
        },
        "dataset": dataset,
        "baseline": baseline,
        "holdback": (
            {
                key: evaluation[key]
                for key in ("detection_rule", "splits", "legit", "time_to_verdict", "computed_at")
            }
            if evaluation
            else None
        ),
        "negative_result": evaluation["negative_result"] if evaluation else None,
        "latency": bench,
        "program_invariants": invariants,
        "limitations": limitations(dataset, evaluation, bench),
    }


# --- rendering -------------------------------------------------------------------------


def pct(value: Optional[float]) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def proportion(p: Optional[dict]) -> str:
    """`k/n (x%, 95% CI a to b)`; an empty set says so instead of showing a rate."""
    if not p or p["n"] == 0:
        return "no rows (n = 0)"
    return f"{p['successes']}/{p['n']} ({pct(p['value'])}, 95% CI {pct(p['ci95_low'])} to {pct(p['ci95_high'])})"


def ms(value: Optional[float]) -> str:
    return "n/a" if value is None else f"{value:,.0f} ms"


def table(header: list[str], rows: list[list[str]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return lines + [""]


def render_markdown(results: dict) -> str:
    out: list[str] = ["# HOLDBACK evaluation results", ""]
    git = results["git"]
    commit = git.get("commit") or "unknown"
    dirty = " with uncommitted changes" if git.get("uncommitted_changes") else ""
    out += [
        f"Generated {results['generated_at']} at commit `{commit}`{dirty} by `eval/merge_results.py`. "
        "Do not edit: every number here is copied from `eval/results.json`.",
        "",
        "## Read this first: limits of this run",
        "",
    ]
    out += [f"- {note}" for note in results["limitations"]] + [""]

    dataset = results["dataset"]
    if dataset:
        out += [
            "## Dataset",
            "",
            f"Cut-off date: {results['config']['cutoff_date']} (before = dev, on or after = held-out).",
            "",
        ]
        rows = [
            [key.replace("/", " / "), str(count)]
            for key, count in dataset["rows_by_label_split_source"].items()
        ]
        out += table(["Label / split / source", "Rows"], rows)
        out += table(
            ["Source", "Status", "Solana rows", "Retrieved", "Note"],
            [
                [
                    f"`{s['source']}`",
                    s["status"],
                    str(s.get("entries_solana", "")),
                    s.get("retrieved_at", "") or "",
                    s.get("note", "") or "",
                ]
                for s in dataset["sources"]
            ],
        )
        for excluded in dataset["excluded_sources"]:
            out += [
                f"Examined and left out: `{excluded['source']}` ({excluded['solana_addresses']} addresses): {excluded['reason']}.",
                "",
            ]

    holdback, baseline = results["holdback"], results["baseline"]
    if holdback or baseline:
        out += [
            "## Detection",
            "",
            f"A recipient counts as caught when its {(holdback or {}).get('detection_rule', 'tier is SUSPICIOUS or higher')}.",
            "",
        ]
        rows = []
        for split, title in SPLIT_TITLES.items():
            for name, block in (("Static blocklist", baseline), ("HOLDBACK", holdback)):
                if not block:
                    continue
                m = block["splits"][split]
                rows.append(
                    [
                        title,
                        name,
                        proportion(m["recall"]),
                        proportion(m["false_positive_rate"]),
                        proportion(m["precision"]),
                    ]
                )
            if holdback:
                m = holdback["splits"][split]
                rows.append(
                    [
                        title,
                        "HOLDBACK, label's own list excluded",
                        proportion(m["independent_recall"]),
                        "",
                        "",
                    ]
                )
        out += table(["Split", "Method", "Recall", "False-positive rate", "Precision"], rows)

    if holdback:
        out += ["## Value still reclaimable in replay", ""]
        out += [
            "Share of scam-payment value the sender could still pull back if they pressed Undo after the given delay, "
            "under the window the Guardian assigned. A plain transfer is 0% at every delay; the blocklist row is the share "
            "of payments it flags and so blocks, which does not depend on the delay. No delay distribution is "
            f"assumed. Payments without a stated amount use an assumed {results['config']['assumed_amount_usd']:,.0f} USD each "
            "(an assumption, not a measurement).",
            "",
        ]
        delays = list(results["config"]["replay_delays_secs"])
        rows = []
        for split, title in SPLIT_TITLES.items():
            replay = holdback["splits"][split]["replay"]
            shares = [pct(entry["share_of_value"]) for entry in replay["table"]]
            rows.append(
                [
                    title,
                    "HOLDBACK",
                    str(replay["payments"]),
                    str(replay["amounts_stated_by_source"]),
                    *shares,
                ]
            )
            if baseline:
                # A blocklist wallet stops what it flags; the rest is gone at any delay.
                blocked = baseline["splits"][split]["recall"]
                rows.append(
                    [
                        title,
                        "Static blocklist",
                        str(blocked["n"]),
                        "",
                        *[pct(blocked["value"])] * len(delays),
                    ]
                )
        out += table(
            ["Split", "Method", "Payments", "Amounts stated", *[f"Undo after {d}" for d in delays]],
            rows,
        )
        verdict = holdback["time_to_verdict"]["client_ms"]
        out += [
            "## Time to verdict",
            "",
            f"Median {ms(verdict['median_ms'])}, p95 {ms(verdict['p95_ms'])} over n = {verdict['n']} first-time assessments "
            "(client-side, one request at a time).",
            "",
        ]

    negative = results["negative_result"]
    if negative:
        out += ["## Negative result: wallets less than a day old", ""]
        shares = {entry["delay"]: entry for entry in negative["replay"]}
        out += [
            f"Caught: {proportion(negative['caught'])}. Windows assigned (seconds): {negative['windows_secs']}.",
            "",
        ]
        out += table(
            ["Group", "Caught", "Tiers"],
            [
                [
                    category,
                    proportion(block["caught"]),
                    ", ".join(f"{tier} {count}" for tier, count in block["tiers"].items() if count),
                ]
                for category, block in negative["by_category"].items()
            ],
        )
        out += table(
            ["Undo after", "Payments still reclaimable", "Share"],
            [
                [
                    delay,
                    f"{entry['payments_reclaimable']}/{entry['payments']}",
                    pct(entry["share_of_payments"]),
                ]
                for delay, entry in shares.items()
            ],
        )

    latency = results["latency"]
    if latency:
        out += ["## Latency", ""]
        rows = []
        assess = latency.get("assess") or {}
        for kind in ("cold", "warm"):
            if assess.get(kind):
                s = assess[kind]
                rows.append(
                    [f"`/v1/assess` ({kind})", str(s["n"]), ms(s["p50_ms"]), ms(s["p95_ms"])]
                )
        chain = latency.get("chain") or {}
        if chain.get("available"):
            for key, title in (
                ("create_hold", "`create_hold` to confirmed (devnet)"),
                ("reclaim", "`reclaim` to confirmed (devnet)"),
            ):
                s = chain[key]
                rows.append([title, str(s["n"]), ms(s["p50_ms"]), ms(s["p95_ms"])])
        out += table(["Measurement", "n", "p50", "p95"], rows)

    invariants = results["program_invariants"]
    if invariants:
        out += [
            "## Program invariants",
            "",
            f"{invariants['invariant_cases']:,} property-test cases, {invariants['instructions_executed']:,} instructions executed, "
            f"{invariants['holds_opened']:,} holds opened, {invariants['violations']:,} violations.",
            "",
        ]
    return "\n".join(out).rstrip() + "\n"


def format_with_prettier(path: Path) -> None:
    """Keeps the generated file in the repo's prettier style; skipped when Node is absent."""
    try:
        subprocess.run(
            ["npx", "prettier", "--write", str(path)],
            cwd=config.REPO_ROOT,
            capture_output=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def main() -> int:
    results = build_results(
        dataset=read_json(config.DATASET_META),
        baseline=read_json(config.BASELINE_JSON),
        evaluation=read_json(config.EVAL_JSON),
        bench=read_json(config.BENCH_RESULTS),
        invariants=read_json(config.INVARIANTS_JSON),
        git=git_state(config.REPO_ROOT),
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
    config.RESULTS_JSON.write_text(json.dumps(results, indent=2) + "\n")
    config.RESULTS_MD.write_text(render_markdown(results))
    format_with_prettier(config.RESULTS_MD)
    print(
        f"wrote {config.RESULTS_JSON.relative_to(config.REPO_ROOT)} and {config.RESULTS_MD.relative_to(config.REPO_ROOT)}"
    )
    for note in results["limitations"]:
        print(f"- {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
