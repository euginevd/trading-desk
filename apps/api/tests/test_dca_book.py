import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
from api import demo
from api.audit import Audit
from api.binance import Binance
from api.dca_book import (
    SYDNEY,
    DcaBook,
    close_out_of,
    dips,
    odds,
    positions,
    target_price,
    unround,
    week_of,
)
from api.handler import handler
from api.store import Store
from api.trading import Refused, Trading

NOW = 1_794_000_000.0  # Sat 7 Nov 2026, 8:20am in Sydney: in the week of Fri 6 Nov
PLAN = {
    "start": "2026-11-06",
    "weeks": 156,
    "orders": [
        {"coin": "BTC", "spend": "40", "odds": 70},
        {"coin": "ETH", "spend": "20", "odds": 60},
        {"coin": "SOL", "spend": "20", "odds": 60},
    ],
}


@pytest.fixture
def desk(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Trading]:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)
    )
    audit = Audit(tmp_path / "audit.jsonl")
    store = Store(tmp_path / "desk.sqlite")
    trading = Trading(Binance(client, ("k", "s"), audit), store, audit, clock=lambda: NOW)
    trading.set_limits("100", "500")
    yield trading
    store.close()


@pytest.fixture
def book(desk: Trading) -> DcaBook:
    found = DcaBook(desk)
    found.set_plan(PLAN)
    return found


def fill(order_id: int) -> None:
    order = demo.EXCHANGE.orders[order_id]
    qty = Decimal(order["origQty"])
    order |= {
        "status": "FILLED",
        "executedQty": str(qty),
        "cummulativeQuoteQty": str(qty * Decimal(order["price"])),
    }


def ms(*parts: int) -> int:
    return int(datetime(*parts, tzinfo=SYDNEY).timestamp() * 1000)  # type: ignore[misc]


def test_the_week_turns_over_at_mondays_close_out() -> None:
    assert week_of(ms(2026, 11, 16, 18, 59))[0] == "26W46"  # Monday, before the close-out
    assert week_of(ms(2026, 11, 16, 19, 0))[0] == "26W47"  # after it: the coming Friday's
    key, friday = week_of(ms(2026, 11, 20, 19, 0))
    assert key == "26W47"
    assert friday == datetime(2026, 11, 20, 19, 0, tzinfo=SYDNEY)
    assert week_of(ms(2026, 11, 23, 18, 59))[0] == "26W47"
    assert week_of(ms(2026, 11, 23, 19, 0))[0] == "26W48"
    assert close_out_of(friday) == datetime(2026, 11, 23, 19, 0, tzinfo=SYDNEY)


def test_fill_odds_count_the_weeks_that_dipped_that_far() -> None:
    def candle(at: datetime, open_: str, low: str) -> list[Any]:
        return [int(at.timestamp() * 1000), open_, open_, low, open_]

    rows: list[list[Any]] = []
    for week, low in enumerate(["98", "95", "90"]):
        friday = datetime(2026, 10, 2 + 7 * week, 8, tzinfo=UTC)
        rows += [candle(friday, "100", low)]
        rows += [candle(friday.replace(hour=12 + h * 4 % 12), "100", "100") for h in range(17)]
    found = dips(rows)
    assert found == [Decimal("0.02"), Decimal("0.05"), Decimal("0.1")]
    assert odds(found, Decimal(100), Decimal(95)) == {"hit": 2, "weeks": 3, "pct": 67, "few": True}
    assert target_price(found, Decimal(100), 67) == Decimal(95)


def test_a_limit_sits_just_above_a_round_number() -> None:
    tick = Decimal("0.01")
    assert unround(Decimal("63800"), tick) == Decimal("63837")
    assert unround(Decimal("1770"), tick) == Decimal("1773.70")
    assert unround(Decimal("69.2"), tick) == Decimal("69.23")
    assert unround(Decimal("63851.42"), tick) == Decimal("63851.42")  # already off-round


def row(side: str, qty: str, quote: str, source: str = "weekly") -> dict[str, Any]:
    return {
        "coin": "SOL",
        "side": side,
        "source": source,
        "executed_qty": qty,
        "executed_quote": quote,
        "fee_base": "0",
        "fee_quote": "0",
        "fee_usd": "0",
        "updated": 1,
    }


def test_a_trim_keeps_the_average_and_its_buy_back_lowers_it() -> None:
    rows = [row("buy", "1", "80"), row("sell", "0.5", "45", "trim"), row("buy", "0.5", "35")]
    sol = positions(rows, ["SOL"])["SOL"]
    assert sol.qty == Decimal(1)
    assert sol.cost / sol.qty == Decimal(75)
    assert sol.realised == Decimal(5)
    assert sol.added == Decimal(70)  # 80 in, 45 out, 35 back in
    view = sol.view(Decimal(90), Decimal("1.5"))
    assert view["pnl"] == "20"
    assert view["id"] == "DCA-SOL"


