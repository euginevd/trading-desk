"""The AI desk (TODO 3): indicators, the TAO wallet, the watchlist, AI signals and limit orders."""

import importlib
import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from typing import Any

import api.local
import httpx
import pytest
from api import demo
from api.ai_signal import SignalError, Signals, checked, usage_cost
from api.audit import Audit
from api.binance import Binance
from api.handler import Services, handler
from api.indicators import Candle, rsi, sma, summary, trend
from api.local import allowed
from api.market import MarketError, coin_symbol, key_levels, market
from api.service import fetch
from api.store import Store
from api.tao import TaoError, balance
from api.trading import Refused, Trading

NOW = 1_794_000_000.0
D = Decimal


@pytest.fixture
def parts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[Binance, Store, Audit]]:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)
    )
    audit = Audit(tmp_path / "audit.jsonl")
    store = Store(tmp_path / "desk.sqlite")
    yield Binance(client, ("k", "s"), audit), store, audit
    store.close()


def audit_lines(tmp_path: Path) -> list[dict[str, str]]:
    lines = (tmp_path / "audit.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines]


# Indicators


def test_rsi_is_high_after_steady_gains_and_low_after_losses() -> None:
    rising = [D(100 + i) for i in range(30)]
    falling = [D(100 - i) for i in range(30)]
    assert rsi(rising) == D(100)
    assert rsi(falling) == D(0)
    assert rsi([D(1)] * 5) is None  # not enough candles


def test_averages_and_trend() -> None:
    assert sma([D(1), D(2), D(3)], 2) == D("2.5")
    assert sma([D(1)], 2) is None
    assert trend(D(110), D(100), D(90)) == "Up, extended"
    assert trend(D(101), D(100), D(90)) == "Up"
    assert trend(D(80), D(90), D(100)) == "Down, extended"
    assert trend(D(95), D(100), D(90)) == "Sideways"
    assert trend(D(95), None, None) == "Not enough data"


def test_support_and_resistance_come_from_recent_candles() -> None:
    bars = [Candle(i, D(10), D(10 + i % 5), D(9 - i % 3), D(10), D(1)) for i in range(60)]
    figures = summary(bars)
    assert figures["support"] == D(7)
    assert figures["resistance"] == D(14)
    assert summary([])["trend"] == "Not enough data"


# The market route


def test_a_coin_is_read_however_the_owner_types_it() -> None:
    assert coin_symbol("sol") == "SOLUSDT"
    assert coin_symbol(" SOLUSDT ") == "SOLUSDT"
    for bad in ("", "SO L", "<script>", "X" * 13):
        with pytest.raises(MarketError):
            coin_symbol(bad)


def test_market_has_candles_and_indicators(parts: tuple[Binance, Store, Audit]) -> None:
    binance, _, _ = parts
    figures = market(binance, "SOLUSDT", "4h")
    assert figures["pair"] == "SOL/USDT"
    assert len(figures["candles"]) == 120
    assert figures["candles"][-1]["c"] == "212.4"
    assert figures["indicators"]["rsi"] is not None
    with pytest.raises(MarketError, match="15m"):
        market(binance, "SOLUSDT", "2h")
    names = [level["name"] for level in figures["levels"]]
    assert names[:3] == ["Month open", "Week open", "Day open"]
    assert "Prev day high" in names


def test_key_levels_come_from_the_month_week_and_day_candles(tmp_path: Path) -> None:
    def reply(request: httpx.Request) -> httpx.Response:
        rows = {
            "1M": [[0, "60000", "90000", "59000", "67000", "0", 0, "0"]],
            "1w": [
                [0, "71000", "72000", "65000", "70000", "0", 0, "0"],
                [1, "70000", "70500", "66000", "67000", "0", 0, "0"],
            ],
            "1d": [
                [0, "68000", "68400", "66400", "67500", "0", 0, "0"],
                [1, "67500", "67600", "66900", "67000", "0", 0, "0"],
            ],
        }
        return httpx.Response(200, json=rows[request.url.params["interval"]])

    client = httpx.Client(base_url="https://binance.test", transport=httpx.MockTransport(reply))
    binance = Binance(client, ("k", "s"), Audit(tmp_path / "audit.jsonl"))
    assert {lv["name"]: lv["price"] for lv in key_levels(binance, "BTCUSDC")} == {
        "Month open": "60000",
        "Week open": "70000",
        "Day open": "67500",
        "Prev week high": "72000",
        "Prev week low": "65000",
        "Prev day high": "68400",
        "Prev day low": "66400",
    }

    def refused(_: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"code": -1121, "msg": "Invalid symbol."})

    bad = httpx.Client(base_url="https://binance.test", transport=httpx.MockTransport(refused))
    assert key_levels(Binance(bad, ("k", "s"), Audit(tmp_path / "a.jsonl")), "X") == []


