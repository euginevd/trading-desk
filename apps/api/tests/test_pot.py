import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
from api import demo, screener
from api.audit import Audit
from api.binance import Binance, BinanceError
from api.handler import handler
from api.market import QUOTE
from api.pot import ZERO, Pot, ref_week, regime_of, trade_result
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


def test_the_daily_scan_proposes_only_swing_takes_the_desk_can_place(
    pot: Pot, monkeypatch: pytest.MonkeyPatch
) -> None:
    shortlist: list[dict[str, Any]] = [
        {"coin": c, "setup": "Trend pullback", "facts": {}, "crowding": "Clear"}
        | {"entry": "200", "stop": "190", "target": "230"}
        for c in ("SOL", "ETH")
    ]
    seen: dict[str, Any] = {
        "style": "swing",
        "name": "Swing",
        "regime": {"state": "neutral", "words": ""},
        "warnings": [],
        "counts": {"listed": 3, "onBinance": 3, "liquid": 3, "setups": 2},
        "allowed": True,
        "note": "",
        "riskPct": "1",
        "shortlist": shortlist,
    }

    def last(*_a: object) -> dict[str, Any]:
        return seen

    monkeypatch.setattr(screener, "last_screen", last)
    pick = {
        "coin": "SOL",
        "setup": "Trend pullback",
        "grade": "B",
        "score": 7,
        "verdict": "take",
        "entry": "200",
        "stop": "190",
        "target": "230",
        "confluence": ["Back at its 20-day"],
        "against": [],
        "catalyst": "None in two weeks",
        "crowding": "Clear",
        "reason": "Back at its 20-day in an uptrend; wrong under 190.",
    }
    reply = {"line": "One pullback.", "picks": [pick, pick | {"coin": "ETH", "verdict": "wait"}]}
    view = PotAgent(pot, Fake(reply)).scan()  # type: ignore[arg-type]
    assert [p["coin"] for p in view["proposals"]] == ["SOL"]  # a wait is not proposed
    proposal = view["proposals"][0]
    assert proposal["style"] == "swing"
    assert "facts" not in proposal
    assert view["lastScan"]["line"].startswith("Swing: One pullback.")
    placed = pot.place(SOL | {"proposal": proposal["id"], "style": "swing"})
    assert placed["setup"] == "Swing - Pullback"
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
        PotAgent(pot, None).chat({"message": "hello", "history": []})


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


def test_a_dollar_cap_keeps_each_trade_under_it(pot: Pot) -> None:
    """The owner's rule of 18 Nov 2026: 1% risk, at most 10 USDC a trade."""
    pot.put_in({"usdc": "1000"})  # 1,100 in: 1% would be 11
    pot.set_config({"mode": "risk", "fixed": "10", "riskPct": "1", "maxRisk": "10"})
    assert pot.allowed(pot.equity()) == Decimal(10)
    sized = pot.size(SOL)
    assert Decimal(sized["risk"]) <= Decimal("10.001")
    assert pot.view()["allowedRisk"] == "10.00"
    assert pot.config()["maxRisk"] == "10"
    pot.set_config({"mode": "risk", "fixed": "10", "riskPct": "1"})
    assert pot.allowed(pot.equity()) == Decimal(11)  # no cap: the percentage alone


def test_other_buys_leave_the_pots_usdc_alone(pot: Pot, desk: Trading) -> None:
    """The soft ring-fence: one Binance wallet, so the DCA book and hand orders may spend only
    the free USDC less the pot's cash."""
    free = next(
        (Decimal(b["free"]) for b in desk.parts()[0].balances() if b["asset"] == QUOTE), ZERO
    )
    room = max(free - pot.cash(), ZERO)
    assert pot.guard(room) is None  # up to the account's line: fine
    said = pot.guard(room + 1, "the DCA book")  # warns, never blocks
    assert said is not None
    assert said.startswith(f"The DCA book uses 1.00 of the trading account's {QUOTE}")
    backing = pot.view()["backing"]
    assert backing["held"] == "100.00"
    assert backing["short"] == str(max(Decimal(100) - free, ZERO).quantize(Decimal("0.01")))
    # A waiting pot entry is locked on Binance already: only the pot's free cash is kept back.
    pot.place(SOL)
    assert pot.cash() == Decimal(90)


def test_the_coin_snapshot_leaves_out_money_bnb_and_dust(pot: Pot) -> None:
    from api import account_coins  # noqa: PLC0415

    found = account_coins.snapshot(pot)
    coins = [c["coin"] for c in found["coins"]]
    assert "BNB" not in coins
    assert QUOTE not in coins
    assert coins == sorted(
        coins, key=lambda c: -float(next(x["value"] for x in found["coins"] if x["coin"] == c))
    )
    btc = next(c for c in found["coins"] if c["coin"] == "BTC")
    assert btc["tradable"] is True
    assert len(btc["spark"]) == 30
    assert btc["insight"]["status"] in ("watch", "wait", "none")


