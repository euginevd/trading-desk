import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
from api import demo
from api.audit import Audit
from api.binance import Binance, BinanceError
from api.bots import Bots, Config, backtest, config_of, ladder, parse, stored
from api.handler import handler
from api.indicators import Candle, bollinger
from api.store import Store
from api.trading import Refused, Trading

NOW = 1_794_000_000.0
HOUR = 3_600_000

SETTINGS = {
    "symbol": "BTCUSDT",
    "name": "Dip buyer",
    "timeframe": "1h",
    "bbLength": "20",
    "bbDeviation": "2",
    "baseOrder": "25",
    "dcaOrder": "20",
    "deviation": "2",
    "maxDcaOrders": "5",
    "sizeMultiplier": "1.2",
    "deviationMultiplier": "1",
    "takeProfit": "1.5",
    "afterTakeProfit": "next",
}


def candle(n: int, close: str, low: str | None = None, high: str | None = None) -> Candle:
    c = Decimal(close)
    return Candle(
        n * HOUR, c, Decimal(high) if high else c, Decimal(low) if low else c, c, Decimal(1)
    )


def test_the_ladder_matches_the_mockup() -> None:
    rows = ladder(parse(SETTINGS), Decimal("67224.05"))
    assert [round(r["price"], 2) for r in rows] == [
        Decimal("67224.05"),
        Decimal("65879.57"),
        Decimal("64535.09"),
        Decimal("63190.61"),
        Decimal("61846.13"),
        Decimal("60501.64"),
    ]
    assert round(rows[-1]["total"], 2) == Decimal("173.83")
    assert round(rows[-1]["average"], 2) == Decimal("63271.35")
    assert round(rows[-1]["takeProfit"], 2) == Decimal("64220.42")
    assert rows[-1]["drop"] == Decimal(10)


def test_settings_are_checked_and_kept() -> None:
    config = parse(SETTINGS)
    assert config_of({"config": stored(config)}) == config
    assert config.budget() == Decimal("173.832")
    with pytest.raises(Refused, match="Deviation %"):
        parse({**SETTINGS, "deviation": "0"})
    with pytest.raises(Refused, match="timeframe"):
        parse({**SETTINGS, "timeframe": "1m"})
    with pytest.raises(Refused, match="whole number"):
        parse({**SETTINGS, "maxDcaOrders": "2.5"})
    with pytest.raises(Refused, match="95%"):
        parse({**SETTINGS, "deviation": "20", "maxDcaOrders": "5"})


def test_bollinger_bands() -> None:
    bands = bollinger([Decimal(v) for v in (1, 2, 3, 4, 5)], 5, Decimal(2))
    assert bands is not None
    lower, middle, upper = bands
    assert middle == Decimal(3)
    assert round(upper - middle, 4) == round(2 * Decimal(2).sqrt(), 4)
    assert lower == 2 * middle - upper
    assert bollinger([Decimal(1)], 5, Decimal(2)) is None


def test_backtest_closes_a_deal_bought_in_the_dip() -> None:
    config = Config(
        bb_length=5, bb_deviation=Decimal("1.5"), max_dca_orders=2, take_profit=Decimal(2)
    )
    flat = [candle(n, "100") for n in range(5)]
    history = [
        *flat,
        candle(5, "90"),  # closes below the lower band: a deal at 90
        candle(6, "88", low="87"),  # the base fills, and DCA 1 at 88.2
        candle(7, "95", high="95"),  # the average is about 89, take profit 90.8: closed
    ]
    result = backtest(config, history, HOUR)
    assert result["deals"] == 1
    assert Decimal(result["profit"]) > 0
    assert result["mostDcaFilled"] == 1
    assert not result["openDeal"]


@pytest.fixture
def bots(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Bots]:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)
    )
    audit = Audit(tmp_path / "audit.jsonl")
    store = Store(tmp_path / "desk.sqlite")
    yield Bots(Binance(client, ("k", "s"), audit), store, audit, clock=lambda: NOW)
    store.close()


def dip(bots: Bots, monkeypatch: pytest.MonkeyPatch) -> None:
    """The last closed candle sits below the lower band."""
    rows = [candle(n, "98420") for n in range(25)] + [candle(25, "90000")]

    def closed(*_: object) -> list[Candle]:
        return rows

    monkeypatch.setattr(bots, "_closed", closed)


def fill(order_id: int) -> None:
    order = demo.EXCHANGE.orders[order_id]
    qty = Decimal(order["origQty"])
    order |= {
        "status": "FILLED",
        "executedQty": str(qty),
        "cummulativeQuoteQty": str(qty * Decimal(order["price"])),
    }