# The TAO wallet


def tao_client(reply: httpx.Response) -> httpx.Client:
    return httpx.Client(
        base_url="https://taostats.test", transport=httpx.MockTransport(lambda request: reply)
    )


def test_tao_balance_converts_rao_and_logs_without_the_key(tmp_path: Path) -> None:
    audit = Audit(tmp_path / "audit.jsonl")
    found = balance(
        httpx.Client(base_url="https://t.test", transport=httpx.MockTransport(demo.taostats)),
        "secret-key",
        demo.TAO_ADDRESS,
        audit,
    )
    assert found == {"free": D("12.4"), "staked": D(85), "total": D("97.4"), "rewards": D("1.5")}
    assert "secret-key" not in (tmp_path / "audit.jsonl").read_text(encoding="utf-8")


def test_tao_refuses_a_bad_address_and_reports_taostats_errors(tmp_path: Path) -> None:
    audit = Audit(tmp_path / "audit.jsonl")
    with pytest.raises(TaoError, match="isn't a Bittensor address"):
        balance(tao_client(httpx.Response(200)), "k", "not-an-address", audit)
    with pytest.raises(TaoError, match="401"):
        balance(tao_client(httpx.Response(401)), "k", demo.TAO_ADDRESS, audit)
    empty = balance(
        tao_client(httpx.Response(200, json={"data": []})), "k", demo.TAO_ADDRESS, audit
    )
    assert empty["total"] == D(0)


# AI signals


def figures() -> dict[str, Any]:
    return {
        "coin": "SOL",
        "pair": "SOL/USDT",
        "price": "200",
        "change24h": "1.5",
        "candles": [{"c": "199"}, {"c": "200"}],
        "indicators": {
            "rsi": "45",
            "sma20": "195",
            "sma50": "190",
            "support": "176",
            "resistance": "220",
            "trend": "Up",
        },
    }


def facts(**position: Any) -> dict[str, Any]:
    pos: dict[str, Any] = {
        "held": True,
        "qty": "10",
        "avgCost": "250",
        "invested": "2500",
        "value": "2000",
        "pnl": "-500",
        "pnlPct": "-20",
        "weightPct": "10",
    }
    return {
        "coin": "SOL",
        "pair": "SOL/USDT",
        "price": "200",
        "frames": {"4h": {"rsi": "45", "trend": "Down"}, "1D": {}, "1W": {}},
        "levels": [
            {"id": "S1", "price": "190", "source": "daily swing low", "awayPct": "-5"},
            {"id": "S2", "price": "176", "source": "weekly swing low", "awayPct": "-12"},
            {"id": "R1", "price": "220", "source": "daily swing high", "awayPct": "10"},
        ],
        "position": {**pos, **position},
        "rules": {"maxCoinPct": "25", "tradeBudgetAud": "500", "maxLossPct": "20"},
        "checks": {"canAdd": True, "pastMaxLoss": True, "notes": []},
        "openOrders": [{"side": "buy", "price": "180", "amount": "1"}],
    }


