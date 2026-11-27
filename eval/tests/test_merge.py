"""The merged results document: its schema, and that it never invents a missing section."""

import json

import config
from merge_results import SCHEMA_VERSION, build_results, limitations, proportion, render_markdown

TOP_LEVEL_KEYS = {
    "schema_version",
    "generated_at",
    "git",
    "environment",
    "config",
    "dataset",
    "baseline",
    "holdback",
    "negative_result",
    "latency",
    "program_invariants",
    "limitations",
}


def prop(successes, n):
    return {
        "successes": successes,
        "n": n,
        "value": successes / n if n else None,
        "ci95_low": 0.0 if n else None,
        "ci95_high": 0.5 if n else None,
    }


def split_block(with_replay):
    block = {"recall": prop(1, 3), "false_positive_rate": prop(0, 50), "precision": prop(1, 1)}
    if with_replay:
        table = [
            {
                "delay": label,
                "payments": 3,
                "payments_reclaimable": 3,
                "share_of_payments": 1.0,
                "share_of_value": 1.0,
            }
            for label in config.REPLAY_DELAYS_SECS
        ]
        block["independent_recall"] = prop(0, 3)
        block["replay"] = {
            "payments": 3,
            "amounts_stated_by_source": 0,
            "amounts_assumed": 3,
            "table": table,
        }
    return block


def fixture_inputs():
    dataset = {
        "cutoff_date": "2026-07-01",
        "mainnet_rpc_host": "rpc.example.test",
        "unavailable_sources": ["chainabuse"],
        "sources": [
            {
                "source": "chainabuse",
                "status": "unavailable",
                "note": "CHAINABUSE_API_KEY is not set",
            }
        ],
        "rows_by_label_split_source": {"scam/heldout/ofac": 3},
        "excluded_sources": [],
        "exchange_labels": "none found",
    }
    baseline = {"splits": {name: split_block(False) for name in ("heldout", "dev", "undated")}}
    evaluation = {
        "computed_at": "2026-11-27T00:00:00+00:00",
        "detection_rule": "tier is SUSPICIOUS or higher",
        "environment": {
            "assessments": 53,
            "assessments_failed": 1,
            "collectors_unavailable_in_every_assessment": ["blocklist"],
            "collectors_unavailable_in_some_assessments": {"sns": 2},
        },
        "splits": {name: split_block(True) for name in ("heldout", "dev", "undated")},
        "legit": {},
        "time_to_verdict": {"client_ms": {"n": 53, "median_ms": 400.0, "p95_ms": 900.0}},
        "negative_result": {
            "n": 2,
            "caught": prop(0, 2),
            "windows_secs": [1800],
            "by_category": {"generated_keypair": {"caught": prop(0, 2), "tiers": {"UNKNOWN": 2}}},
            "replay": [
                {
                    "delay": "10 min",
                    "payments": 2,
                    "payments_reclaimable": 2,
                    "share_of_payments": 1.0,
                    "share_of_value": 1.0,
                }
            ],
        },
    }
    invariants = {
        "invariant_cases": 100000,
        "instructions_executed": 609726,
        "holds_opened": 101379,
        "violations": 0,
    }
    return dataset, baseline, evaluation, invariants


def build(dataset, baseline, evaluation, bench, invariants):
    git = {"commit": "abc123", "uncommitted_changes": False}
    return build_results(
        dataset, baseline, evaluation, bench, invariants, git, "2026-11-27T00:00:00+00:00"
    )


def test_results_have_the_published_schema():
    dataset, baseline, evaluation, invariants = fixture_inputs()
    results = build(dataset, baseline, evaluation, None, invariants)
    assert set(results) == TOP_LEVEL_KEYS
    assert results["schema_version"] == SCHEMA_VERSION
    assert results["config"]["cutoff_date"] == config.CUTOFF_DATE.isoformat()
    assert results["config"]["assumed_amount_is_an_assumption"] is True
    assert results["program_invariants"] == invariants
    assert results["negative_result"] == evaluation["negative_result"]
    assert results["environment"]["dataset_sources_unavailable"] == ["chainabuse"]
    json.dumps(results)  # serialisable as it stands


def test_missing_inputs_stay_missing():
    results = build(None, None, None, None, None)
    for key in (
        "dataset",
        "baseline",
        "holdback",
        "negative_result",
        "latency",
        "program_invariants",
    ):
        assert results[key] is None
    text = " ".join(results["limitations"])
    assert "has not been run" in text and "has not been built" in text
    assert "# HOLDBACK evaluation results" in render_markdown(results)


def test_limitations_name_every_unavailable_collector_and_source():
    dataset, _, evaluation, _ = fixture_inputs()
    text = " ".join(
        limitations(dataset, evaluation, {"chain": {"available": False, "reason": "no funds"}})
    )
    assert "`blocklist` was unavailable in every assessment" in text
    assert "`sns` was unavailable in 2 of 53" in text
    assert "`chainabuse` was unavailable (CHAINABUSE_API_KEY is not set)" in text
    assert "1 assessment(s) failed" in text
    assert "n = 3" in text
    assert "no funds" in text


def test_markdown_puts_limits_first_and_copies_numbers():
    dataset, baseline, evaluation, invariants = fixture_inputs()
    text = render_markdown(build(dataset, baseline, evaluation, None, invariants))
    assert text.index("limits of this run") < text.index("## Detection")
    assert "1/3 (33.3%, 95% CI 0.0% to 50.0%)" in text
    assert "100,000 property-test cases" in text
    assert "Median 400 ms" in text


def test_an_empty_set_is_never_rendered_as_a_rate():
    assert proportion(prop(0, 0)) == "no rows (n = 0)"
    assert proportion(None) == "no rows (n = 0)"