def orders(side: str) -> list[dict[str, Any]]:
    return [o for o in demo.EXCHANGE.orders.values() if o["side"] == side and o["orderId"] > 100]


def test_a_bot_starts_off_and_needs_a_confirm(bots: Bots, monkeypatch: pytest.MonkeyPatch) -> None:
    dip(bots, monkeypatch)
    view = bots.create(SETTINGS)
    bot = view["bots"][0]
    assert bot["status"] == "off"
    assert bot["budget"] == "173.83"
    bots.step()
    assert orders("BUY") == []  # off: nothing placed
    with pytest.raises(Refused, match="Confirm"):
        bots.switch(bot["id"], on=True, confirmed=False)
    with pytest.raises(Refused, match="limits first"):
        bots.switch(bot["id"], on=True, confirmed=True)
    bots.trading.set_limits("10", "100")
    with pytest.raises(Refused, match="per-order limit"):
        bots.switch(bot["id"], on=True, confirmed=True)


def test_a_deal_runs_from_signal_to_take_profit(
    bots: Bots, monkeypatch: pytest.MonkeyPatch
) -> None:
    dip(bots, monkeypatch)
    bots.trading.set_limits("50", "500")
    bot_id = bots.create(SETTINGS)["bots"][0]["id"]
    assert bots.switch(bot_id, on=True, confirmed=True)["bots"][0]["status"] == "waiting"

    bots.step()  # the signal: the base order and five DCA orders, all limit buys
    buys = orders("BUY")
    assert len(buys) == 6
    assert all(o["type"] == "LIMIT" for o in buys)
    assert buys[0]["price"] == "98420"
    assert buys[1]["price"] == "96451.6"  # 2% below
    assert Decimal(bots.trading.settings()["spentToday"]) == Decimal(
        "171.34922"
    )  # each amount rounded down to the pair's step
    bots.step()  # the same candle again: no second deal
    assert len(orders("BUY")) == 6

    fill(buys[0]["orderId"])
    bots.step()  # the base filled: a take-profit sell 1.5% over it
    sells = orders("SELL")
    assert len(sells) == 1
    assert sells[0]["price"] == "99896.3"
    assert sells[0]["origQty"] == "0.00025"

    fill(buys[1]["orderId"])
    bots.step()  # DCA 1 filled: the take profit moves to the new average
    sells = orders("SELL")
    assert sells[0]["status"] == "CANCELED"
    assert sells[1]["status"] == "NEW"
    assert Decimal(sells[1]["origQty"]) == Decimal("0.00045")
    deal = bots.view()["bots"][0]["deals"][0]
    assert deal["filled"] == 1
    assert deal["nextPrice"] == "94483.2"

    fill(sells[1]["orderId"])
    bots.step()  # take profit: the deal closes and its other buys are cancelled
    view = bots.view()["bots"][0]
    assert view["deals"] == []
    assert view["closed"] == 1
    assert Decimal(view["profit"]) > 0
    assert all(o["status"] == "CANCELED" for o in orders("BUY")[2:])
    assert view["status"] == "waiting"


def test_the_kill_switch_stops_bots_and_cancels_their_buys(
    bots: Bots, monkeypatch: pytest.MonkeyPatch
) -> None:
    dip(bots, monkeypatch)
    bots.trading.set_limits("50", "500")
    bot_id = bots.create(SETTINGS)["bots"][0]["id"]
    bots.switch(bot_id, on=True, confirmed=True)
    bots.step()
    fill(orders("BUY")[0]["orderId"])
    bots.step()
    bots.trading.set_trading(False)
    bots.step()
    view = bots.view()["bots"][0]
    assert not view["enabled"]
    assert view["note"] == "Stopped by the kill switch."
    assert all(o["status"] == "CANCELED" for o in orders("BUY")[1:])
    assert orders("SELL")[0]["status"] == "NEW"  # the take profit stays: it only takes risk away
    with pytest.raises(Refused, match="Switch the bot off|Wait for its deal"):
        bots.delete(bot_id)


