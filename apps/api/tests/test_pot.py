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
from api.pot import Pot, ref_week, regime_of, trade_result
from api.pot_agent import PotAgent, atr
from api.store import Store
from api.trading import Refused, Trading

NOW = 1_794_000_000.0  # Sat 7 Nov 2026 in Sydney: ISO week 45
SOL = {"coin": "SOL", "entry": "200", "stop": "190", "target": "230", "setup": "Pullback"}


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
def pot(desk: Trading) -> Pot:
    found = Pot(desk)
    found.put_in({"usdc": "100"})
    found._regime = ("neutral", "BTC above its 200-day, 50-day still under it")  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    return found


def fill(order_id: int) -> None:
    order = demo.EXCHANGE.orders[order_id]
    qty = Decimal(order["origQty"])
    order |= {
        "status": "FILLED",
        "executedQty": str(qty),
        "cummulativeQuoteQty": str(qty * Decimal(order["price"])),
    }


def by_tag(tag: str) -> dict[str, Any]:
    return next(o for o in demo.EXCHANGE.orders.values() if o.get("clientOrderId") == tag)


def opened(pot: Pot) -> dict[str, Any]:
    """A SOL trade placed, its entry filled and its exits on Binance."""
    trade = pot.place(SOL)
    fill(by_tag(f"{trade['ref']}-E")["orderId"])
    pot.sync()
    return pot.view()["trades"][0]


def test_the_regime_comes_from_btcs_averages() -> None:
    rising = [Decimal(100 + i) for i in range(210)]
    assert regime_of(rising)[0] == "bull"
    assert regime_of(list(reversed(rising)))[0] == "bear"
    assert regime_of(rising[:40])[0] is None
    assert ref_week(int(NOW * 1000)) == "26W45"


def test_the_test_phase_sizes_ten_dollars_and_checks_the_stop(pot: Pot) -> None:
    sized = pot.size(SOL)
    assert sized["qty"] == "0.05"
    assert sized["spend"] == "10.00"
    assert Decimal(sized["risk"]) < 1  # 5% under the entry: about 52 cents
    assert sized["stopPct"] == "5.0"
    assert Decimal(sized["rr"]) >= 2
    with pytest.raises(Refused, match="15.0% under the entry"):
        pot.size(SOL | {"stop": "170"})
    with pytest.raises(Refused, match="2 : 1"):
        pot.size(SOL | {"target": "210"})
    with pytest.raises(Refused, match="under the entry and the target above"):
        pot.size(SOL | {"stop": "205"})
    with pytest.raises(Refused, match="isn't one trading-agent trades"):
        pot.size(SOL | {"coin": "DOGE"})


def test_sizing_from_the_stop_after_the_test_phase(pot: Pot) -> None:
    pot.set_config({"mode": "risk", "fixed": "10", "riskPct": "1"})
    sized = pot.size(SOL)
    assert Decimal(sized["risk"]) <= Decimal("1.0001")
    assert Decimal(sized["spend"]) <= 25  # 25% of the pot at most
    with pytest.raises(Refused, match="at most 2%"):
        pot.set_config({"mode": "risk", "fixed": "10", "riskPct": "5"})


def test_a_trade_runs_entry_then_one_oco_then_its_target(pot: Pot) -> None:
    trade = pot.place(SOL)
    assert trade["ref"] == "TRD-SOL-26W45-1"
    assert trade["status"] == "waiting"
    entry = by_tag("TRD-SOL-26W45-1-E")
    assert (entry["side"], entry["price"], entry["origQty"]) == ("BUY", "200", "0.05")
    fill(entry["orderId"])
    pot.sync()
    live = pot.view()["trades"][0]
    assert live["status"] == "open"
    assert [o["ref"] for o in live["orders"]] == ["TRD-SOL-26W45-1-E", "TRD-SOL-26W45-1-X1"]
    target, stop = by_tag("TRD-SOL-26W45-1-X1T"), by_tag("TRD-SOL-26W45-1-X1S")
    assert (target["type"], stop["type"]) == ("LIMIT_MAKER", "STOP_LOSS")
    fill(target["orderId"])
    pot.sync()
    done = pot.view()
    closed = done["trades"][0]
    assert (closed["status"], closed["exitKind"]) == ("closed", "target")
    assert closed["result"] == "1.50"  # 0.05 SOL from 200 to 230, no fees in the demo
    assert Decimal(closed["r"]) > 2
    assert done["putIn"] == "100"
    assert done["result"] == "1.50"
    assert done["stats"]["trades"] == 1
    assert done["stats"]["winRate"] == "100"