def test_each_coin_reads_as_a_trend_and_a_setup() -> None:
    from api.account_coins import insight  # noqa: PLC0415

    def facts(*v: str) -> dict[str, Any]:
        price, s20, s50, s200, high, low = v
        return {
            "price": price,
            "sma20": s20,
            "sma50": s50,
            "sma200": s200,
            "range21d": {"high": high, "low": low},
        }

    pullback = insight(facts("101", "100", "95", "90", "110", "92"))
    assert pullback == {
        "trend": "Up trend: above its 50- and 200-day.",
        "setup": "Back at its 20-day: worth an Analyse.",
        "status": "watch",
    }
    assert insight(facts("109.8", "104", "100", "95", "110", "95"))["status"] == "watch"  # high
    falling = insight(facts("80", "85", "90", "95", "100", "79.5"))
    assert falling["trend"] == "Down trend: under its 50- and 200-day."
    assert falling["status"] == "wait"  # at its 21-day low
    assert insight(facts("85", "86", "90", "95", "100", "70"))["setup"].startswith("No long setup")
    assert insight(facts("50", "50", "", "", "55", "45"))["trend"].startswith("Too new")


def test_a_coin_without_a_pair_is_left_out_not_fatal(
    pot: Pot, monkeypatch: pytest.MonkeyPatch
) -> None:
    from api import account_coins  # noqa: PLC0415

    real = demo.BALANCES
    monkeypatch.setattr(demo, "BALANCES", [*real, {"asset": "LDBTC", "free": "1", "locked": "0"}])
    coins = [c["coin"] for c in account_coins.snapshot(pot)["coins"]]
    assert "LDBTC" not in coins
    assert "BTC" in coins


def test_the_watchlist_starts_from_what_is_held_then_follows_the_owner(pot: Pot) -> None:
    from api import account_coins  # noqa: PLC0415

    first = account_coins.snapshot(pot)
    held = [c["coin"] for c in first["coins"]]
    assert held
    assert len(held) <= account_coins.MAX
    # The owner drops one coin and adds one not held: the list, not the wallet, decides.
    pot.store.unwatch_coin(first["list"], held[0])
    pot.store.watch_coin(first["list"], "LINK", 1)
    after = account_coins.snapshot(pot)
    coins = [c["coin"] for c in after["coins"]]
    assert held[0] not in coins
    link = next(c for c in after["coins"] if c["coin"] == "LINK")
    assert Decimal(link["value"]) == 0
    assert after["list"] == first["list"]


def test_the_account_watchlist_holds_more_than_the_trade_pages_ten(pot: Pot) -> None:
    from api import account_coins  # noqa: PLC0415
    from api.watchlist import ACCOUNT_LIST, ACCOUNT_MAX, MAX_COINS, cap  # noqa: PLC0415

    found = account_coins.snapshot(pot)
    assert found["max"] == ACCOUNT_MAX > MAX_COINS
    assert cap({"name": ACCOUNT_LIST}) == ACCOUNT_MAX
    assert cap({"name": "Portfolio"}) == MAX_COINS


def test_a_market_entry_is_sized_at_the_price_now_and_logged(pot: Pot) -> None:
    pot.set_config({"mode": "test", "fixed": "10", "riskPct": "2", "maxRisk": ""})
    placed = pot.place(SOL | {"target": "260", "market": True})
    assert placed["status"] == "open"  # the demo fills a market buy at once
    assert placed["entry"] == "212.4"  # SOL is 212.40 in the demo
    notes = [n["text"] for n in placed["notes"]]
    assert notes[0].startswith("Placed: market buy, about")
    assert notes[1].startswith("Filled ")
    with pytest.raises(Refused, match="the rules need 2"):
        pot.place(SOL | {"coin": "ETH", "entry": "3300", "stop": "3200", "target": "3400"})


def test_enter_now_swaps_a_waiting_limit_for_a_market_buy(pot: Pot) -> None:
    pot.set_config({"mode": "test", "fixed": "10", "riskPct": "2", "maxRisk": ""})
    waiting = pot.place(SOL | {"target": "230"})
    with pytest.raises(Refused, match="Reward to risk"):  # 212.40 against a 190 stop: under 2R
        pot.enter_now(waiting["ref"])
    assert pot.view()["trades"][0]["status"] == "waiting"  # refused: nothing touched
    pot.move_target({"ref": waiting["ref"], "target": "260"})
    entered = pot.enter_now(waiting["ref"])
    assert entered["status"] == "open"
    assert entered["entry"] == "212.4"
    assert any(n["text"].startswith("Enter now at market") for n in entered["notes"])
    assert by_tag(f"{waiting['ref']}-E")["status"] == "CANCELED"