def test_the_routes(bots: Bots, monkeypatch: pytest.MonkeyPatch) -> None:
    @contextmanager
    def factory() -> Generator[Bots]:
        yield bots

    @contextmanager
    def trading() -> Generator[Trading]:
        yield bots.trading

    def call(method: str, path: str, body: object = None) -> tuple[int, Any]:
        event: dict[str, object] = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}},
            "body": json.dumps(body) if body is not None else None,
        }
        reply = handler(event, None, trading=trading, bots=factory)
        return int(str(reply["statusCode"])), json.loads(str(reply["body"]))

    status, preview = call("POST", "/bots/preview", SETTINGS)
    assert status == 200
    assert len(preview["ladder"]) == 6
    assert preview["backtest"]["candles"] > 0
    assert "Set your per-order and daily limits first." in preview["problems"]
    status, made = call("POST", "/bots", SETTINGS)
    bot_id = made["bots"][0]["id"]
    renamed = call("PUT", f"/bots/{bot_id}", {**SETTINGS, "name": "Renamed"})[1]
    assert renamed["bots"][0]["name"] == "BTC/USDT"  # a bot is named after its pair
    status, error = call("POST", f"/bots/{bot_id}/switch", {"on": True})
    assert status == 400
    assert "Confirm" in error["error"]
    assert call("GET", "/bots")[1]["bots"][0]["status"] == "off"
    dip(bots, monkeypatch)
    bots.trading.set_limits("50", "500")
    assert call("POST", f"/bots/{bot_id}/switch", {"on": True, "confirmed": True})[0] == 200
    assert call("PUT", "/trading", {"on": False})[0] == 200
    assert call("GET", "/bots")[1]["bots"][0]["enabled"] is False
    assert call("DELETE", f"/bots/{bot_id}")[1]["bots"] == []


def test_simultaneous_deals_start_on_later_signals(
    bots: Bots, monkeypatch: pytest.MonkeyPatch
) -> None:
    rows = [candle(n, "98420") for n in range(25)] + [candle(25, "90000")]

    def closed(*_: object) -> list[Candle]:
        return rows

    monkeypatch.setattr(bots, "_closed", closed)
    bots.trading.set_limits("50", "1000")
    bot_id = bots.create({**SETTINGS, "maxDeals": "2"})["bots"][0]["id"]
    bots.switch(bot_id, on=True, confirmed=True)
    bots.step()
    rows.append(candle(26, "89000"))  # a new candle closes below the band: a second deal
    bots.step()
    rows.append(candle(27, "88000"))  # a third signal: no room, two at once is the most
    bots.step()
    view = bots.view()["bots"][0]
    assert [d["ref"] for d in view["deals"]] == ["D-1", "D-2"]
    assert view["ref"] == f"DCA-{bot_id}"
    assert view["maxBudget"] == "347.66"
    detail = bots.detail(bot_id)
    assert [d["ref"] for d in detail["deals"]] == ["D-2", "D-1"]  # newest first
    assert detail["deals"][1]["orders"][0]["ref"] == "D-1-0"
    assert detail["deals"][1]["orders"][0]["kind"] == "Base order"


def test_a_preset_comes_from_the_last_30_days_with_a_reason_each(bots: Bots) -> None:
    bots.trading.set_limits("30", "500")
    found = bots.suggest({"symbol": "BTCUSDT"})
    config = found["config"]
    assert config["timeframe"] in ("1h", "4h")
    assert Decimal(config["baseOrder"]) <= 30  # inside the per-order limit
    top = Decimal(config["dcaOrder"]) * Decimal(config["sizeMultiplier"]) ** (
        config["maxDcaOrders"] - 1
    )
    assert top <= Decimal(31)
    assert set(found["reasons"]) >= {"timeframe", "deviation", "maxDcaOrders", "takeProfit"}
    assert all(found["reasons"].values())
    assert parse({**config, "symbol": "BTCUSDT"}).timeframe == config["timeframe"]


TRADE = {
    **SETTINGS,
    "entryPrice": "98000",
    "maxDcaOrders": "2",
    "takeProfitOn": True,
    "stopLoss": "90000",
}


def test_a_smart_trade_enters_at_its_price_and_finishes(bots: Bots) -> None:
    bots.trading.set_limits("50", "500")
    made = bots.create(TRADE)
    trade = made["trades" if "trades" in made else "bots"][0]
    assert trade["ref"].startswith("TR-")
    assert bots.view()["bots"] == []  # trades aren't listed with the bots
    bots.switch(trade["id"], on=True, confirmed=True)
    bots.step()  # no signal needed: the base order at 98,000 and two DCA orders
    buys = orders("BUY")
    assert [o["price"] for o in buys] == ["98000", "96040", "94080"]
    fill(buys[0]["orderId"])
    bots.step()
    sells = orders("SELL")
    assert sells[0]["price"] == "99470"  # 1.5% over 98,000
    fill(sells[0]["orderId"])
    bots.step()
    view = bots.view("trade")["bots"][0]
    assert view["closed"] == 1
    assert not view["enabled"]  # one deal, then finished
    assert view["note"] == "Finished at take profit."
    bots.step()
    assert len(orders("BUY")) == 3  # nothing new


