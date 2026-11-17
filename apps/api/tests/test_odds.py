"""The odds check: break-even after fees, the lean, the stop-first race, a seeded simulation,
and the rule's record counting one trade at a time."""

from typing import Any

from api import odds, screener


def bar(t: int, o: float, h: float, lo: float, c: float) -> list[Any]:
    return [t, str(o), str(h), str(lo), str(c), "1", t + 299_999, "1"]


def test_break_even_is_one_over_one_plus_r_after_fees() -> None:
    assert round(odds.needed(100, 90, 120), 1) == 34.0  # 2R: 33.3% before fees, a bit more after
    assert odds.needed(100, 90, 100) == 100.0  # no reward: never worth it


def test_the_lean_is_measured_against_break_even() -> None:
    assert odds.lean(50, 50, 33.3, 50) == ("strong yes", 50.0)
    assert odds.lean(40, 60, 33.3, 50)[0] == "leans yes"
    assert odds.lean(35, 65, 33.3, 50)[0] == "coin flip"
    assert odds.lean(25, 75, 33.3, 50)[0] == "leans no"
    assert odds.lean(10, 90, 33.3, 50)[0] == "strong no"
    assert odds.lean(3, 2, 33.3, 8) == ("unclear", None)


def test_a_candle_that_touches_both_counts_as_the_stop() -> None:
    assert odds.walk([(121, 89)], 100, 90, 120, filled=True) == ("stop", 1)
    assert odds.walk([(105, 101), (121, 99)], 100, 90, 120, filled=True) == ("target", 2)
    # the candle that fills can't also take the target
    assert odds.walk([(125, 99), (121, 99)], 100, 90, 120, filled=False) == ("target", 2)
    assert odds.walk([(105, 101)], 100, 90, 120, filled=False) == ("unfilled", 1)
    assert odds.walk([(105, 95)], 100, 90, 120, filled=True) == ("open", 1)


def test_the_simulation_is_seeded_and_adds_up() -> None:
    rows = [
        bar(i * 300_000, 100, 101 + i % 3, 99 - i % 2, 100 + (i % 5 - 2) * 0.3) for i in range(400)
    ]
    one = odds.simulate(rows, 100, 99, 102, steps=12, slot_ms=300_000)
    two = odds.simulate(rows, 100, 99, 102, steps=12, slot_ms=300_000)
    assert one == two
    assert one is not None
    assert round(one["target"] + one["stop"] + one["open"] + one["unfilled"]) == 100
    assert odds.simulate(rows[:10], 100, 99, 102, steps=12, slot_ms=None) is None


def test_the_rule_record_counts_one_trade_at_a_time() -> None:
    rows = [bar(i, 100, 101, 99.5, 100) for i in range(10)]
    rows[3] = bar(3, 100, 103, 99.5, 102)  # the target, 102, hit on candle 3
    signals = [(i, 100.0, 98.0, 102.0, "Test") for i in (0, 1, 5)]
    record = odds.past(rows, signals, steps=3)
    # signal 0 wins on candle 3; signal 1 fires while it's open, so it's skipped
    assert record == {"signals": 2, "target": 1, "stop": 0, "open": 1, "unfilled": 0}


def test_a_pick_without_kept_candles_has_no_odds() -> None:
    assert screener.odds_for("swing", "NOPE", "1", "0.9", "1.2") is None
    assert screener.odds_for("unknown", "BTC", "1", "0.9", "1.2") is None


def test_the_summary_prefers_the_rule_record_when_it_has_enough() -> None:
    sim = {"paths": 2000, "target": 30.0, "stop": 50.0, "open": 15.0, "unfilled": 5.0,
           "share": 37.5, "lean": "coin flip"}  # fmt: skip
    record = {"signals": 12, "target": 7, "stop": 5, "open": 0, "unfilled": 0,
              "span": "the last 10 days", "share": 58.3, "lean": "strong yes"}  # fmt: skip
    out = odds.summary(sim, record, 33.3, "12 hours")
    assert out["lean"] == "strong yes"
    assert out["line"].startswith("Rule over the last 10 days: target first 7 of 12 (58%)")
    few = record | {"signals": 3, "target": 1, "stop": 2, "lean": "unclear", "share": None}
    assert odds.summary(sim, few, 33.3, "12 hours")["lean"] == "coin flip"
    still = record | {"signals": 1, "target": 0, "stop": 0, "open": 1, "lean": "unclear"}
    assert "1 past signal, none hit either" in odds.summary(sim, still, 33.3, "12 hours")["line"]


def walk_rows(n: int, step: int, seed: int) -> list[list[Any]]:
    """A random walk of candles in Binance's shape."""
    import random  # noqa: PLC0415 - only these tests draw

    rng = random.Random(seed)  # noqa: S311
    rows: list[list[Any]] = []
    price = 100.0
    for i in range(n):
        o = price
        price *= 1 + rng.gauss(0.002, 0.04)
        hi, lo = (
            max(o, price) * (1 + rng.random() * 0.02),
            min(o, price) * (1 - rng.random() * 0.02),
        )
        rows.append([i * step, o, hi, lo, price, 1000.0, (i + 1) * step - 1, 1000.0 * price])
    return rows


def test_the_bear_rule_is_the_desk_regime() -> None:
    from decimal import Decimal  # noqa: PLC0415

    from api.pot import regime_of  # noqa: PLC0415

    btc = walk_rows(400, odds.DAY_MS, 3)
    bear = screener.bear_by(btc)
    for j in (199, 250, 320, 399):
        state, _ = regime_of([Decimal(str(r[4])) for r in btc[: j + 1]])
        assert bear(int(btc[j][6])) == (state == "bear")


def test_a_signal_never_reads_a_later_candle() -> None:
    """The backtest's guarantee: the rule at candle i sees only candles closed by then, so
    cutting the history after i changes nothing at or before i."""
    day = odds.DAY_MS
    coin, btc = walk_rows(400, day, 1), walk_rows(400, day, 2)
    full = screener.signals("swing", "ETH", coin, bias=[], btc=btc, btc_daily=btc)
    assert full, "the walk should give the swing rule something to find"
    assert all(len(s) == 5 and s[4] for s in full)  # each carries its setup's name
    cut = full[len(full) // 2][0]
    part = screener.signals(
        "swing", "ETH", coin[: cut + 1], bias=[], btc=btc[: cut + 1], btc_daily=btc[: cut + 1]
    )
    assert part == [s for s in full if s[0] <= cut]
    later = screener.signals("swing", "ETH", coin, bias=[], btc=btc, btc_daily=btc, start=cut + 1)
    assert later == [s for s in full if s[0] > cut]