def reply(**fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "action": "Buy",
        "confidence": 72,
        "horizons": {"short": "Wait", "swing": "Buy", "long": "Sell"},
        "buy_from": "S2",
        "buy_to": "S1",
        "no_chase": "R1",
        "invalidation": "S1",
        "trim_from": "R1",
        "trim_to": "R1",
        "bull": "Held its weekly swing low",
        "bear": "Trend down on the 4-hour",
        "change_mind": "A daily close under S2 would end it, and this line runs on " + "long " * 60,
        "watch": [
            {"level": "R1", "direction": "above", "note": "Breakout"},
            {"level": "S9", "direction": "below", "note": "Not a level"},
        ],
        "changed": "First signal",
        "sentiment": "Bearish",
        "summary": "Pullback into support.",
    }
    return {**base, **fields}


def test_the_reply_is_held_to_its_shape_and_prices_come_from_the_levels() -> None:
    signal = checked(reply(confidence=400), facts())
    assert signal["action"] == "Add"  # held: Buy becomes Add
    assert signal["verdict"] == "Buy now"
    assert signal["confidence"] == 100
    assert signal["zones"]["buy"] == {"low": "176", "high": "190"}
    assert signal["zones"]["invalidation"] == {"price": "190", "next": "176"}
    assert signal["zones"]["noChase"] == "220"
    assert signal["watchFor"] == [{"price": "220", "direction": "above", "note": "Breakout"}]
    assert signal["support"] == "190"  # S1, from code
    assert signal["trend"] == "Down"  # indicators come from code, not the model
    assert signal["why"]["changeMind"].startswith("A daily close under 176.00 would end it")
    assert signal["why"]["changeMind"].endswith("long…")  # cut at a whole word
    with pytest.raises(SignalError):
        checked(reply(action="Sell everything"), facts())
    with pytest.raises(SignalError):
        checked(reply(horizons={"short": "Moon"}), facts())


def test_the_rules_overrule_the_model() -> None:
    over = facts(weightPct="80")
    over["checks"] = {"canAdd": False, "pastMaxLoss": True, "notes": ["over the cap"]}
    signal = checked(reply(), over)
    assert signal["action"] == "Hold"  # no adding over the cap a coin
    assert signal["zones"]["buy"] is None
    assert signal["horizons"]["swing"] == "Hold"
    assert signal["context"] == ["SOL is 80% of your portfolio."]
    none = facts(held=False, qty="0", pnl=None, pnlPct=None, weightPct="0")
    signal = checked(reply(action="Sell"), none)
    assert signal["action"] == "Wait"  # nothing sold that isn't held
    assert signal["zones"]["trim"] is None
    assert signal["horizons"]["long"] == "Wait"
    trimmed = checked(reply(action="Trim"), facts())
    assert "realise a loss of about $500" in trimmed["context"][0]
    assert "30 June" in trimmed["context"][0]


class Counter:
    def __init__(self, cost: str = "0.12") -> None:
        self.calls = 0
        self.cost = D(cost)
        self.prompts: list[str] = []
        self.shapes: list[dict[str, Any]] = []

    def __call__(
        self, system: str, prompt: str, shape: dict[str, Any]
    ) -> tuple[dict[str, Any], Decimal]:
        self.calls += 1
        self.prompts.append(prompt)
        self.shapes.append(shape)
        return reply(), self.cost


def test_a_signal_is_kept_four_hours_unless_re_run(parts: tuple[Binance, Store, Audit]) -> None:
    _, store, audit = parts
    clock = [NOW]
    ask = Counter()
    signals = Signals(ask, store, audit, clock=lambda: clock[0])
    first = signals.run(facts(), force=False)
    assert first["action"] == "Add"
    assert ask.calls == 1
    signals.run(facts(), force=False)
    assert ask.calls == 1  # kept
    second = signals.run(facts(), force=True)
    assert ask.calls == 2  # Re-run
    assert second["confidenceBefore"] == 72  # what it was last time
    clock[0] += 5 * 3600
    assert signals.last("SOL")["stale"] is True  # type: ignore[index]
    signals.run(facts(), force=False)
    assert ask.calls == 3
    assert signals.budget() == {"spent": "0.36", "cap": "20"}
    assert len(store.signal_history("SOL")) == 3