def test_a_smart_trade_stop_loss_sells_at_market(
    bots: Bots, monkeypatch: pytest.MonkeyPatch
) -> None:
    bots.trading.set_limits("50", "500")
    trade_id = bots.create({**TRADE, "takeProfitOn": False})["bots"][0]["id"]
    bots.switch(trade_id, on=True, confirmed=True)
    bots.step()
    fill(orders("BUY")[0]["orderId"])
    bots.step()
    assert orders("SELL") == []  # take profit off
    monkeypatch.setitem(demo.PRICES, "BTCUSDT", ("89000", "-9"))
    bots.step()
    market = [o for o in orders("SELL") if o["type"] == "MARKET"]
    assert len(market) == 1
    assert all(o["status"] == "CANCELED" for o in orders("BUY")[1:])
    detail = bots.detail(trade_id)
    assert detail["deals"][0]["status"] == "stopped"
    assert "Stop loss" in detail["deals"][0]["note"]
    assert not detail["bot"]["enabled"]


def test_close_sells_a_trade_at_market(bots: Bots) -> None:
    bots.trading.set_limits("50", "500")
    trade_id = bots.create(TRADE)["bots"][0]["id"]
    bots.switch(trade_id, on=True, confirmed=True)
    bots.step()
    fill(orders("BUY")[0]["orderId"])
    bots.step()
    bots.close_now(trade_id)
    assert any(o["type"] == "MARKET" for o in orders("SELL"))
    assert bots.detail(trade_id)["deals"][0]["note"] == "Closed at market by you."
    with pytest.raises(Refused, match="Nothing is open"):
        bots.close_now(trade_id)


def test_a_stop_loss_must_sit_under_the_last_buy() -> None:
    with pytest.raises(Refused, match="under the last buy"):
        parse({**TRADE, "stopLoss": "95000"})
    with pytest.raises(Refused, match="smart trade"):
        parse({**SETTINGS, "stopLoss": "1"})


def lost_reply(real: Any) -> Any:
    """Sends the order to the pretend exchange, then loses the answer (a timeout)."""

    def send(*args: Any, **kwargs: Any) -> Any:
        real(*args, **kwargs)
        raise BinanceError(0, "Binance didn't answer.")

    return send


def test_a_buy_sent_without_an_answer_is_found_not_lost(
    bots: Bots, monkeypatch: pytest.MonkeyPatch
) -> None:
    dip(bots, monkeypatch)
    bots.trading.set_limits("50", "500")
    bot_id = bots.create({**SETTINGS, "maxDcaOrders": "0"})["bots"][0]["id"]
    bots.switch(bot_id, on=True, confirmed=True)
    real = bots._binance.buy_limit  # pyright: ignore[reportPrivateUsage]
    monkeypatch.setattr(bots._binance, "buy_limit", lost_reply(real))  # pyright: ignore[reportPrivateUsage]
    bots.step()  # the base order reached Binance; its answer didn't
    assert len(orders("BUY")) == 1
    assert Decimal(bots.trading.settings()["spentToday"]) > 0  # still counted against today
    bots.trading.set_trading(False)
    bots.step()  # the kill switch finds it by its client id and cancels it
    assert all(o["status"] == "CANCELED" for o in orders("BUY"))


def test_a_market_sale_without_an_answer_isnt_sent_again(
    bots: Bots, monkeypatch: pytest.MonkeyPatch
) -> None:
    bots.trading.set_limits("50", "500")
    trade_id = bots.create(TRADE)["bots"][0]["id"]
    bots.switch(trade_id, on=True, confirmed=True)
    bots.step()
    fill(orders("BUY")[0]["orderId"])
    bots.step()
    real = bots._binance.sell_market  # pyright: ignore[reportPrivateUsage]
    monkeypatch.setattr(bots._binance, "sell_market", lost_reply(real))  # pyright: ignore[reportPrivateUsage]
    with pytest.raises(BinanceError):
        bots.close_now(trade_id)
    bots.step()  # the watcher settles the sale it finds, and sends nothing new
    markets = [o for o in orders("SELL") if o["type"] == "MARKET"]
    assert len(markets) == 1
    assert bots.detail(trade_id)["deals"][0]["status"] == "stopped"