def test_the_stop_closes_it_for_about_minus_one_r(pot: Pot) -> None:
    trade = opened(pot)
    fill(by_tag(f"{trade['ref']}-X1S")["orderId"])
    pot.sync()
    closed = pot.view()["trades"][0]
    assert closed["exitKind"] == "stop"
    assert Decimal(closed["r"]) < 0
    assert pot.view()["monthResult"] == "-0.50"


def test_a_stop_moves_only_toward_profit(pot: Pot) -> None:
    trade = opened(pot)
    with pytest.raises(Refused, match="toward profit"):
        pot.move_stop({"ref": trade["ref"], "stop": "185"})
    with pytest.raises(Refused, match="sell straight away"):
        pot.move_stop({"ref": trade["ref"], "stop": "215"})  # SOL is 212.40 in the demo
    moved = pot.move_stop({"ref": trade["ref"], "stop": "200"})
    assert moved["stop"] == "200"
    assert by_tag(f"{trade['ref']}-X1S")["status"] == "CANCELED"
    assert by_tag(f"{trade['ref']}-X2S")["status"] == "NEW"


def test_close_at_market_and_cancel_an_entry(pot: Pot) -> None:
    trade = opened(pot)
    closed = pot.close(trade["ref"])
    assert (closed["status"], closed["exitKind"]) == ("closed", "market")
    assert by_tag(f"{trade['ref']}-M1")["status"] == "FILLED"
    waiting = pot.place(SOL | {"coin": "ETH", "entry": "3200", "stop": "3100", "target": "3500"})
    cancelled = pot.cancel(waiting["ref"])
    assert cancelled["status"] == "cancelled"
    with pytest.raises(Refused, match="Only a trade waiting"):
        pot.cancel(trade["ref"])


def test_the_pots_rules_refuse(pot: Pot, desk: Trading) -> None:
    pot.place(SOL)
    with pytest.raises(Refused, match="A SOL trade is on already"):
        pot.place(SOL)
    pot._regime = ("bear", "BTC under")  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    with pytest.raises(Refused, match="Bear"):
        pot.place(SOL | {"coin": "BTC", "entry": "97000", "stop": "93000", "target": "106000"})
    pot._regime = ("neutral", "")  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    desk.set_trading(on=False)
    with pytest.raises(Refused, match="Trading is off"):
        pot.place(SOL | {"coin": "BTC", "entry": "97000", "stop": "93000", "target": "106000"})


def test_an_empty_pot_takes_no_trades(desk: Trading) -> None:
    empty = Pot(desk)
    empty._regime = ("neutral", "")  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    with pytest.raises(Refused, match="Put money in the pot first"):
        empty.place(SOL)
    assert empty.view()["putIn"] == "0"


def test_check_against_binance_finds_every_tag(pot: Pot) -> None:
    opened(pot)
    found = pot.check()
    assert found["matched"] == 3  # the entry and both legs of the OCO
    assert found["missing"] == []
    assert found["unknown"] == []


def test_results_after_fees_and_atr() -> None:
    row = {
        "status": "closed",
        "fill_quote": "10",
        "fees_usd": "0.02",
        "exit_quote": "11",
        "exit_qty": "1",
        "fill_qty": "1",
    }
    assert trade_result(row, None) == Decimal("0.98")
    rows = [[0, "1", "2", "1", "1.5", 0, 0, "1"] for _ in range(20)]
    assert atr(rows) == Decimal(1)


