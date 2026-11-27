import math

import pytest

from metrics import Proportion, classification_metrics, median, percentile, wilson_interval


def test_wilson_known_values():
    low, high = wilson_interval(5, 10)
    assert low == pytest.approx(0.2366, abs=1e-4)
    assert high == pytest.approx(0.7634, abs=1e-4)


def test_wilson_at_zero_successes_has_closed_form_upper_bound():
    # With p = 0 the interval is [0, z^2 / (n + z^2)].
    low, high = wilson_interval(0, 10)
    z2 = 1.959963984540054**2
    assert low == 0.0
    assert high == pytest.approx(z2 / (10 + z2), abs=1e-12)
    assert high == pytest.approx(0.2775, abs=1e-4)


def test_wilson_at_all_successes_mirrors_zero():
    low, high = wilson_interval(10, 10)
    assert high == 1.0
    assert low == pytest.approx(1 - wilson_interval(0, 10)[1], abs=1e-12)


def test_wilson_is_symmetric_under_swapping_outcomes():
    low, high = wilson_interval(3, 17)
    mirrored_low, mirrored_high = wilson_interval(14, 17)
    assert low == pytest.approx(1 - mirrored_high)
    assert high == pytest.approx(1 - mirrored_low)


def test_wilson_narrows_with_more_data():
    small = wilson_interval(5, 10)
    large = wilson_interval(500, 1000)
    assert (large[1] - large[0]) < (small[1] - small[0])


def test_wilson_without_data_is_none():
    assert wilson_interval(0, 0) is None


@pytest.mark.parametrize("successes,n", [(-1, 5), (6, 5), (0, -1)])
def test_wilson_rejects_impossible_counts(successes, n):
    with pytest.raises(ValueError):
        wilson_interval(successes, n)


def test_proportion_json_reports_n_and_interval():
    data = Proportion(3, 4).to_json()
    assert data["successes"] == 3 and data["n"] == 4
    assert data["value"] == 0.75
    assert data["ci95_low"] < 0.75 < data["ci95_high"]


def test_proportion_with_no_rows_has_no_value():
    assert Proportion(0, 0).to_json() == {
        "successes": 0,
        "n": 0,
        "value": None,
        "ci95_low": None,
        "ci95_high": None,
    }


def test_classification_metrics_on_known_confusion_matrix():
    # 3 of 4 scams flagged, 1 of 10 legit flagged.
    result = classification_metrics([True, True, True, False], [True] + [False] * 9)
    assert result["recall"]["value"] == 0.75
    assert result["recall"]["n"] == 4
    assert result["false_positive_rate"]["value"] == pytest.approx(0.1)
    assert result["false_positive_rate"]["n"] == 10
    assert result["precision"]["value"] == 0.75
    assert result["precision"]["n"] == 4


def test_precision_is_undefined_when_nothing_is_flagged():
    result = classification_metrics([False, False], [False])
    assert result["recall"]["value"] == 0.0
    assert result["precision"]["value"] is None
    assert result["precision"]["n"] == 0


def test_percentile_interpolates():
    values = [10, 20, 30, 40]
    assert percentile(values, 0) == 10
    assert percentile(values, 100) == 40
    assert percentile(values, 50) == 25
    assert median([3, 1, 2]) == 2
    assert math.isclose(percentile([1, 2, 3, 4, 5], 95), 4.8)


def test_percentile_of_nothing_is_none():
    assert percentile([], 50) is None
    with pytest.raises(ValueError):
        percentile([1], 101)
