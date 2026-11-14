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
from api.binance import Binance
from api.grid import GridConfig, Grids, backtest, config_of, parse_grid, plan, stored
from api.handler import handler
from api.indicators import Candle
from api.store import Store
from api.trading import Refused, Trading

NOW = 1_794_000_000.0
HOUR = 3_600_000

SETTINGS = {
    "symbol": "BTCUSDT",
    "name": "BTC range",
    "lower": "90000",
    "upper": "106000",
    "grids": "8",
    "spacing": "geometric",
    "investment": "400",
    "buyFirst": True,
    "stopBelow": "",
}


def test_lines_and_profit_per_grid() -> None:
    arithmetic = GridConfig(Decimal(100), Decimal(200), 4, "arithmetic")
    assert arithmetic.lines() == [Decimal(v) for v in (100, 125, 150, 175, 200)]
    low, high = arithmetic.profit_per_grid()
    assert round(low, 2) == Decimal("14.07")  # 175 to 200, after fees
    assert round(high, 2) == Decimal("24.78")  # 100 to 125
    geometric = GridConfig(Decimal(100), Decimal(400), 2, "geometric")
    assert [round(x, 6) for x in geometric.lines()] == [Decimal(100), Decimal(200), Decimal(400)]
    assert geometric.profit_per_grid()[0] == geometric.profit_per_grid()[1]


def test_settings_are_checked_and_kept() -> None:
    config = parse_grid(SETTINGS)
    assert config_of({"config": stored(config)}) == config
    assert config.per_order() == Decimal(50)
    with pytest.raises(Refused, match="above the lower"):
        parse_grid({**SETTINGS, "upper": "90000"})
    with pytest.raises(Refused, match="under the lower"):
        parse_grid({**SETTINGS, "stopBelow": "95000"})
    with pytest.raises(Refused, match="fees"):
        parse_grid({**SETTINGS, "upper": "90500", "grids": "10"})
    suggested = parse_grid({**SETTINGS, "lower": ""}, (Decimal(1), Decimal(2)))
    assert (suggested.lower, suggested.upper) == (Decimal(1), Decimal(2))


def test_the_opening_buys_below_and_buys_first_for_the_sells_above() -> None:
    config = GridConfig(Decimal(100), Decimal(200), 4, "arithmetic", Decimal(400))
    opening = plan(config, Decimal(140))  # lines 100 125 150 175 200; 150 is nearest: empty
    below = [p for p in opening if p.line != p.target]
    first = [p for p in opening if p.line == p.target]
    assert [(p.line, p.target, p.price) for p in below] == [
        (0, 1, Decimal(100)),
        (1, 2, Decimal(125)),
    ]
    assert [(p.line, p.price) for p in first] == [(3, Decimal(140)), (4, Decimal(140))]
    assert all(p.side == "buy" for p in opening)
    without = plan(
        GridConfig(Decimal(100), Decimal(200), 4, "arithmetic", buy_first=False), Decimal(140)
    )
    assert len(without) == 2


def candle(n: int, low: str, high: str, close: str) -> Candle:
    return Candle(n * HOUR, Decimal(close), Decimal(high), Decimal(low), Decimal(close), ONE)


ONE = Decimal(1)


def test_backtest_counts_round_trips_in_a_swinging_market() -> None:
    config = GridConfig(Decimal(100), Decimal(200), 4, "arithmetic", Decimal(400))
    swings = [candle(0, "150", "150", "150")]
    for n in range(1, 9):  # down to 120, up to 180, four times
        swings.append(candle(n, "120", "150", "125") if n % 2 else candle(n, "125", "180", "175"))
    result = backtest(config, swings)
    assert result["trips"] >= 4
    assert Decimal(result["gridProfit"]) > 0
    assert result["inRange"] == "100"