def test_the_prompt_carries_the_position_but_no_keys_or_ids(
    parts: tuple[Binance, Store, Audit],
) -> None:
    _, store, audit = parts
    ask = Counter()
    Signals(ask, store, audit, clock=lambda: NOW).run(facts(), force=True)
    prompt = ask.prompts[0]
    assert '"avgCost": "250"' in prompt
    assert '"weightPct": "10"' in prompt
    for private in ("orderId", "BINANCE", "api_key", "secret", "clientId"):
        assert private not in prompt
    levels = ask.shapes[0]["properties"]["buy_from"]["enum"]
    assert levels == ["S1", "S2", "R1", "none"]  # only this call's level ids


def test_an_answer_out_of_shape_keeps_the_last_good_signal(
    parts: tuple[Binance, Store, Audit],
) -> None:
    _, store, audit = parts
    good = Signals(Counter(), store, audit, clock=lambda: NOW)
    good.run(facts(), force=True)

    def broken(_s: str, _p: str, _shape: dict[str, Any]) -> tuple[dict[str, Any], Decimal]:
        return {"action": "Moon"}, D(0)

    with pytest.raises(SignalError):
        Signals(broken, store, audit, clock=lambda: NOW).run(facts(), force=True)
    assert good.last("SOL")["action"] == "Add"  # type: ignore[index]


def test_the_monthly_cap_stops_new_signals(
    parts: tuple[Binance, Store, Audit], tmp_path: Path
) -> None:
    _, store, audit = parts
    ask = Counter(cost="15")
    signals = Signals(ask, store, audit, cap=D(20), clock=lambda: NOW)
    signals.run(facts(), force=True)
    signals.run(facts(), force=True)  # 30 spent: over the cap now
    with pytest.raises(SignalError, match="cap"):
        signals.run(facts(), force=True)
    assert ask.calls == 2
    assert any(e["result"] == "Refused: monthly cap reached" for e in audit_lines(tmp_path))


def test_usage_cost_counts_tokens_and_searches() -> None:
    class Tools:
        web_search_requests = 3

    class Usage:
        input_tokens = 10_000
        output_tokens = 1_000
        cache_read_input_tokens = 0
        server_tool_use = Tools()

    assert usage_cost(Usage()) == D("0.04") + D("0.02") + D("0.03")


# The watchlist, signals and orders through the handler


@pytest.fixture
def services(
    parts: tuple[Binance, Store, Audit],
) -> Any:
    binance, store, audit = parts

    @contextmanager
    def factory() -> Generator[Services]:
        fx = httpx.Client(transport=httpx.MockTransport(demo.fx))
        yield Services(
            binance,
            store,
            Signals(demo.ask, store, audit, clock=lambda: NOW),
            audit,
            portfolio=lambda: fetch(binance, fx),
        )

    @contextmanager
    def trading() -> Generator[Trading]:
        yield Trading(binance, store, audit, clock=lambda: NOW)

    def call(method: str, path: str, body: object = None, **query: str) -> tuple[int, Any]:
        event: dict[str, object] = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}},
            "queryStringParameters": query,
            "body": json.dumps(body) if body is not None else "",
        }
        result = handler(event, None, trading=trading, services=factory)
        return int(str(result["statusCode"])), json.loads(str(result["body"]))

    return call


def test_the_watchlist_starts_with_a_few_coins_and_takes_up_to_ten(services: Any) -> None:
    status, view = services("GET", "/watchlist")
    assert status == 200
    assert [c["coin"] for c in view["coins"]] == ["BTC", "ETH", "SOL", "TAO"]
    status, view = services("POST", "/watchlist", {"coin": "link"})
    assert view["coins"][-1]["pair"] == "LINK/USDT"
    status, error = services("POST", "/watchlist", {"coin": "LINK"})
    assert status == 400
    assert "already" in error["error"]
    status, error = services("POST", "/watchlist", {"coin": "NOPE"})
    assert status == 400
    assert "no NOPE/USDT" in error["error"]
    status, view = services("DELETE", "/watchlist/BTC", {})
    assert "BTC" not in [c["coin"] for c in view["coins"]]


