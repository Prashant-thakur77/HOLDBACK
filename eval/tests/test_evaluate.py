"""Scoring: detection rule, split metrics, the label-leak control, replay and the fresh case."""

import pytest

import config
from dataset import FRESH, LEGIT, SCAM, Row
from evaluate import (
    Assessment,
    all_split_metrics,
    independent_flag,
    latency_summary,
    negative_result,
    replay_for,
    split_metrics,
    tier_at_least,
    tier_counts,
)


def row(address, label, split, source="ofac", category="x", amount=""):
    return Row(address, label, category, source, "", "2026-11-27", "", amount, split)


def assessment(address, tier="UNKNOWN", window=1800, evidence=()):
    return Assessment(address, tier, window, 0, 100.0, 90.0, (), tuple(evidence))


def test_detection_starts_at_suspicious():
    assert [tier_at_least(tier) for tier in config.TIERS] == [False, False, True, True, True]


def test_split_metrics_use_the_split_scam_rows_and_all_legit_rows():
    rows = [
        row("s1", SCAM, "heldout"),
        row("s2", SCAM, "heldout"),
        row("s3", SCAM, "dev"),
        row("l1", LEGIT, "all"),
        row("l2", LEGIT, "all"),
    ]
    flagged = {"s1": True, "s2": False, "s3": True, "l1": False, "l2": True}
    heldout = split_metrics(rows, flagged, "heldout")
    assert heldout["recall"]["successes"] == 1 and heldout["recall"]["n"] == 2
    assert heldout["false_positive_rate"]["successes"] == 1
    assert heldout["false_positive_rate"]["n"] == 2
    assert heldout["precision"]["value"] == 0.5
    dev = split_metrics(rows, flagged, "dev")
    assert dev["recall"]["value"] == 1.0 and dev["recall"]["n"] == 1


def test_rows_without_a_decision_are_counted_not_guessed():
    rows = [row("s1", SCAM, "heldout"), row("s2", SCAM, "heldout"), row("l1", LEGIT, "all")]
    result = split_metrics(rows, {"s1": True}, "heldout")
    assert result["recall"]["n"] == 1
    assert result["not_scored"] == 2


def test_an_empty_split_reports_n_zero_and_no_value():
    result = all_split_metrics([row("l1", LEGIT, "all")], {"l1": False})
    assert result["undated"]["recall"] == {
        "successes": 0,
        "n": 0,
        "value": None,
        "ci95_low": None,
        "ci95_high": None,
    }


def test_a_catch_that_only_repeats_the_label_is_not_independent():
    listed = assessment("s1", "SANCTIONED", 259_200, [("blocklist", "ofac_sanctioned", 100)])
    assert listed.flagged
    assert not independent_flag(listed, ["ofac"])


def test_other_evidence_still_counts_as_independent():
    behaviour = [
        ("blocklist", "ofac_sanctioned", 100),
        ("helius", "sweep_pattern", 25),
        ("helius", "wallet_new_7d", 8),
    ]
    assert independent_flag(assessment("s1", "SANCTIONED", 259_200, behaviour), ["ofac"])
    weak = [("blocklist", "ofac_sanctioned", 100), ("helius", "wallet_new_7d", 8)]
    assert not independent_flag(assessment("s1", "SANCTIONED", 259_200, weak), ["ofac"])
    # A Chainabuse-labelled row is not excused by the blocklist: the list is other evidence.
    assert independent_flag(
        assessment("s1", "FLAGGED", 86_400, [("blocklist", "scam_list_address", 70)]),
        ["chainabuse"],
    )
    assert not independent_flag(
        assessment("s1", "FLAGGED", 86_400, [("chainabuse", "confirmed_reports", 60)]),
        ["chainabuse"],
    )


def test_replay_uses_stated_amounts_and_labels_the_assumed_ones():
    rows = [row("s1", SCAM, "heldout", amount="3000"), row("s2", SCAM, "heldout")]
    result = replay_for(rows, {"s1": 86_400, "s2": 1_800})
    assert result["amounts_stated_by_source"] == 1
    assert result["amounts_assumed"] == 1
    by_delay = {entry["delay"]: entry for entry in result["table"]}
    assert by_delay["10 min"]["share_of_value"] == 1.0
    # After an hour only the 24 h window is still open: 3000 of 3000 + assumed 1000.
    assert by_delay["1 h"]["share_of_value"] == pytest.approx(
        3000 / (3000 + config.ASSUMED_AMOUNT_USD)
    )
    assert by_delay["1 h"]["share_of_payments"] == 0.5
    assert by_delay["24 h"]["share_of_value"] == 0.0


def test_fresh_wallets_with_the_default_window_are_missed_but_reclaimable_at_first():
    rows = [
        row("f1", FRESH, "fresh", "generated", "generated_keypair"),
        row("f2", FRESH, "fresh", "mainnet_sample", "sampled_new_wallet"),
        row("f3", FRESH, "fresh", "generated", "generated_keypair"),
    ]
    assessments = {"f1": assessment("f1"), "f2": assessment("f2")}
    result = negative_result(rows, assessments)
    assert result["n"] == 2 and result["not_scored"] == 1
    assert result["caught"]["successes"] == 0
    assert result["windows_secs"] == [1800]
    by_delay = {entry["delay"]: entry["share_of_value"] for entry in result["replay"]}
    assert by_delay == {"10 min": 1.0, "1 h": 0.0, "6 h": 0.0, "24 h": 0.0}
    assert set(result["by_category"]) == {"generated_keypair", "sampled_new_wallet"}


def test_tier_counts_and_latency_summary():
    rows = [row("a", LEGIT, "all"), row("b", LEGIT, "all"), row("c", LEGIT, "all")]
    assessments = {"a": assessment("a"), "b": assessment("b", "FLAGGED", 86_400)}
    counts = tier_counts(rows, assessments)
    assert counts["UNKNOWN"] == 1 and counts["FLAGGED"] == 1 and sum(counts.values()) == 2
    summary = latency_summary([100.0, 200.0, 300.0])
    assert summary["n"] == 3 and summary["median_ms"] == 200.0
    assert latency_summary([])["median_ms"] is None