def test_adding_only_in_profit_and_within_the_risk(
    pot: Pot, monkeypatch: pytest.MonkeyPatch
) -> None:
    pot.set_config({"mode": "test", "fixed": "10", "riskPct": "2", "maxRisk": ""})
    trade = opened(pot)
    added = pot.add({"ref": trade["ref"], "usdc": "10"})
    assert Decimal(added["qty"]) > Decimal(trade["qty"])
    exits = [o for o in added["orders"] if o["role"] == "exit"]
    assert exits[-1]["qty"] == added["qty"]  # the stop and target cover the whole position
    assert any(n["text"].startswith("Added ") for n in added["notes"])
    with pytest.raises(Refused, match="over the"):
        pot.add({"ref": trade["ref"], "usdc": "15"})
    monkeypatch.setitem(demo.PRICES, "SOLUSDT", ("195.00", "0"))
    with pytest.raises(Refused, match="No averaging down"):
        pot.add({"ref": trade["ref"], "usdc": "5"})


def test_reducing_sells_part_and_keeps_the_rest_protected(pot: Pot) -> None:
    pot.set_config({"mode": "test", "fixed": "10", "riskPct": "2", "maxRisk": ""})
    trade = opened(pot)
    pot.add({"ref": trade["ref"], "usdc": "10"})
    reduced = pot.reduce({"ref": trade["ref"], "pct": "50"})
    assert reduced["status"] == "open"
    held = Decimal(reduced["qty"]) - Decimal(
        str(pot.store.pot_trade(trade["ref"])["exit_qty"])  # type: ignore[index]
    )
    live = [o for o in reduced["orders"] if o["role"] == "exit" and o["status"] == "open"]
    assert Decimal(live[-1]["qty"]) == held
    assert any(n["text"].startswith("Sold ") for n in reduced["notes"])
    with pytest.raises(Refused, match="close it at market"):
        pot.reduce({"ref": trade["ref"], "pct": "100"})


def test_a_target_moves_and_you_can_add_a_note(pot: Pot) -> None:
    trade = opened(pot)
    moved = pot.move_target({"ref": trade["ref"], "target": "250"})
    assert moved["target"] == "250"
    with pytest.raises(Refused, match="above the price"):
        pot.move_target({"ref": trade["ref"], "target": "205"})
    noted = pot.note({"ref": trade["ref"], "text": "  Held the 20-day   twice. "})
    assert noted["notes"][-1] == {
        "kind": "you",
        "text": "Held the 20-day twice.",
        "created": noted["notes"][-1]["created"],
    }
    with pytest.raises(Refused, match="Type the note"):
        pot.note({"ref": trade["ref"], "text": " "})


def test_enter_now_never_buys_while_the_limit_is_still_live(
    pot: Pot, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The review's blocker: a cancel that didn't take must not be followed by a market buy."""
    pot.set_config({"mode": "test", "fixed": "10", "riskPct": "2", "maxRisk": ""})
    waiting = pot.place(SOL | {"target": "260"})

    def lost(*_a: object, **_k: object) -> None:
        raise BinanceError(503, "Service unavailable")

    monkeypatch.setattr(pot.binance, "cancel", lost)
    with pytest.raises(Refused, match="still has the limit order live"):
        pot.enter_now(waiting["ref"])
    assert by_tag(f"{waiting['ref']}-E")["status"] == "NEW"
    tags = {o.get("clientOrderId") for o in demo.EXCHANGE.orders.values()}
    assert f"{waiting['ref']}-EM" not in tags  # no second buy
    assert pot.view()["trades"][0]["status"] == "waiting"


def test_enter_now_meets_every_rule_a_new_trade_does(pot: Pot) -> None:
    pot.set_config({"mode": "test", "fixed": "10", "riskPct": "2", "maxRisk": ""})
    waiting = pot.place(SOL | {"target": "260"})
    pot._regime = ("bear", "BTC under its 200-day")  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    with pytest.raises(Refused, match="Bear regime"):
        pot.enter_now(waiting["ref"])
    assert by_tag(f"{waiting['ref']}-E")["status"] == "NEW"  # refused: nothing touched


def test_a_market_buy_is_not_refused_when_the_price_dips(pot: Pot) -> None:
    """The desk sends the price it last read; a tick lower now must not refuse a market buy."""
    pot.set_config({"mode": "test", "fixed": "10", "riskPct": "2", "maxRisk": ""})
    body = SOL | {"entry": "213", "target": "280"}  # SOL is 212.40 in the demo
    with pytest.raises(Refused, match="above the price now"):
        pot.size(body)
    assert pot.size(body | {"market": True})["entry"] == "213"


def test_a_waiting_trade_target_keeps_the_style_reward(pot: Pot) -> None:
    pot.set_config({"mode": "test", "fixed": "10", "riskPct": "2", "maxRisk": ""})
    waiting = pot.place(SOL | {"target": "230"})
    with pytest.raises(Refused, match="the rules need 2"):
        pot.move_target({"ref": waiting["ref"], "target": "213"})