class Fake:
    def __init__(self, reply: dict[str, Any]) -> None:
        self.reply = reply

    def step(self, *_args: object, **_kw: object) -> tuple[dict[str, Any], Decimal, str]:
        return self.reply, Decimal(0), "fake"


def test_a_scan_keeps_only_what_the_rules_allow(pot: Pot) -> None:
    reply = {
        "line": "Neutral: one pullback.",
        "proposals": [
            SOL | {"reason": "Back at its 20-day."},
            SOL
            | {"coin": "ETH", "entry": "3200", "stop": "2700", "target": "4500", "reason": "Wide."},
        ],
    }
    view = PotAgent(pot, Fake(reply)).scan()  # type: ignore[arg-type]
    assert [p["coin"] for p in view["proposals"]] == ["SOL"]
    assert view["proposals"][0]["spend"] == "10.00"
    assert "ETH left out" in view["lastScan"]["line"]
    placed = pot.place(SOL | {"proposal": view["proposals"][0]["id"]})
    assert placed["status"] == "waiting"
    assert pot.view()["proposals"] == []


def test_the_chat_checks_its_actions(pot: Pot) -> None:
    trade = opened(pot)
    reply = {
        "reply": "Raised it.",
        "actions": [
            {
                "type": "stop",
                "ref": trade["ref"],
                "coin": "",
                "setup": "",
                "entry": "",
                "stop": "205",
                "target": "",
                "reason": "Lock in.",
            },
            {
                "type": "stop",
                "ref": trade["ref"],
                "coin": "",
                "setup": "",
                "entry": "",
                "stop": "100",
                "target": "",
                "reason": "Lower.",
            },
            {
                "type": "cancel",
                "ref": trade["ref"],
                "coin": "",
                "setup": "",
                "entry": "",
                "stop": "",
                "target": "",
                "reason": "No.",
            },
        ],
    }
    said = PotAgent(pot, Fake(reply)).chat({"message": "raise my stop", "history": []})  # type: ignore[arg-type]
    assert [a["type"] for a in said["actions"]] == ["stop"]
    assert said["actions"][0]["stop"] == "205"
    assert len(said["said"]) == 2
    with pytest.raises(Refused, match="couldn't be reached"):
        PotAgent(pot, None).scan()


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

    assert call("POST", "/pot/put-in", {"usdc": "100"})["statusCode"] == 200
    shown = call("GET", "/pot")
    assert shown["statusCode"] == 200
    assert json.loads(str(shown["body"]))["putIn"] == "100"
    assert call("POST", "/pot/trades/close", {"ref": "TRD-X"})["statusCode"] == 400
    assert call("GET", "/pot/check")["statusCode"] == 200


def test_an_entry_above_the_price_is_refused(pot: Pot) -> None:
    with pytest.raises(Refused, match="above the price now"):
        pot.size(SOL | {"entry": "220", "target": "260"})  # SOL is 212.40 in the demo