def test_orders_fill_into_the_positions(book: DcaBook) -> None:
    placed = book.place({"coin": "BTC", "spend": "40", "price": "97000.004", "source": "weekly"})
    assert placed["ref"] == "DCA-BTC-26W45-1"
    tagged = [o for o in demo.EXCHANGE.orders.values() if o.get("clientOrderId")]
    assert tagged[-1]["clientOrderId"] == "DCA-BTC-26W45-1"  # findable on Binance by its ref
    assert placed["status"] == "open"
    assert placed["price"] == "97000"
    second = book.place({"coin": "BTC", "spend": "20", "kind": "market", "source": "named"})
    assert second["ref"] == "DCA-BTC-26W45-2"
    assert second["status"] == "filled"
    order_id = max(demo.EXCHANGE.orders)
    fill(order_id - 1)
    book.sync()
    view = book.view()
    btc = next(p for p in view["positions"] if p["coin"] == "BTC")
    assert Decimal(btc["qty"]) > 0
    assert btc["since"] is not None
    assert view["week"]["key"] == "26W45"
    assert [o["status"] for o in view["week"]["orders"]] == ["filled", "filled"]
    assert view["progress"]["ticks"][-1]["state"] == "now"


def test_the_book_refuses_what_the_plan_or_limits_dont_allow(book: DcaBook, desk: Trading) -> None:
    with pytest.raises(Refused, match="isn't in your DCA plan"):
        book.place({"coin": "DOGE", "spend": "20", "price": "1"})
    with pytest.raises(Refused, match="per-order limit"):
        book.place({"coin": "BTC", "spend": "150", "price": "97000"})
    with pytest.raises(Refused, match="holds less"):
        book.place({"coin": "SOL", "side": "sell", "qty": "1", "price": "300", "source": "trim"})
    with pytest.raises(Refused, match="Only a trim sells"):
        book.place({"coin": "SOL", "side": "sell", "qty": "1", "price": "300"})
    with pytest.raises(Refused, match="needs the trim"):
        book.place({"coin": "SOL", "spend": "20", "price": "200", "source": "buy-back"})
    desk.set_trading(False)
    with pytest.raises(Refused, match="Trading is off"):
        book.place({"coin": "BTC", "spend": "20", "price": "97000"})


def test_a_trim_and_its_buy_back(book: DcaBook) -> None:
    book.place({"coin": "SOL", "spend": "40", "kind": "market"})
    held = Decimal(book.view()["positions"][2]["qty"])
    trim = book.place(
        {"coin": "SOL", "side": "sell", "kind": "market", "qty": str(held / 4), "source": "trim"}
    )
    assert trim["status"] == "filled"
    back = book.place(
        {"coin": "SOL", "spend": "10", "price": "200", "source": "buy-back", "link": trim["ref"]}
    )
    assert back["link"] == trim["ref"]


def test_close_out_buys_what_the_limits_didnt(book: DcaBook) -> None:
    book.place({"coin": "ETH", "spend": "20", "price": "3000", "source": "weekly"})
    closed = book.close_out()
    assert closed["closed"] == ["ETH 19.98"]  # what the limit would have spent, to the step
    orders = book.view()["week"]["orders"]
    assert [(o["source"], o["status"]) for o in orders] == [
        ("weekly", "cancelled"),
        ("close-out", "filled"),
    ]
    assert orders[1]["link"] == orders[0]["ref"]


def test_suggestions_and_odds_come_from_the_desk(book: DcaBook) -> None:
    found = book.suggest()
    assert [o["coin"] for o in found["orders"]] == ["BTC", "ETH", "SOL"]
    for o in found["orders"]:
        assert Decimal(o["price"]) <= Decimal(o["now"])
        assert o["odds"]["few"] is True  # the demo has no Friday-evening candles
    assert book.odds("BTC", "90000")["now"] == "98420"
    with pytest.raises(Refused):
        book.odds("DOGE", "1")


def test_the_plan_is_checked(desk: Trading) -> None:
    book = DcaBook(desk)
    assert book.view()["plan"] is None
    with pytest.raises(Refused, match="Set your weekly plan"):
        book.suggest()
    with pytest.raises(Refused, match="odds"):
        book.set_plan({**PLAN, "orders": [{"coin": "BTC", "spend": "40", "odds": 99}]})
    with pytest.raises(Refused, match="Weeks"):
        book.set_plan({**PLAN, "weeks": 0})


