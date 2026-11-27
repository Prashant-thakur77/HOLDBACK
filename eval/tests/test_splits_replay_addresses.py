from datetime import date

import pytest

from addresses import (
    address_from_seed,
    b58decode,
    b58encode,
    ed25519_public_key,
    is_solana_address,
)
from replay import Payment, payment_amount, reclaimable, recovered_share, replay_table
from splits import DEV, HELDOUT, UNDATED, assign_split, parse_date

CUTOFF = date(2026, 1, 1)


# --- split -----------------------------------------------------------------------------


def test_split_before_cutoff_is_dev():
    assert assign_split(date(2025, 12, 31), CUTOFF) == DEV


def test_split_on_and_after_cutoff_is_heldout():
    assert assign_split(CUTOFF, CUTOFF) == HELDOUT
    assert assign_split(date(2026, 6, 1), CUTOFF) == HELDOUT


def test_split_without_date_is_never_mixed_in():
    assert assign_split(None, CUTOFF) == UNDATED


def test_parse_date_accepts_dates_and_timestamps_only():
    assert parse_date("2025-03-04") == date(2025, 3, 4)
    assert parse_date("2025-03-04T10:11:12Z") == date(2025, 3, 4)
    assert parse_date("") is None
    assert parse_date(None) is None
    assert parse_date("last week") is None


# --- addresses -------------------------------------------------------------------------


def test_system_program_is_a_valid_address():
    assert is_solana_address("11111111111111111111111111111111")
    assert b58decode("11111111111111111111111111111111") == bytes(32)


def test_token_program_round_trips():
    address = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    decoded = b58decode(address)
    assert decoded is not None and len(decoded) == 32
    assert b58encode(decoded) == address
    assert is_solana_address(address)


@pytest.mark.parametrize(
    "text",
    [
        "0x52908400098527886E0F7030069857D2E4169EE7",  # EVM
        "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",  # bech32 bitcoin
        "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",  # base58 but 25 bytes
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5D0",  # '0' is not in the alphabet
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DAA",  # 33 bytes
        "",
    ],
)
def test_other_chains_and_malformed_strings_are_rejected(text):
    assert not is_solana_address(text)


def test_ed25519_public_key_matches_rfc8032_test_vector_1():
    seed = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
    expected = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
    assert ed25519_public_key(seed).hex() == expected


def test_generated_address_is_valid_and_deterministic():
    first = address_from_seed(bytes(range(32)))
    assert first == address_from_seed(bytes(range(32)))
    assert is_solana_address(first)
    assert first != address_from_seed(bytes(range(1, 33)))


# --- replay ----------------------------------------------------------------------------


def test_undo_must_land_strictly_inside_the_window():
    assert reclaimable(window_secs=1800, delay_secs=600)
    assert not reclaimable(window_secs=1800, delay_secs=1800)
    assert not reclaimable(window_secs=1800, delay_secs=3600)
    assert not reclaimable(window_secs=0, delay_secs=0)


def test_recovered_share_weights_by_value():
    payments = [Payment(100.0, 1800), Payment(300.0, 86_400)]
    after_ten_minutes = recovered_share(payments, 600)
    assert after_ten_minutes["share_of_value"] == 1.0
    assert after_ten_minutes["share_of_payments"] == 1.0
    after_an_hour = recovered_share(payments, 3600)
    assert after_an_hour["value_reclaimable_usd"] == 300.0
    assert after_an_hour["share_of_value"] == 0.75
    assert after_an_hour["share_of_payments"] == 0.5
    assert after_an_hour["plain_transfer_share_of_value"] == 0.0


def test_recovered_share_of_nothing_is_undefined_not_zero():
    empty = recovered_share([], 600)
    assert empty["share_of_value"] is None
    assert empty["share_of_payments"] is None
    assert empty["plain_transfer_share_of_value"] is None


def test_replay_table_has_one_row_per_delay_in_order():
    table = replay_table([Payment(1.0, 21_600)], {"10 min": 600, "6 h": 21_600, "24 h": 86_400})
    assert [row["delay"] for row in table] == ["10 min", "6 h", "24 h"]
    assert [row["share_of_value"] for row in table] == [1.0, 0.0, 0.0]


def test_stated_amount_wins_over_the_assumption():
    assert payment_amount(250.0, 1000.0) == (250.0, True)
    assert payment_amount(None, 1000.0) == (1000.0, False)
    assert payment_amount(0.0, 1000.0) == (1000.0, False)