def test_a_full_watchlist_refuses_another_coin(
    services: Any, parts: tuple[Binance, Store, Audit]
) -> None:
    _, store, _ = parts
    services("GET", "/watchlist")
    for n in range(6):
        store.watch_coin(1, f"X{n}", n)
    status, error = services("POST", "/watchlist", {"coin": "LINK"})
    assert status == 400
    assert "Portfolio is full at 10" in error["error"]


def test_a_signal_runs_on_request_and_is_shown_on_the_watchlist(services: Any) -> None:
    status, none = services("GET", "/signal", coin="SOL")
    assert status == 200
    assert none == {"signal": None}
    status, ran = services("POST", "/signal", {"coin": "SOL"})
    assert status == 200
    assert ran["signal"]["verdict"] in ("Buy now", "Wait", "Avoid")
    _, view = services("GET", "/watchlist")
    sol = next(c for c in view["coins"] if c["coin"] == "SOL")
    assert sol["signal"]["verdict"] == ran["signal"]["verdict"]
    status, chart = services("GET", "/market", symbol="SOL", interval="1h")
    assert status == 200
    assert chart["interval"] == "1h"


def sell(**fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "clientId": "a1b2c3d4-0000-0000-0000-000000000009",
        "symbol": "SOLUSDT",
        "side": "sell",
        "price": "240",
        "amount": "0.3",
    }
    return {**base, **fields}


def test_limit_orders_keep_the_limits_and_the_kill_switch(services: Any) -> None:
    status, error = services("POST", "/orders", sell())
    assert status == 400
    assert "limits first" in error["error"]
    services("PUT", "/limits", {"perOrder": "100", "perDay": "500"})
    status, done = services("POST", "/orders", sell())
    assert status == 200
    assert "Limit sell placed: 0.3 SOL/USDT at 240" in done["message"]
    status, error = services("POST", "/orders", sell(amount="1"))
    assert status == 400
    assert "per-order limit" in error["error"]
    services("PUT", "/trading", {"on": False})
    status, error = services(
        "POST", "/orders", sell(clientId="a1b2c3d4-0000-0000-0000-00000000000a")
    )
    assert status == 400
    assert "Trading is off" in error["error"]


def test_a_limit_buy_is_a_smart_trade_and_can_be_cancelled(services: Any) -> None:
    services("PUT", "/limits", {"perOrder": "100", "perDay": "500"})
    buy = sell(side="buy", symbol="BTCUSDT", price="90000", amount="0.001", takeProfit="99000")
    status, done = services("POST", "/orders", buy)
    assert status == 200
    assert done["trade"]["status"] == "waiting"
    order_id = done["trade"]["buy_id"]
    status, _ = services("POST", "/orders/cancel", {"symbol": "BTCUSDT", "orderId": order_id})
    assert status == 200
    _, terminal = services("GET", "/trade", symbol="BTCUSDT")
    assert terminal["trades"][0]["status"] == "cancelled"
    assert all(o["orderId"] != order_id for o in terminal["openOrders"])


def test_any_open_order_can_be_cancelled_even_with_trading_off(services: Any) -> None:
    services("PUT", "/trading", {"on": False})
    status, done = services("POST", "/orders/cancel", {"symbol": "SOLUSDT", "orderId": 2})
    assert status == 200
    assert "Cancelled" in done["message"]
    status, error = services("POST", "/orders/cancel", {"symbol": "SOLUSDT", "orderId": "x"})
    assert status == 400
    assert "Pick an order" in error["error"]


def test_the_local_server_takes_deletes_only_as_json_from_the_desk() -> None:
    desk = {"host": "127.0.0.1:5173", "origin": "http://127.0.0.1:5173"}
    assert allowed("DELETE", {**desk, "content-type": "application/json"}) is None
    assert allowed("DELETE", desk) == "Send JSON."
    assert allowed("DELETE", {**desk, "origin": "https://evil.test"}) == "Unknown origin."


def test_refused_errors_read_plainly() -> None:
    assert str(Refused("x")) == "x"