def test_exits_refused_by_binance_are_tried_again(
    pot: Pot, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = pot.binance.sell_oco
    calls: list[str] = []

    def refuse_once(*args: Any) -> dict[str, Any]:
        calls.append(str(args[-1]))
        if len(calls) == 1:
            raise BinanceError(400, "Filter failure: PRICE_FILTER")
        return real(*args)

    monkeypatch.setattr(pot.binance, "sell_oco", refuse_once)
    trade = pot.place(SOL)
    fill(by_tag(f"{trade['ref']}-E")["orderId"])
    pot.sync()  # the fill: its exits refused
    pot.sync()  # tried again
    live = pot.view()["trades"][0]
    assert [o["status"] for o in live["orders"] if o["role"] == "exit"] == ["cancelled", "open"]
    assert live["note"] is None


def test_exits_without_an_answer_are_found_not_placed_twice(
    pot: Pot, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = pot.binance.sell_oco

    def lost_reply(*args: Any) -> dict[str, Any]:
        real(*args)  # Binance took it; the answer never came back
        raise BinanceError(0, "Timed out")

    monkeypatch.setattr(pot.binance, "sell_oco", lost_reply)
    trade = pot.place(SOL)
    fill(by_tag(f"{trade['ref']}-E")["orderId"])
    pot.sync()
    pot.sync()
    exits = [o for o in pot.view()["trades"][0]["orders"] if o["role"] == "exit"]
    assert [(o["ref"], o["status"]) for o in exits] == [(f"{trade['ref']}-X1", "open")]


def test_a_refused_close_puts_the_exits_back(pot: Pot, monkeypatch: pytest.MonkeyPatch) -> None:
    trade = opened(pot)

    def refuse(*_args: Any) -> dict[str, Any]:
        raise BinanceError(400, "Account has insufficient balance")

    monkeypatch.setattr(pot.binance, "sell_market", refuse)
    with pytest.raises(BinanceError):
        pot.close(trade["ref"])
    live = pot.view()["trades"][0]
    assert live["status"] == "open"
    assert by_tag(f"{trade['ref']}-X2S")["status"] == "NEW"


def test_a_trade_by_hand_previews_its_numbers_and_every_rule_it_breaks(pot: Pot) -> None:
    empty = pot.preview({"coin": "SOL"})
    assert empty["now"] == "212.4"
    assert empty["trade"] is None
    assert empty["problems"] == []
    good = pot.preview(SOL)
    assert good["problems"] == []
    shown = good["trade"]
    assert shown["spend"] == "10.00"
    assert shown["stopPct"] == "5.0"
    assert shown["targetPct"] == "15.0"
    assert Decimal(shown["breakeven"]) > 200
    assert Decimal(shown["reward"]) > 2 * Decimal(shown["risk"])
    # Above the price, too wide a stop and under 2 : 1, all named at once, numbers still shown.
    bad = pot.preview(SOL | {"entry": "220", "stop": "180", "target": "230"})
    assert bad["trade"] is not None
    assert len(bad["problems"]) == 3
    assert "above the price now" in bad["problems"][0]
    assert pot.preview(SOL | {"stop": "205"})["problems"] == [
        "The stop goes under the entry and the target above it."
    ]
    with pytest.raises(Refused):
        pot.preview({"coin": "DOGE"})


def test_analyse_fills_a_trade_by_hand_and_drops_levels_it_cant_size(pot: Pot) -> None:
    reply = {
        "verdict": "take",
        "headline": "SOL pulled back to its 20-day in an up trend.",
        "points": ["Above its 50-day.", "Volume fell on the dip.", "Funding is flat."],
        "setup": "Pullback",
        "entry": "200",
        "stop": "190",
        "target": "230",
        "why": "Held 200 twice.",
        "wrongIf": "it closes under 190",
        "watch": "",
    }
    found = PotAgent(pot, Fake(reply)).analyse({"coin": "sol"})  # type: ignore[arg-type]
    assert found["verdict"] == "take"
    assert found["plan"] == {
        "setup": "Pullback",
        "entry": "200",
        "stop": "190",
        "target": "230",
        "why": "Held 200 twice.",
        "wrongIf": "it closes under 190",
    }
    assert len(found["points"]) == 3
    # Levels the desk can't size (the stop above the entry) aren't offered as a trade.
    bad = PotAgent(pot, Fake(reply | {"verdict": "odd", "stop": "210"})).analyse({"coin": "SOL"})  # type: ignore[arg-type]
    assert bad["plan"] is None
    assert bad["verdict"] == "pass"
    with pytest.raises(Refused, match="isn't one"):
        PotAgent(pot, Fake(reply)).analyse({"coin": "DOGE"})  # type: ignore[arg-type]
