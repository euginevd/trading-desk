from decimal import Decimal

from api.pot_stats import OTHER, Closed, stats

# Made-up figures only (known-mistakes 7).
DAY = 86_400_000
START = 1_794_000_000_000
PUT_IN = Decimal(1000)
JUDGE_AFTER = 30


def closed(day: int, setup: str, style: str | None, result: str, r: str) -> Closed:
    return Closed(START + day * DAY, setup, style, Decimal(result), Decimal(r))


BOOK = [
    closed(1, "Swing - Trend pullback", "Swing", "20", "2"),
    closed(2, "Swing - Trend pullback", "Swing", "-10", "-1"),
    closed(3, "Position - Pullback to the 20-week", "Position", "0", "0"),
    closed(4, "Pullback", None, "15", "1.5"),
    closed(5, "Swing - Sweep and reclaim", "Swing", "-10", "-1"),
]


def test_an_empty_book_has_no_rates_groups_or_curve() -> None:
    assert stats([], PUT_IN, JUDGE_AFTER) == {
        "trades": 0,
        "wins": 0,
        "losses": 0,
        "winRate": None,
        "avgWinR": None,
        "avgLossR": None,
        "expectancyR": None,
        "drawdownPct": "0",
        "judgeAfter": JUDGE_AFTER,
        "byStyle": [],
        "bySetup": [],
        "curve": [],
    }


def test_wins_losses_and_a_break_even_trade_counted_as_not_won() -> None:
    found = stats(BOOK, PUT_IN, JUDGE_AFTER)
    assert (found["trades"], found["wins"], found["losses"]) == (5, 2, 3)
    assert found["winRate"] == "40"
    assert found["avgWinR"] == "1.75"
    assert found["avgLossR"] == "-0.67"
    assert found["expectancyR"] == "0.3"
    assert found["judgeAfter"] == JUDGE_AFTER


def test_drawdown_is_the_deepest_fall_from_a_peak() -> None:
    # 1000 -> 1020 (peak) -> 1010 -> 1010 -> 1025 (peak) -> 1015: 10 off 1020 is the deepest.
    assert stats(BOOK, PUT_IN, JUDGE_AFTER)["drawdownPct"] == "1"
    assert stats(BOOK[:1], PUT_IN, JUDGE_AFTER)["drawdownPct"] == "0"


def test_by_style_groups_the_most_traded_first_with_other_for_no_style() -> None:
    assert stats(BOOK, PUT_IN, JUDGE_AFTER)["byStyle"] == [
        {
            "name": "Swing",
            "trades": 3,
            "wins": 1,
            "winRate": "33",
            "expectancyR": "0",
            "totalR": "0",
            "result": "0.00",
        },
        {
            "name": "Position",
            "trades": 1,
            "wins": 0,
            "winRate": "0",
            "expectancyR": "0",
            "totalR": "0",
            "result": "0.00",
        },
        {
            "name": OTHER,
            "trades": 1,
            "wins": 1,
            "winRate": "100",
            "expectancyR": "1.5",
            "totalR": "1.5",
            "result": "15.00",
        },
    ]


def test_by_setup_groups_on_the_setup_text() -> None:
    rows = stats(BOOK, PUT_IN, JUDGE_AFTER)["bySetup"]
    assert [(row["name"], row["trades"]) for row in rows] == [
        ("Swing - Trend pullback", 2),
        ("Position - Pullback to the 20-week", 1),
        ("Pullback", 1),
        ("Swing - Sweep and reclaim", 1),
    ]
    assert rows[0] == {
        "name": "Swing - Trend pullback",
        "trades": 2,
        "wins": 1,
        "winRate": "50",
        "expectancyR": "0.5",
        "totalR": "1",
        "result": "10.00",
    }


def test_the_curve_runs_in_close_order_whatever_order_the_book_is_in() -> None:
    points = stats(list(reversed(BOOK)), PUT_IN, JUDGE_AFTER)["curve"]
    assert [p["closed"] for p in points] == [START + day * DAY for day in range(1, 6)]
    assert [p["r"] for p in points] == ["2", "-1", "0", "1.5", "-1"]
    assert [p["cumR"] for p in points] == ["2", "1", "1", "2.5", "1.5"]
    assert [p["cumResult"] for p in points] == ["20.00", "10.00", "10.00", "25.00", "15.00"]
