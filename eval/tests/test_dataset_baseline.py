"""Dataset shaping, source parsers, sampling decisions and the blocklist baseline.

Everything here runs on small fixtures written in this file; nothing touches the network.
"""

import json
from datetime import date

from baseline import published_before
from chain_sample import PAGE, PROBE, classify_history, fee_payers, projected_pages
from dataset import (
    FRESH,
    LEGIT,
    SCAM,
    Row,
    count_by,
    drop_conflicts,
    merge_scam_rows,
    read_rows,
    with_split,
    write_rows,
)
from envfile import parse_dotenv
from sources import (
    Commit,
    count_yaml_mints,
    first_published,
    parse_address_lines,
    parse_chainabuse_reports,
    parse_commits,
    parse_json_string_array,
    parse_program_registry,
    solana_only,
)

A = "42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi"
B = "Fc1EwQUZyTEagaDvA1utHXCcZNyG1x2PLt2DfNu1cJdH"
C = "6wjqWWra8ombzaw6VHrG5xpQ972jCYF6bbHiFCbWmr4U"
TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
CUTOFF = date(2026, 7, 1)
DAY = 86_400
NOW = 1_800_000_000


def row(address, label=SCAM, source="ofac", report_date="", amount="", category="sanctioned"):
    return Row(
        address,
        label,
        category,
        source,
        f"https://example.test/{source}",
        "2026-11-27",
        report_date,
        amount,
        "",
    )


# --- parsers ---------------------------------------------------------------------------


def test_address_lines_skip_comments_and_blanks():
    assert parse_address_lines(f"# header\n\n{A}\n  {B}  \n") == [A, B]


def test_solana_filter_drops_other_chains_and_duplicates():
    mixed = [
        "0x52908400098527886E0F7030069857D2E4169EE7",
        A,
        "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        A,
        B,
    ]
    assert solana_only(mixed) == [A, B]
    assert solana_only(parse_json_string_array(json.dumps(["0xabc", 7, B]))) == [B]


def test_commits_are_sorted_oldest_first():
    payload = [
        {"sha": "bbb", "commit": {"committer": {"date": "2026-08-08T03:01:12Z"}}},
        {"sha": "aaa", "commit": {"committer": {"date": "2026-05-16T04:42:06Z"}}},
    ]
    assert parse_commits(json.dumps(payload)) == [
        Commit("aaa", date(2026, 5, 16)),
        Commit("bbb", date(2026, 8, 8)),
    ]


def test_first_published_finds_the_first_commit_holding_each_address():
    history = [
        Commit("c1", date(2026, 5, 16)),
        Commit("c2", date(2026, 7, 14)),
        Commit("c3", date(2026, 8, 8)),
    ]
    contents = {"c1": {A}, "c2": {A, B}, "c3": {A, B, C}}
    reads = []

    def snapshot(commit):
        reads.append(commit.sha)
        return contents[commit.sha]

    found = first_published([A, B, C, TOKEN], history, snapshot)
    assert found == {A: date(2026, 5, 16), B: date(2026, 7, 14), C: date(2026, 8, 8), TOKEN: None}


def test_first_published_without_history_is_unknown():
    assert first_published([A], [], lambda commit: set()) == {A: None}


def test_chainabuse_reports_keep_solana_addresses_dates_and_stated_losses():
    page = {
        "reports": [
            {
                "id": "r1",
                "createdAt": "2026-09-02T10:00:00Z",
                "lostAmountUsd": 1250.5,
                "addresses": [
                    {"address": A, "chain": "SOL"},
                    {"address": "0xdeadbeef", "chain": "ETH"},
                ],
            },
            {"id": "r2", "addresses": [{"address": B}]},
            {"id": "r3", "createdAt": "not a date", "addresses": None},
        ]
    }
    reports = parse_chainabuse_reports(json.dumps(page))
    assert [(r.address, r.report_date, r.amount_usd, r.report_id) for r in reports] == [
        (A, date(2026, 9, 2), 1250.5, "r1"),
        (B, None, None, "r2"),
    ]


def test_program_registry_keeps_mainnet_entries_with_names():
    text = """
export enum PROGRAM_NAMES {
    SYSTEM = 'System Program',
    TOKEN = 'Token Program',
    DEVONLY = 'Dev Only',
}
export const LOADER_IDS: { [key: string]: string } = {
    BPFLoaderUpgradeab1e11111111111111111111111: 'BPF Upgradeable Loader',
} as const;
export const PROGRAM_INFO_BY_ID: { [address: string]: ProgramInfo } = {
    '11111111111111111111111111111111': {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.SYSTEM,
    },
    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: {
        deployments: [Cluster.Mainnet, Cluster.Devnet],
        name: PROGRAM_NAMES.TOKEN,
    },
    '22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG': {
        deployments: [Cluster.Devnet],
        name: PROGRAM_NAMES.DEVONLY,
    },
};
"""
    assert parse_program_registry(text) == {
        "11111111111111111111111111111111": "System Program",
        TOKEN: "Token Program",
        "BPFLoaderUpgradeab1e11111111111111111111111": "BPF Upgradeable Loader",
    }


def test_yaml_mints_are_counted_once():
    assert count_yaml_mints(f"- mint: {A}\n- mint: {B}\n- mint: {A}\n- url: evil.example\n") == 2


