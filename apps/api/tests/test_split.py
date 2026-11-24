import pytest
from api.handler import (
    _failure,  # pyright: ignore[reportPrivateUsage]
    _split,  # pyright: ignore[reportPrivateUsage]
)
from api.trading import Refused


def test_split_returns_shares() -> None:
    assert _split({"total": "10", "parts": "2"}) == {"shares": ["5.00", "5.00"]}


@pytest.mark.parametrize(
    "query",
    [
        {},
        {"total": "abc", "parts": "2"},
        {"total": "NaN", "parts": "2"},
        {"total": "Infinity", "parts": "2"},
        {"total": "-5", "parts": "2"},
        {"total": "10", "parts": "0"},
        {"total": "10", "parts": "-2"},
        {"total": "10", "parts": "x"},
        {"total": "10", "parts": "100000000"},
    ],
)
def test_split_refuses_bad_input_with_a_400(query: dict[str, str]) -> None:
    with pytest.raises(Refused) as error:
        _split(query)
    assert _failure(error.value)[0] == 400