def test_the_routes(desk: Trading) -> None:
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

    assert call("PUT", "/dca/plan", PLAN)["statusCode"] == 200
    placed = call("POST", "/dca/orders", {"coin": "BTC", "spend": "40", "price": "97000"})
    assert placed["statusCode"] == 200, placed["body"]
    ref = json.loads(str(placed["body"]))["ref"]
    assert call("POST", "/dca/orders/cancel", {"ref": ref})["statusCode"] == 200
    assert call("POST", "/dca/orders/cancel", {"ref": ref})["statusCode"] == 400
    assert call("GET", "/dca")["statusCode"] == 200


def test_check_against_binance_finds_and_fixes_differences(book: DcaBook) -> None:
    placed = book.place({"coin": "BTC", "spend": "40", "price": "97000", "source": "weekly"})
    assert book.check()["matched"] == 1
    fill(max(demo.EXCHANGE.orders))  # filled on Binance; the book hasn't heard yet
    found = book.check()
    assert found["differ"] == [
        {
            "ref": placed["ref"],
            "coin": "BTC",
            "book": {"status": "open", "filledQty": "0"},
            "binance": {"status": "filled", "filledQty": placed["qty"]},
        }
    ]
    # An order on Binance the book lost, found by its tag and added back.
    demo.EXCHANGE.orders[999] = {
        "symbol": "ETHUSDT",
        "orderId": 999,
        "clientOrderId": "DCA-ETH-26W45-7",
        "side": "BUY",
        "type": "LIMIT",
        "status": "FILLED",
        "price": "3000",
        "origQty": "0.01",
        "executedQty": "0.01",
        "cummulativeQuoteQty": "30",
        "time": 1,
    }
    assert [o["ref"] for o in book.check()["onlyBinance"]] == ["DCA-ETH-26W45-7"]
    fixed = book.repair()
    assert (fixed["fixed"], fixed["added"]) == (1, 1)
    assert fixed["differ"] == []
    assert fixed["onlyBinance"] == []
    assert fixed["matched"] == 2
    eth = next(p for p in book.view()["positions"] if p["coin"] == "ETH")
    assert eth["qty"] == "0.01"


def test_a_small_buy_rounds_up_to_stay_at_the_minimum(book: DcaBook) -> None:
    # 10 at 3,333.33 is 0.003000003 ETH: down to the step it would be 9.99999, under 10.
    placed = book.place({"coin": "ETH", "spend": "10", "price": "3333.33"})
    assert Decimal(placed["spend"]) >= 10


def test_an_open_order_is_changed_and_linked(book: DcaBook) -> None:
    first = book.place({"coin": "BTC", "spend": "40", "price": "97000", "source": "weekly"})
    changed = book.amend({"ref": first["ref"], "price": "95000.5"})
    assert changed["link"] == first["ref"]
    assert changed["source"] == "weekly"
    assert changed["price"] == "95000.5"
    assert changed["status"] == "open"
    old = next(o for o in book.view()["orders"] if o["ref"] == first["ref"])
    assert old["status"] == "cancelled"
    with pytest.raises(Refused, match="Only an open limit"):
        book.amend({"ref": first["ref"], "price": "94000"})


def test_a_refused_change_leaves_the_old_order_working(book: DcaBook, desk: Trading) -> None:
    first = book.place({"coin": "BTC", "spend": "40", "price": "97000", "source": "weekly"})
    desk.set_trading(False)
    with pytest.raises(Refused, match="Trading is off"):
        book.amend({"ref": first["ref"], "price": "95000"})
    with pytest.raises(Refused, match="Trading is off"):
        book.close_out()
    old = next(o for o in book.view()["orders"] if o["ref"] == first["ref"])
    assert old["status"] == "open"


def test_a_change_spends_no_more_than_is_left_unless_raised(book: DcaBook) -> None:
    first = book.place({"coin": "BTC", "spend": "40", "price": "97000", "source": "weekly"})
    capped = book.amend({"ref": first["ref"], "price": "95000", "spend": "80"})
    assert Decimal(capped["spend"]) <= Decimal(40)
    raised = book.amend({"ref": capped["ref"], "price": "95000", "spend": "60", "raise": True})
    assert Decimal(raised["spend"]) > Decimal(40)
    # Over the per-order limit of 100: refused before anything is cancelled.
    with pytest.raises(Refused, match="per-order"):
        book.amend({"ref": raised["ref"], "price": "95000", "spend": "150", "raise": True})
    assert next(o for o in book.view()["orders"] if o["ref"] == raised["ref"])["status"] == "open"
