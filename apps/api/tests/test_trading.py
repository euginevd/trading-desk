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
from api.handler import handler
from api.local import allowed
from api.store import Store
from api.trading import Refused, Trading

NOW = 1_794_000_000.0


@pytest.fixture
def desk(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Trading]:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)
    )
    audit = Audit(tmp_path / "audit.jsonl")
    store = Store(tmp_path / "desk.sqlite")
    yield Trading(Binance(client, ("k", "s"), audit), store, audit, clock=lambda: NOW)
    store.close()


def ready(desk: Trading) -> Trading:
    desk.set_limits("100", "500")
    return desk


def order(**fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "clientId": "a1b2c3d4-0000-0000-0000-000000000001",
        "symbol": "BTCUSDT",
        "entry": "market",
        "spend": "100",
        "takeProfit": "101000",
        "stopLoss": "96000",
    }
    return {**base, **fields}


def test_nothing_trades_until_the_limits_are_set(desk: Trading) -> None:
    with pytest.raises(Refused, match="limits first"):
        desk.place(order())


def test_the_kill_switch_refuses_new_orders(desk: Trading) -> None:
    ready(desk).set_trading(False)
    with pytest.raises(Refused, match="Trading is off"):
        desk.place(order())


def test_an_order_over_the_per_order_limit_is_refused(desk: Trading) -> None:
    with pytest.raises(Refused, match="per-order limit of \\$100.00"):
        ready(desk).place(order(spend="100.01"))


def test_the_daily_limit_counts_todays_trades(desk: Trading) -> None:
    desk.set_limits("100", "150")
    desk.place(order())
    with pytest.raises(Refused, match="daily limit of \\$150.00"):
        desk.place(order(clientId="a1b2c3d4-0000-0000-0000-000000000002"))


def test_exits_must_sit_either_side_of_the_entry(desk: Trading) -> None:
    with pytest.raises(Refused, match="Take profit must be above"):
        ready(desk).place(order(takeProfit="90000"))
    with pytest.raises(Refused, match="Stop loss must be below"):
        desk.place(order(stopLoss="99000"))


def test_a_market_smart_trade_fills_and_is_protected(desk: Trading) -> None:
    trade = ready(desk).place(order())
    assert trade["status"] == "protected"
    assert trade["exit_kind"] == "oco"
    assert Decimal(trade["qty"]) == Decimal("0.00101")
    assert desk.settings()["spentToday"] == "100"


def test_the_same_request_twice_places_one_trade(desk: Trading) -> None:
    first = ready(desk).place(order())
    again = desk.place(order())
    assert again["id"] == first["id"]
    placed = [i for i in demo.EXCHANGE.orders if i > len(demo.ORDERS)]  # past the standing ones
    assert len(placed) == 3  # the buy and two exit legs, once


def test_a_limit_buy_waits_and_can_be_cancelled(desk: Trading) -> None:
    trade = ready(desk).place(order(entry="limit", limitPrice="97000"))
    assert trade["status"] == "waiting"
    assert desk.cancel(trade["id"])["status"] == "cancelled"
    assert desk.settings()["spentToday"] == "0"


def test_a_limit_buy_gets_its_exits_once_it_fills(desk: Trading) -> None:
    trade = ready(desk).place(order(entry="limit", limitPrice="97000"))
    filled = demo.EXCHANGE.orders[trade["buy_id"]]
    filled |= {"status": "FILLED", "executedQty": "0.00103", "cummulativeQuoteQty": "99.91"}
    desk.watch()
    assert desk.terminal("BTCUSDT")["trades"][0]["status"] == "protected"


def test_closing_cancels_the_exits_and_sells(desk: Trading) -> None:
    trade = ready(desk).place(order())
    closed = desk.close(trade["id"])
    assert closed["status"] == "closed_market"
    legs = demo.EXCHANGE.lists[int(trade["exit_id"])]
    assert all(demo.EXCHANGE.orders[i]["status"] == "CANCELED" for i in legs)