def test_tickers_for_the_top_bar(services: Any) -> None:
    status, found = services("GET", "/tickers", coins="BTC,ETH,TAO,NOPE")
    assert status == 200
    assert [t["coin"] for t in found["tickers"]] == ["BTC", "ETH", "TAO"]


def test_another_local_desk_port_can_be_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DESK_ORIGINS", "http://127.0.0.1:15173, https://evil.test")
    local = importlib.reload(api.local)
    try:
        page = {"host": "127.0.0.1:15173", "origin": "http://127.0.0.1:15173"}
        assert local.allowed("GET", page) is None
        assert local.allowed("GET", {"host": "evil.test", "origin": "https://evil.test"})
    finally:
        monkeypatch.delenv("DESK_ORIGINS")
        importlib.reload(api.local)


def test_several_watchlists_each_with_a_count(services: Any) -> None:
    _, first = services("GET", "/watchlist")
    assert first["list"]["name"] == "Portfolio"
    assert first["lists"] == [{"id": 1, "name": "Portfolio", "count": 4}]
    status, made = services("POST", "/watchlists", {"name": "  Memes  "})
    assert status == 200
    assert made["list"]["name"] == "Memes"
    assert made["coins"] == []
    memes = made["list"]["id"]
    _, added = services("POST", "/watchlist", {"coin": "LINK", "list": memes})
    assert [c["coin"] for c in added["coins"]] == ["LINK"]
    assert {(x["name"], x["count"]) for x in added["lists"]} == {("Portfolio", 4), ("Memes", 1)}
    _, portfolio = services("GET", "/watchlist", list="1")
    assert "LINK" not in [c["coin"] for c in portfolio["coins"]]
    status, error = services("POST", "/watchlists", {"name": "memes"})
    assert status == 400
    assert "already" in error["error"]
    _, left = services("DELETE", "/watchlist/LINK", {}, list=str(memes))
    assert left["coins"] == []
    _, after = services("DELETE", f"/watchlists/{memes}", {})
    assert [x["name"] for x in after["lists"]] == ["Portfolio"]
    status, error = services("DELETE", "/watchlists/1", {})
    assert status == 400
    assert "at least one" in error["error"]


def test_the_old_single_watchlist_moves_into_portfolio(
    services: Any, parts: tuple[Binance, Store, Audit]
) -> None:
    _, store, _ = parts
    with store._db:  # pyright: ignore[reportPrivateUsage] - set up the old table directly
        store._db.execute(  # pyright: ignore[reportPrivateUsage]
            "INSERT INTO watchlist (coin, added) VALUES ('PUMP', 1), ('NEAR', 2)"
        )
    _, view = services("GET", "/watchlist")
    assert view["list"]["name"] == "Portfolio"
    assert [c["coin"] for c in view["coins"]] == ["PUMP", "NEAR"]


def test_tao_reuses_a_fresh_reading_and_falls_back_when_taostats_refuses(tmp_path: Path) -> None:
    calls: list[int] = []
    status = [200]

    def reply(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if status[0] != 200:  # noqa: PLR2004
            return httpx.Response(status[0])
        return httpx.Response(
            200, json={"data": [{"balance_free": "1000000000", "balance_staked": "0"}]}
        )

    now = [1000.0]
    client = httpx.Client(base_url="https://taostats.test", transport=httpx.MockTransport(reply))
    audit = Audit(tmp_path / "audit.jsonl")
    address = "5" + "A" * 47
    first = balance(client, "k", address, audit, clock=lambda: now[0])
    assert first["total"] == 1
    now[0] += 30
    balance(client, "k", address, audit, clock=lambda: now[0])
    assert len(calls) == 1  # under a minute: no second call
    now[0] += 120
    status[0] = 429
    assert balance(client, "k", address, audit, clock=lambda: now[0])["total"] == 1  # stands in
    assert "Used the last reading" in (tmp_path / "audit.jsonl").read_text(encoding="utf-8")
    now[0] += 7 * 3600
    with pytest.raises(TaoError, match="429"):
        balance(client, "k", address, audit, clock=lambda: now[0])
