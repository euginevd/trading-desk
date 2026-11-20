from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
from api import demo, screener
from api.audit import Audit
from api.binance import Binance
from api.pot import FEE, Pot
from api.pot_agent import PotAgent, clip
from api.store import Store
from api.trading import Refused, Trading

NOW = 1_794_000_000.0
DAY = 86_400_000


@pytest.fixture
def pot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Pot]:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    screener._UNIVERSE.clear()  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    screener._SCREENS.clear()  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)
    )
    audit = Audit(tmp_path / "audit.jsonl")
    store = Store(tmp_path / "desk.sqlite")
    desk = Trading(Binance(client, ("k", "s"), audit), store, audit, clock=lambda: NOW)
    desk.set_limits("500", "1000")
    found = Pot(desk)
    found.put_in({"usdc": "1000"})
    found.set_config({"mode": "risk", "fixed": "10", "riskPct": "1", "maxRisk": "10"})
    found._regime = ("bull", "BTC above its 200-day")  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    yield found
    store.close()


class Fake:
    def __init__(self, reply: dict[str, Any]) -> None:
        self.reply = reply
        self.asked: list[dict[str, Any]] = []

    def step(self, *args: object, **kw: Any) -> tuple[dict[str, Any], Decimal, str]:
        self.asked.append({"prompt": args[1], **kw})
        return self.reply, Decimal(0), "fake"


def candles(lows: list[float], closes: list[float], start: int = 0) -> list[list[Any]]:
    return [
        [start + i * DAY, str(c), str(max(c, lo) * 1.01), str(lo), str(c), "1", 0, "1000"]
        for i, (lo, c) in enumerate(zip(lows, closes, strict=True))
    ]


def test_every_style_trades_at_one_percent_except_in_a_bear() -> None:
    view = screener.styles_view(("neutral", "mixed"))
    assert [s["key"] for s in view["styles"]] == ["scalp", "day", "swing", "position"]
    assert all(s["allowed"] and s["riskPct"] == "2" for s in view["styles"])
    assert all(not screener.gate(s, "bear")[0] for s in screener.STYLES.values())


def test_the_target_clears_fees_at_the_style_reward() -> None:
    entry, stop = 100.0, 98.0
    target = screener.target_for(entry, stop, 2.0)
    f = float(FEE)
    risk = entry - stop + entry * f + stop * f
    reward = target - entry - entry * f - target * f
    assert reward / risk >= 2.0


def test_a_sweep_and_reclaim_at_a_zone_is_found() -> None:
    n = 120
    closes = [100 + i * 0.4 for i in range(n)]  # a steady uptrend, above its 50-day
    lows = [c - 1 for c in closes]
    zone = closes[-10]
    lows[-1] = zone - 2  # the last candle wicks under a recent level and closes back above
    rows = candles(lows, closes, start=1_790_000_000_000)
    found = screener._swing("SOL", rows, -5.0, screener.STYLES["swing"])  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    assert found is not None
    assert "Sweep and reclaim" in found["setup"] or "Trend pullback" in found["setup"]
    assert float(found["stop"]) < float(found["entry"]) < float(found["target"])


def test_every_style_screens_without_error(pot: Pot) -> None:
    agent = PotAgent(pot, None)
    for key in screener.STYLES:
        seen = agent.screen({"style": key})
        assert seen["style"] == key
        assert seen["counts"]["onBinance"] >= 1  # the demo's BTC, ETH and SOL pairs
        assert len(seen["misses"]) <= 3
        assert all(m["coin"] and m["why"] for m in seen["misses"])
        for f in seen["shortlist"]:  # each pick carries its odds, or None without the candles
            assert f["odds"] is None or f["odds"]["lean"] and f["odds"]["line"]
    # CoinGecko isn't reachable in the demo: the fallback list is kept 10 minutes, not all day.
    assert screener._UNIVERSE["day"] == ""  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    assert screener._UNIVERSE["until"] > NOW * 1000  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    with pytest.raises(Refused, match="Pick scalp"):
        agent.screen({"style": "yolo"})