def test_a_filled_take_profit_closes_the_trade(desk: Trading) -> None:
    trade = ready(desk).place(order())
    take, _ = demo.EXCHANGE.lists[int(trade["exit_id"])]
    demo.EXCHANGE.orders[take] |= {
        "status": "FILLED",
        "executedQty": trade["qty"],
        "cummulativeQuoteQty": "102.01",
    }
    desk.watch()
    view = desk.terminal("BTCUSDT")["trades"][0]
    assert view["status"] == "closed_tp"
    assert Decimal(view["profit"]) > 0


def test_a_take_profit_on_its_own_is_one_limit_sell(desk: Trading) -> None:
    trade = ready(desk).place(order(stopLoss=""))
    assert trade["exit_kind"] == "tp"


def test_the_terminal_lists_pairs_and_limits(desk: Trading) -> None:
    view = ready(desk).terminal("ethusdt")
    assert view["symbol"] == "ETHUSDT"
    assert {"symbol": "BTCUSDT", "pair": "BTC/USDT"} in view["pairs"]
    assert view["settings"]["perOrder"] == "100"


def test_every_order_and_setting_is_in_the_audit_log(desk: Trading, tmp_path: Path) -> None:
    ready(desk).place(order())
    kinds = [
        json.loads(line)["kind"] for line in (tmp_path / "audit.jsonl").read_text().splitlines()
    ]
    assert "settings" in kinds
    assert "order" in kinds


def test_the_routes_reply_in_plain_words(desk: Trading) -> None:
    @contextmanager
    def factory() -> Generator[Trading]:
        yield desk

    def call(method: str, path: str, body: object = None) -> dict[str, object]:
        event: dict[str, object] = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}},
            "body": json.dumps(body) if body is not None else None,
        }
        return handler(event, None, trading=factory)

    assert call("POST", "/trades", order())["statusCode"] == 400
    assert call("PUT", "/limits", {"perOrder": "100", "perDay": "500"})["statusCode"] == 200
    placed = call("POST", "/trades", order())
    assert placed["statusCode"] == 200
    trade_id = json.loads(str(placed["body"]))["id"]
    assert call("POST", f"/trades/{trade_id}/close")["statusCode"] == 200
    assert call("GET", "/settings")["statusCode"] == 200
    assert call("PUT", "/trading", {"on": False})["statusCode"] == 200
    assert call("GET", "/nowhere")["statusCode"] == 404


def test_the_local_api_takes_changes_only_from_the_desk() -> None:
    desk_page = {"host": "127.0.0.1:5173", "origin": "http://127.0.0.1:5173"}
    assert allowed("POST", {**desk_page, "content-type": "application/json"}) is None
    assert allowed("GET", {"host": "127.0.0.1:8000"}) is None
    assert allowed("POST", {**desk_page, "content-type": "text/plain"}) == "Send JSON."
    other = {"host": "127.0.0.1:5173", "origin": "https://evil.example"}
    assert allowed("POST", {**other, "content-type": "application/json"}) == "Unknown origin."
    assert allowed("GET", {"host": "evil.example:8000"}) == "Unknown host."


def ladder(**fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "clientId": "a1b2c3d4-0000-0000-0000-00000000aaaa",
        "symbol": "BTCUSDT",
        "top": "98000",
        "bottom": "90000",
        "count": "5",
        "spend": "200",
        "weighting": "equal",
        "takeProfit": "101000",
        "stopLoss": "85000",
    }
    return {**base, **fields}


def test_a_ladder_places_one_limit_buy_a_rung_with_the_same_exits(desk: Trading) -> None:
    ready(desk)
    done = desk.ladder_order(ladder())
    assert "5 limit buys" in done["message"]
    prices = [t["limit_price"] for t in done["trades"]]
    assert prices == ["98000", "96000", "94000", "92000", "90000"]
    assert all(t["take_profit"] == "101000" and t["stop_loss"] == "85000" for t in done["trades"])
    ids = {o["clientOrderId"] for o in demo.EXCHANGE.orders.values() if o["orderId"] > 100}
    assert len(ids) == 5  # each rung its own id on Binance
    again = desk.ladder_order(ladder())  # a double submit places nothing new
    assert [t["id"] for t in again["trades"]] == [t["id"] for t in done["trades"]]