@pytest.fixture
def grids(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Grids]:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)
    )
    audit = Audit(tmp_path / "audit.jsonl")
    store = Store(tmp_path / "desk.sqlite")
    yield Grids(Binance(client, ("k", "s"), audit), store, audit, clock=lambda: NOW)
    store.close()


def fill(order_id: int) -> None:
    order = demo.EXCHANGE.orders[order_id]
    qty = Decimal(order["origQty"])
    order |= {
        "status": "FILLED",
        "executedQty": str(qty),
        "cummulativeQuoteQty": str(qty * Decimal(order["price"])),
    }


def mine(side: str, status: str = "NEW") -> list[dict[str, Any]]:
    return [
        o
        for o in demo.EXCHANGE.orders.values()
        if o["side"] == side and o["orderId"] > 100 and o["status"] == status
    ]


def test_a_grid_starts_off_and_needs_a_confirm(grids: Grids) -> None:
    grid = grids.create(SETTINGS)["grids"][0]
    assert grid["status"] == "off"
    assert grid["config"]["perOrder"] == "50"
    grids.step()
    assert mine("BUY") == []
    with pytest.raises(Refused, match="Confirm"):
        grids.switch(grid["id"], on=True, confirmed=False)
    with pytest.raises(Refused, match="limits first"):
        grids.switch(grid["id"], on=True, confirmed=True)
    grids.trading.set_limits("40", "1000")
    with pytest.raises(Refused, match="per-order limit"):
        grids.switch(grid["id"], on=True, confirmed=True)


def test_a_grid_trades_both_ways(grids: Grids) -> None:
    grids.trading.set_limits("60", "1000")
    grid_id = grids.create(SETTINGS)["grids"][0]["id"]
    view = grids.switch(grid_id, on=True, confirmed=True)["grids"][0]
    assert view["status"] == "running"
    buys = mine("BUY")
    assert len(buys) == 8  # 9 lines, the one nearest 98,420 left empty
    assert all(o["type"] == "LIMIT" for o in buys)
    first = [o for o in buys if o["price"] == "98420"]
    assert len(first) == 4  # buy first: one for each line above the price

    fill(first[0]["orderId"])  # a buy-first fills: its sell goes on its line
    grids.step()
    sells = mine("SELL")
    assert len(sells) == 1
    assert Decimal(sells[0]["price"]) > Decimal(98420)

    below = max((o for o in buys if o["price"] != "98420"), key=lambda o: Decimal(o["price"]))
    fill(below["orderId"])  # the highest buy below fills: a sell one line up
    grids.step()
    assert len(mine("SELL")) == 2

    fill(sells[0]["orderId"])  # a sell fills: a buy one line down, and the profit kept
    grids.step()
    view = grids.view()["grids"][0]
    assert view["trips"] == 1
    assert Decimal(view["gridProfit"]) > 0
    assert view["openBuys"] == 7

    grids.trading.set_trading(False)
    grids.step()  # the kill switch: buys cancelled, sells left to take risk away
    view = grids.view()["grids"][0]
    assert not view["enabled"]
    assert mine("BUY") == []
    assert len(mine("SELL")) == 1
    assert view["status"] == "finishing"
    grids.switch(grid_id, on=False, confirmed=False)  # off: the sells go too
    assert mine("SELL") == []
    assert grids.view()["grids"][0]["status"] == "off"


def test_stop_below_cancels_and_keeps_the_coins(
    grids: Grids, monkeypatch: pytest.MonkeyPatch
) -> None:
    grids.trading.set_limits("60", "1000")
    grid_id = grids.create({**SETTINGS, "stopBelow": "85000"})["grids"][0]["id"]
    grids.switch(grid_id, on=True, confirmed=True)

    def crashed(_symbol: str) -> Decimal:
        return Decimal(80000)

    monkeypatch.setattr(grids, "_price", crashed)
    grids.step()
    view = grids.view()["grids"][0]
    assert not view["enabled"]
    assert "fell under 85000" in view["note"]
    assert mine("BUY") == []


