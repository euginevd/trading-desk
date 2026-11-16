from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
from api import demo
from api.audit import Audit
from api.binance import Binance
from api.dca_book import DcaBook
from api.dca_funds import Funds, chance, depth, heat, moves, off_round
from api.store import Store
from api.trading import Refused, Trading

NOW = 1_794_000_000.0
PLAN = {
    "start": "2026-11-06",
    "weeks": 156,
    "orders": [
        {"coin": "BTC", "spend": "300", "odds": 60},
        {"coin": "ETH", "spend": "150", "odds": 60},
        {"coin": "SOL", "spend": "150", "odds": 60},
    ],
}


@pytest.fixture
def book(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> DcaBook:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)
    )
    audit = Audit(tmp_path / "audit.jsonl")
    store = Store(tmp_path / "desk.sqlite")
    desk = Trading(Binance(client, ("k", "s"), audit), store, audit, clock=lambda: NOW)
    desk.set_limits("1000", "5000")
    found = DcaBook(desk)
    found.set_plan(PLAN)
    return found


def candle(open_: str, high: str, low: str, close: str = "100") -> list[Any]:
    return [0, open_, high, low, close]


def test_moves_look_24_hours_ahead() -> None:
    rows = [candle("100", "101", "99")] * 5 + [candle("100", "110", "90")]
    downs, ups = moves(rows)
    assert downs == [Decimal("0.1")]
    assert ups == [Decimal("0.1")]
    found = [Decimal("0.01"), Decimal("0.02"), Decimal("0.03"), Decimal("0.04"), Decimal("0.05")]
    assert depth(found, 80) == Decimal("0.02")
    assert chance(found, Decimal("0.02")) == {"hit": 4, "windows": 5, "pct": 80}


def test_prices_stay_off_round_numbers() -> None:
    tick = Decimal("0.01")
    assert off_round(Decimal("63800"), tick, "buy") == Decimal("63837")
    assert off_round(Decimal("66299.5"), tick, "sell") == Decimal("66263")
    assert off_round(Decimal("66250"), tick, "sell") == Decimal("66250")


def test_heat_counts_the_overheating_signs() -> None:
    calm = [[0, "100", "101", "99", "100"]] * 60
    assert heat(calm, Decimal(100))["overheatedSigns"] == 0
    rising = [[0, str(p), str(p + 1), str(p - 1), str(p)] for p in range(100, 160)]
    hot = heat(rising, Decimal(200))
    assert hot["overheatedSigns"] >= 2  # far above its average and up a lot in 14 days


def test_adding_splits_by_the_plan_without_the_agent(book: DcaBook) -> None:
    plan = Funds(book, None).analyse("add", "100")
    assert plan["by"] == "desk"
    assert [o["coin"] for o in plan["orders"]] == ["BTC", "ETH", "SOL"]
    assert [o["usdc"] for o in plan["orders"]] == ["50", "25", "25"]
    assert sum(Decimal(o["usdc"]) for o in plan["orders"]) == Decimal(100)
    assert plan["skipped"] == []
    small = Funds(book, None).analyse("add", "30")  # 7.50 each for ETH and SOL: under 10
    assert [o["coin"] for o in small["orders"]] == ["BTC"]
    assert [(s["coin"], s["reason"]) for s in small["skipped"]][0][0] == "ETH"
    assert all(Decimal(s["price"]) > 0 for s in small["skipped"])
    for o in plan["orders"]:
        assert Decimal(o["price"]) <= Decimal(o["now"])


def test_the_desk_checks_any_plan(book: DcaBook) -> None:
    funds = Funds(book, None)
    facts = funds.facts("buy")
    rows, said = funds.settle(
        facts,
        Decimal(40),
        [
            {"coin": "BTC", "usdc": "35", "price": "999999", "reason": "x"},
            {"coin": "ETH", "usdc": "5", "price": "3000", "reason": "y"},
            {"coin": "DOGE", "usdc": "10", "price": "1", "reason": "z"},
        ],
    )
    assert [r["coin"] for r in rows] == ["BTC"]
    assert rows[0]["usdc"] == "40"  # ETH's 5 went to BTC
    assert Decimal(rows[0]["price"]) <= Decimal(rows[0]["now"])  # a buy never above market
    assert said == ["ETH left out: under 10 USDT."]
    with pytest.raises(Refused, match="too little"):
        funds.settle(facts, Decimal(40), [{"coin": "BTC", "usdc": "5", "price": "1"}])


def test_removing_needs_something_held(book: DcaBook) -> None:
    with pytest.raises(Refused, match="nothing to sell"):
        Funds(book, None).analyse("remove", "50")
    book.place({"coin": "SOL", "spend": "500", "kind": "market"})
    plan = Funds(book, None).analyse("remove", "50")
    assert [o["coin"] for o in plan["orders"]] == ["SOL"]
    assert Decimal(plan["orders"][0]["price"]) >= Decimal(plan["orders"][0]["now"])
    assert Decimal(plan["orders"][0]["usdc"]) <= Decimal(500) / 4 + 1


def test_amounts_and_chat_are_checked(book: DcaBook) -> None:
    funds = Funds(book, None)
    with pytest.raises(Refused, match="smallest order"):
        funds.analyse("add", "5")
    with pytest.raises(Refused, match="Add funds or remove"):
        funds.analyse("withdraw", "50")
    with pytest.raises(Refused, match="couldn't be reached"):
        funds.chat({"side": "add", "amount": "50", "message": "more BTC", "orders": []})
    assert funds.odds("BTC", "90000", "add")["windows"] > 0


def test_the_books_chat_checks_everycheck_action(book: DcaBook) -> None:
    funds = Funds(book, None)
    with pytest.raises(Refused, match="couldn't be reached"):
        funds.agent({"message": "add 50"})
    placed = book.place({"coin": "BTC", "spend": "40", "price": "97000"})
    opened = {placed["ref"]: funds.open_orders()[0]}
    facts = {"buy": funds.facts("buy")}
    keep = funds.check_action(
        {"type": "buy", "coin": "ETH", "ref": "", "usdc": "20", "price": "3000", "reason": "x"},
        facts,
        opened,
    )
    assert keep is not None
    assert (keep["type"], keep["coin"], keep["usdc"]) == ("buy", "ETH", "20")
    small = {"type": "buy", "coin": "ETH", "ref": "", "usdc": "5", "price": "3000", "reason": ""}
    assert funds.check_action(small, facts, opened) is None  # under 10
    cancel = {
        "type": "cancel",
        "coin": "",
        "ref": placed["ref"],
        "usdc": "",
        "price": "",
        "reason": "y",
    }
    gone = funds.check_action(cancel, facts, opened)
    assert gone is not None
    assert gone["type"] == "cancel"
    ghost = cancel | {"ref": "DCA-BTC-26W45-9"}
    assert funds.check_action(ghost, facts, opened) is None  # not open