def test_dotenv_parsing_ignores_comments_and_strips_quotes():
    text = "# comment\nA_KEY=abc\nexport B_KEY='quoted value'\nEMPTY=\nnot a line\n"
    assert parse_dotenv(text) == {"A_KEY": "abc", "B_KEY": "quoted value", "EMPTY": ""}


# --- dataset shaping -------------------------------------------------------------------


def test_scam_rows_for_one_address_are_merged():
    merged = merge_scam_rows(
        [
            row(A, source="ofac", report_date="2026-07-14"),
            row(
                A,
                source="chainabuse",
                report_date="2026-03-01",
                amount="500.00",
                category="reported_scam",
            ),
            row(B, source="ofac"),
        ]
    )
    assert [r.address for r in merged] == sorted([A, B])
    first = next(r for r in merged if r.address == A)
    assert first.source == "chainabuse|ofac"
    assert first.report_date == "2026-03-01"
    assert first.amount_usd == "500.00"


def test_an_address_listed_as_a_scam_never_stays_in_the_legit_set():
    legit = [
        row(A, LEGIT, "mainnet_sample"),
        row(TOKEN, LEGIT, "explorer_programs"),
        row(TOKEN, LEGIT, "mainnet_sample"),
    ]
    kept, conflicts = drop_conflicts(legit, {A})
    assert [r.address for r in kept] == [TOKEN]
    assert conflicts == 1


def test_split_assignment_per_label():
    assert with_split(row(A, report_date="2026-05-16"), CUTOFF).split == "dev"
    assert with_split(row(B, report_date="2026-07-14"), CUTOFF).split == "heldout"
    assert with_split(row(C), CUTOFF).split == "undated"
    assert with_split(row(TOKEN, LEGIT), CUTOFF).split == "all"
    assert with_split(row(TOKEN, FRESH), CUTOFF).split == "fresh"


def test_rows_survive_a_csv_round_trip(tmp_path):
    rows = [
        with_split(row(A, report_date="2026-05-16"), CUTOFF),
        with_split(row(TOKEN, LEGIT), CUTOFF),
    ]
    path = tmp_path / "dataset.csv"
    write_rows(path, rows)
    assert read_rows(path) == rows
    assert count_by(rows, "label", "split") == {"legit/all": 1, "scam/dev": 1}


# --- sampling decisions ----------------------------------------------------------------


def test_fee_payers_skip_votes_and_failed_transactions():
    block = {
        "transactions": [
            {
                "meta": {"err": None},
                "transaction": {"accountKeys": [{"pubkey": A}, {"pubkey": TOKEN}]},
            },
            {
                "meta": {"err": {"InstructionError": [0, "Custom"]}},
                "transaction": {"accountKeys": [{"pubkey": B}]},
            },
            {
                "meta": {"err": None},
                "transaction": {
                    "accountKeys": [
                        {"pubkey": C},
                        {"pubkey": "Vote111111111111111111111111111111111111111"},
                    ]
                },
            },
        ]
    }
    assert fee_payers(block) == [A]
    assert fee_payers(None) == []


def test_a_transaction_older_than_a_year_proves_an_established_wallet():
    pages = [[{"blockTime": NOW - 10}, {"blockTime": NOW - 400 * DAY}]]
    assert classify_history(pages, NOW, 365, 24)[0] == "established"


def test_a_short_complete_history_inside_a_day_is_fresh():
    pages = [[{"blockTime": NOW - 3_600}, {"blockTime": NOW - 7_200}]]
    kind, oldest, seen, complete = classify_history(pages, NOW, 365, 24)
    assert (kind, oldest, seen, complete) == ("fresh", NOW - 7_200, 2, True)


def test_a_wallet_is_left_out_when_its_age_is_not_proven():
    month_old = [[{"blockTime": NOW - 30 * DAY}]]
    assert classify_history(month_old, NOW, 365, 24)[0] is None
    # A full page of recent activity says nothing about what came before it.
    full_recent_page = [[{"blockTime": NOW - 60}] * PAGE]
    assert classify_history(full_recent_page, NOW, 365, 24)[0] is None
    assert classify_history([[]], NOW, 365, 24)[0] is None


def test_projection_gives_up_on_very_busy_wallets_only():
    busy = [{"blockTime": NOW - 600}] * PROBE  # 25 transactions in ten minutes
    quiet = [{"blockTime": NOW - 200 * DAY}] * PROBE  # 25 transactions in 200 days
    assert projected_pages(busy, NOW, 365) > 1_000
    assert projected_pages(quiet, NOW, 365) < 1


# --- baseline --------------------------------------------------------------------------


def test_baseline_flags_only_what_was_published_before_the_cutoff():
    history = {A: date(2026, 5, 16), B: date(2026, 7, 14), C: None, TOKEN: CUTOFF}
    assert published_before(history, CUTOFF) == {A}


def test_baseline_cutoff_is_exclusive_and_unknown_dates_are_not_assumed():
    assert published_before({A: date(2026, 6, 30)}, CUTOFF) == {A}
    assert published_before({A: CUTOFF}, CUTOFF) == set()
    assert published_before({A: None}, CUTOFF) == set()