def test_the_routes(grids: Grids) -> None:
    @contextmanager
    def factory() -> Generator[Grids]:
        yield grids

    @contextmanager
    def trading() -> Generator[Trading]:
        yield grids.trading

    def call(method: str, path: str, body: object = None) -> tuple[int, Any]:
        event: dict[str, object] = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}},
            "body": json.dumps(body) if body is not None else None,
        }
        reply = handler(event, None, trading=trading, grids=factory)
        return int(str(reply["statusCode"])), json.loads(str(reply["body"]))

    status, preview = call("POST", "/grids/preview", {**SETTINGS, "lower": "", "upper": ""})
    assert status == 200
    assert preview["config"]["lower"] == preview["suggested"]["lower"]
    assert preview["backtest"]["candles"] > 0
    assert len(preview["lines"]) == 9
    status, made = call("POST", "/grids", SETTINGS)
    grid_id = made["grids"][0]["id"]
    status, error = call("POST", f"/grids/{grid_id}/switch", {"on": True})
    assert status == 400
    assert "Confirm" in error["error"]
    grids.trading.set_limits("60", "1000")
    assert call("POST", f"/grids/{grid_id}/switch", {"on": True, "confirmed": True})[0] == 200
    status, error = call("DELETE", f"/grids/{grid_id}")
    assert "Switch the grid off" in error["error"]
    assert call("POST", f"/grids/{grid_id}/switch", {"on": False})[0] == 200
    assert call("DELETE", f"/grids/{grid_id}")[1]["grids"] == []


def test_a_grid_preset_comes_from_the_last_30_days_with_a_reason_each(grids: Grids) -> None:
    grids.trading.set_limits("30", "1000")
    found = grids.suggest({"symbol": "BTCUSDT"})
    config = found["config"]
    assert Decimal(config["lower"]) < Decimal(98420) < Decimal(config["upper"])
    assert Decimal(config["perOrder"]) <= 30
    assert Decimal(config["stopBelow"]) < Decimal(config["lower"])
    assert all(found["reasons"][k] for k in ("lower", "grids", "investment", "stopBelow"))
    assert parse_grid({**config, "symbol": "BTCUSDT"}).grids == config["grids"]


def test_a_grids_details_list_its_orders_by_reference(grids: Grids) -> None:
    grids.trading.set_limits("60", "1000")
    grid_id = grids.create(SETTINGS)["grids"][0]["id"]
    grids.switch(grid_id, on=True, confirmed=True)
    detail = grids.detail(grid_id)
    assert detail["grid"]["ref"] == f"GRID-{grid_id}"
    assert detail["grid"]["name"] == "BTC/USDT"
    assert len(detail["orders"]) == 8
    assert all(o["ref"].startswith(f"GRID-{grid_id}-") for o in detail["orders"])


def test_a_paused_grid_with_a_sell_out_refuses_to_open_twice(grids: Grids) -> None:
    grids.trading.set_limits("60", "1000")
    grid_id = grids.create(SETTINGS)["grids"][0]["id"]
    grids.switch(grid_id, on=True, confirmed=True)
    buy_first = [o for o in mine("BUY") if o["price"] == "98420"]
    fill(buy_first[0]["orderId"])
    grids.step()  # a sell goes on its line
    assert len(mine("SELL")) == 1
    grids.trading.set_trading(False)
    grids.step()  # the kill switch: buys cancelled, the sell kept, the grid off
    grids.trading.set_trading(True)
    with pytest.raises(Refused, match="1 orders from before"):
        grids.switch(grid_id, on=True, confirmed=True)
    assert len(mine("BUY")) == 0  # no second opening
    grids.switch(grid_id, on=False, confirmed=False)  # stop: the sell cancelled
    grids.switch(grid_id, on=True, confirmed=True)  # now it can start again
    assert len(mine("BUY")) == 8