def test_judge_sizes_each_pick_at_the_style_risk(pot: Pot, monkeypatch: pytest.MonkeyPatch) -> None:
    shortlist = [
        {
            "coin": "SOL",
            "setup": "Asia sweep",
            "grade": "B",
            "entry": "205",
            "stop": "200",
            "target": "217",
            "facts": {"price": "212.40"},
            "crowding": "Clear",
        }
    ]
    seen: dict[str, Any] = {
        "style": "day",
        "name": "Day trade",
        "regime": {"state": "bull", "words": ""},
        "warnings": [],
        "counts": {"listed": 3, "onBinance": 3, "liquid": 3, "setups": 1},
        "allowed": True,
        "note": "",
        "riskPct": "0.5",
        "shortlist": shortlist,
    }

    def last(*_a: object) -> dict[str, Any]:
        return seen

    monkeypatch.setattr(screener, "last_screen", last)
    pick = {
        "coin": "SOL",
        "setup": "Asia sweep",
        "grade": "A",
        "score": 8.4,
        "verdict": "take",
        "entry": "205",
        "stop": "200",
        "target": "217",
        "confluence": ["4h trend up", "yesterday's low"],
        "catalyst": "None found in 48 hours.",
        "crowding": "Clear",
        "reason": "Swept the Asia low at 205 and closed back above.",
    }
    stray = pick | {"coin": "DOGE"}
    fake = Fake({"line": "One day setup.", "picks": [pick, stray]})
    found = PotAgent(pot, fake).judge({"style": "day"})  # type: ignore[arg-type]
    assert [p["coin"] for p in found["picks"]] == ["SOL"]  # off the shortlist: dropped
    sol = found["picks"][0]
    assert sol["problem"] is None
    # 1% (10 USDC) would size past 25% of the pot on this tight stop: the position cap holds it
    assert Decimal("6.5") <= Decimal(sol["risk"]) <= Decimal("10.01")
    assert fake.asked[0]["model"] == "claude-sonnet-5-5"
    assert fake.asked[0]["searches"] == 2
    placed = pot.place(
        {"coin": "SOL", "entry": "205", "stop": "200", "target": "217", "setup": "Asia sweep"}
        | {"style": "day", "reason": "Swept.", "expires": found["expires"]}
    )
    assert placed["setup"] == "Day trade - Asia sweep"


def test_an_expired_proposal_is_refused(pot: Pot) -> None:
    body = {"coin": "SOL", "entry": "205", "stop": "200", "target": "217", "style": "scalp"}
    with pytest.raises(Refused, match="expired"):
        pot.place(body | {"expires": int(NOW * 1000) - 1})


def test_no_style_opens_a_long_in_a_bear(pot: Pot) -> None:
    body = {"coin": "SOL", "entry": "205", "stop": "190", "target": "260", "style": "position"}
    pot._regime = ("neutral", "mixed")  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    assert Decimal(pot.size(body)["risk"]) <= Decimal("10.01")
    pot._regime = ("bear", "under")  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    with pytest.raises(Refused, match="Bear regime"):
        pot.size(body)


def test_only_plain_tickers_and_no_stablecoins_join_the_universe() -> None:
    rows = [
        {"symbol": "sol", "name": "Solana", "current_price": 140, "market_cap_rank": 7},
        {"symbol": "\u5e01\u5b89\u4eba\u751f", "name": "Meme", "current_price": 0.1},
        {"symbol": "usdt", "name": "Tether", "current_price": 1},
        {"symbol": "steth", "name": "Lido Staked Ether", "current_price": 3000},
    ]
    http = httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(200, json=rows)))
    found = screener._crypto(http)  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    assert found == [{"coin": "SOL", "name": "Solana", "capRank": 7}]


def test_a_near_miss_says_how_far_and_why() -> None:
    falling = candles([100 - i * 0.5 - 1 for i in range(120)], [100 - i * 0.5 for i in range(120)])
    gap, coin, why = screener._swing_miss("SOL", falling, -5.0)  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    assert coin == "SOL"
    assert why.endswith("under its 50-day")
    assert gap > 0


def test_card_text_is_clipped_at_a_word_never_mid_word() -> None:

    assert clip("Clear: funding 0.01% per 8 hours", 70) == "Clear: funding 0.01% per 8 hours"
    assert clip("so momentum has broken and this is a deep pullback, again", 40) == (
        "so momentum has broken and this is a…"
    )


def test_the_paper_bot_asks_trading_agent_about_one_setup(pot: Pot) -> None:
    pick = {
        "coin": "SOL",
        "setup": "Trend pullback",
        "grade": "B",
        "score": 6.1,
        "verdict": "wait",
        "entry": "205",
        "stop": "195",
        "target": "226",
        "confluence": ["Holding the 50-day"],
        "against": ["Unlock in 5 days"],
        "catalyst": "SOL unlock 22 Nov.",
        "crowding": "Clear",
        "reason": "A pullback in an uptrend, but the unlock lands inside the hold.",
    }
    fake = Fake({"line": "Wait for the unlock.", "picks": [pick]})
    agent = PotAgent(pot, fake)  # type: ignore[arg-type]
    body = {"style": "swing", "coin": "sol", "setup": "Trend pullback", "price": "210"}
    said = agent.judge_one(body | {"entry": "205", "stop": "195", "target": "226"})
    assert said["verdict"] == "wait"
    assert said["catalyst"] == "SOL unlock 22 Nov."
    assert '"coin": "SOL"' in str(fake.asked[0]["prompt"])
    assert fake.asked[0]["model"] == "claude-opus-5-5"
    with pytest.raises(Refused, match="stop goes under"):
        agent.judge_one(body | {"entry": "205", "stop": "215", "target": "226"})
    with pytest.raises(Refused, match="Name the coin"):
        agent.judge_one(body | {"coin": "SOL/USDT", "entry": "205", "stop": "195", "target": "226"})