def test_a_ladder_weighted_lower_buys_more_at_lower_prices(desk: Trading) -> None:
    ready(desk)
    trades = desk.ladder_order(ladder(weighting="lower", count="4", spend="100"))["trades"]
    spends = [Decimal(t["spend"]) for t in trades]
    assert spends == sorted(spends)
    assert spends[-1] > 3 * spends[0]


def test_a_ladder_is_checked_whole_before_anything_is_sent(desk: Trading) -> None:
    ready(desk)  # 100 an order, 500 a day
    with pytest.raises(Refused, match="per-order limit"):
        desk.ladder_order(ladder(count="2", spend="300"))
    with pytest.raises(Refused, match="daily limit"):
        desk.ladder_order(ladder(count="10", spend="600"))
    with pytest.raises(Refused, match="at least"):
        desk.ladder_order(ladder(count="20", spend="50"))
    with pytest.raises(Refused, match="under the top"):
        desk.ladder_order(ladder(bottom="99000"))
    assert [o for o in demo.EXCHANGE.orders.values() if o["orderId"] > 100] == []
    assert Decimal(desk.settings()["spentToday"]) == 0


def test_an_open_order_can_be_changed_in_one_step(desk: Trading) -> None:
    ready(desk)
    standing = demo.EXCHANGE.orders[1]  # the demo's BTC limit buy at 94,000
    done = desk.edit_order(
        {
            "symbol": "BTCUSDT",
            "orderId": "1",
            "price": "93000",
            "amount": "0.001",
            "clientId": "a1b2c3d4-0000-0000-0000-0000000000ed",
        }
    )
    assert done["message"] == "Order changed: buy 0.001 BTC/USDT at 93000."
    assert standing["status"] == "CANCELED"
    new = demo.EXCHANGE.orders[done["orderId"]]
    assert (new["price"], new["origQty"], new["status"]) == ("93000", "0.001", "NEW")


def test_a_change_keeps_to_the_limits_and_leaves_bot_orders_alone(desk: Trading) -> None:
    ready(desk)  # 100 an order
    change = {
        "symbol": "BTCUSDT",
        "orderId": "1",
        "price": "94000",
        "amount": "0.002",
        "clientId": "a1b2c3d4-0000-0000-0000-0000000000ee",
    }
    with pytest.raises(Refused, match="per-order limit"):
        desk.edit_order(change)
    placed = desk.place(order(entry="limit", limitPrice="97000"))
    with pytest.raises(Refused, match="belongs to ST-"):
        desk.edit_order({**change, "orderId": str(placed["buy_id"]), "amount": "0.001"})
    desk.set_trading(False)
    with pytest.raises(Refused, match="Trading is off"):
        desk.edit_order({**change, "amount": "0.001"})


def test_a_double_submitted_sell_sells_once(desk: Trading) -> None:
    ready(desk)
    sale = {
        "clientId": "a1b2c3d4-0000-0000-0000-0000000005e1",
        "symbol": "SOLUSDT",
        "side": "sell",
        "price": "200",
        "amount": "0.3",
    }
    desk.place_order(sale)
    again = desk.place_order(sale)
    assert "already placed" in again["message"]
    sells = [o for o in demo.EXCHANGE.orders.values() if o["side"] == "SELL" and o["orderId"] > 100]
    assert len(sells) == 1


def test_a_buy_sent_without_an_answer_is_kept_not_cancelled(
    desk: Trading, monkeypatch: pytest.MonkeyPatch
) -> None:
    ready(desk)
    real = desk._binance.buy_limit  # pyright: ignore[reportPrivateUsage]

    def lost(*args: Any, **kwargs: Any) -> Any:
        real(*args, **kwargs)
        raise BinanceError(0, "Binance didn't answer.")

    monkeypatch.setattr(desk._binance, "buy_limit", lost)  # pyright: ignore[reportPrivateUsage]
    trade = desk.place(order(entry="limit", limitPrice="97000"))
    assert trade["status"] == "protected" or trade["status"] == "waiting"
    assert trade["buy_id"] is not None
