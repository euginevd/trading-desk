from decimal import Decimal

from api.indicators import Candle
from api.plan import (
    Position,
    Rules,
    break_even_pct,
    checks,
    correct,
    levels,
    position,
    track,
    what_if,
)

D = Decimal
HOUR = 3_600_000


def bar(n: int, low: str, high: str, close: str | None = None) -> Candle:
    c = D(close or high)
    return Candle(n * HOUR, c, D(high), D(low), c, D(1))


HOLDINGS = [
    # 0.5 BTC on Binance bought at 100,000; 0.5 BTC in the wallet at 80,000.
    {
        "asset": "BTC",
        "amount": "0.5",
        "value": "45000",
        "averageCost": "100000",
        "covered": "0.5",
        "profit": "-5000",
    },
    {
        "asset": "BTC",
        "amount": "0.5",
        "value": "45000",
        "averageCost": "80000",
        "covered": "0.5",
        "profit": "5000",
    },
    {
        "asset": "ETH",
        "amount": "2",
        "value": "6000",
        "averageCost": None,
        "covered": None,
        "profit": None,
    },
]


def test_a_position_sums_both_places_with_a_weighted_average() -> None:
    pos = position(HOLDINGS, "BTC", total=D(100000))
    assert pos.qty == D(1)
    assert pos.avg_cost == D(90000)  # (0.5 x 100,000 + 0.5 x 80,000) / 1
    assert pos.invested == D(90000)
    assert pos.value == D(90000)
    assert pos.pnl == D(0)
    assert pos.pnl_pct == D(0)
    assert pos.weight_pct == D(90)
    none = position(HOLDINGS, "SOL", total=D(100000))
    assert not none.held()
    assert none.avg_cost is None


def test_break_even_is_the_rise_back_to_the_average() -> None:
    assert break_even_pct(D(100), D(80)) == D(25)  # 80 -> 100 is +25%
    assert break_even_pct(D(80), D(100)) == D(0)  # already above
    assert break_even_pct(None, D(100)) is None


def test_what_if_matches_a_hand_calculation() -> None:
    # 1 coin at an average of 100, price 80; add 400 at 80 buys 5 more: 6 coins for 500.
    pos = Position(D(1), D(100), D(100), D(80), D(-20), D(-20), D(8))
    found = what_if(pos, price=D(80), amount=D(400), total=D(1000), cash=D(600))
    assert found["newAvg"] == D(500) / D(6)  # 83.33
    assert found["breakEvenBefore"] == D(25)
    assert round(found["breakEvenAfter"], 4) == round((D(500) / D(6) / D(80) - 1) * 100, 4)  # 4.17%
    assert found["weightBefore"] == D(8)
    assert found["weightAfter"] == D(48)  # (80 + 400) / 1000
    assert found["cashLeft"] == D(200)


def test_the_rules_stop_adding_over_the_cap_and_flag_a_big_loss() -> None:
    rules = Rules()
    heavy = Position(D(1), D(100), D(100), D(80), D(-20), D(-20), D(80))
    found = checks(heavy, rules, after_weight=D(85))
    assert not found["canAdd"]
    assert "over the 25% cap" in found["notes"][0]
    assert found["pastMaxLoss"]  # down 20%, at the 20% max
    light = Position(D(1), D(100), D(100), D(110), D(10), D(10), D(5))
    assert checks(light, rules, after_weight=D(10))["canAdd"]
    assert not checks(light, rules, after_weight=D(30))["canAdd"]


def test_levels_come_from_swing_lows_and_highs_nearest_first() -> None:
    weekly = [
        bar(0, "100", "110"),
        bar(1, "98", "108"),
        bar(2, "90", "105"),  # swing low 90
        bar(3, "95", "107"),
        bar(4, "97", "109"),
        bar(5, "99", "130"),  # swing high 130
        bar(6, "100", "112"),
        bar(7, "101", "111"),
    ]
    found = levels([], weekly, D(100))
    assert [(lv["id"], lv["price"]) for lv in found] == [("S1", D(90)), ("R1", D(130))]
    assert found[0]["away"] == D(-10)
    assert found[0]["source"] == "weekly swing low"


def test_levels_skip_ones_at_the_price_and_merge_ones_close_together() -> None:
    weekly = [
        bar(0, "100", "110"),
        bar(1, "100", "110"),
        bar(2, "99.8", "110"),  # 0.2% under the price: too close to plan around
        bar(3, "100", "110"),
        bar(4, "100", "110"),
        bar(5, "95", "110"),  # 95
        bar(6, "100", "110"),
        bar(7, "100", "110"),
        bar(8, "94.5", "110"),  # 94.5: within 1.5% of 95, the same level
        bar(9, "100", "110"),
        bar(10, "100", "110"),
        bar(11, "90", "110"),  # 90
        bar(12, "100", "110"),
        bar(13, "100", "110"),
    ]
    found = levels([], weekly, D(100))
    assert [lv["price"] for lv in found if lv["id"].startswith("S")] == [D(95), D(90)]


def test_the_track_record_scores_signals_a_day_on() -> None:
    hourly = [bar(n, "0", "0", close=str(100 + n)) for n in range(60)]
    history = [
        {"ran": 0, "action": "Buy", "price": "100"},  # a day on: 124, up: right
        {"ran": 5 * HOUR, "action": "Sell", "price": "105"},  # 129, up: wrong
        {"ran": 10 * HOUR, "action": "Wait", "price": "110"},  # 134, +21.8%: wrong
        {"ran": 50 * HOUR, "action": "Buy", "price": "150"},  # not a day old yet
    ]
    assert track(history, hourly, now_ms=59 * HOUR) == {"scored": 3, "correct": 1, "hours": 24}
    assert correct("Hold", D("2.9"))
    assert not correct("Hold", D("-3.1"))
