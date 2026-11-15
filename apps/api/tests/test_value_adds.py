"""Tax lots, drift rebalancing, the journal and the Telegram summary (decisions 54 to 57).
Made-up figures only (known-mistakes 7)."""

import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
from api import env_file, handler, journal, ledger, rebalance, tax, telegram, trading_plan
from api.ai_signal import Signals
from api.audit import Audit
from api.binance import Binance
from api.handler import Services
from api.ledger import Fill
from api.store import Store
from api.trading import Refused, Trading

D = Decimal
SYDNEY = ZoneInfo("Australia/Sydney")
TODAY = date(2026, 11, 15)


def ms(day: str) -> int:
    return int(datetime.fromisoformat(day).replace(hour=12, tzinfo=SYDNEY).timestamp() * 1000)


def fill(  # noqa: PLR0913, PLR0917 - a fill's fields, in order
    day: str, coin: str, buy: bool, qty: str, price: str, order: int, rate: str = "1.5"
) -> Fill:  # noqa: E501, PLR0913, PLR0917
    q, p = D(qty), D(price)
    return Fill(coin, f"{coin}USDC", order, ms(day), buy, q, p, q * p, D(rate))


def portfolio(**held: tuple[str, str]) -> dict[str, Any]:
    """held: coin -> (amount, price in US dollars)."""
    holdings = [
        {"asset": c, "source": "Binance", "amount": a, "price": p, "value": str(D(a) * D(p))}
        for c, (a, p) in held.items()
    ]
    total = sum((D(h["value"]) for h in holdings), D(0))
    return {"total": {"value": str(total), "rates": {"AUD": "1.5"}}, "holdings": holdings}


# Tax lots.


def test_lots_are_first_in_first_out_with_an_unknown_opening_lot() -> None:
    fills = [
        fill("2026-07-04", "ETH", True, "1", "2000", 1),
        fill("2026-08-01", "ETH", True, "1", "3000", 2),
        fill("2026-09-01", "ETH", False, "1.5", "4000", 3),
    ]
    lots, sales = tax.build(fills, {"ETH": D("1")})  # bought 2, sold 1.5: 0.5 held from before
    assert [(lot.bought, lot.qty) for lot in lots["ETH"]] == [(date(2026, 8, 1), D("1"))]
    # The 0.5 held before the start goes first, then the July lot.
    assert [(s.bought, s.qty, s.gain) for s in sales] == [
        (None, D("0.5"), None),
        (date(2026, 7, 4), D("1"), D("3000")),  # (4000 - 2000) x 1.5
    ]
    assert sales[1].discounted is False


def test_the_discount_comes_after_twelve_months() -> None:
    assert tax.qualifies(date(2026, 7, 4)) == date(2027, 7, 5)
    assert tax.qualifies(date(2028, 2, 29)) == date(2029, 3, 1)
    assert tax.fy_of(date(2026, 6, 30)) == 2025  # noqa: PLR2004
    assert tax.fy_of(date(2026, 7, 1)) == 2026  # noqa: PLR2004


def test_the_report_has_the_years_gains_the_lots_and_whats_under_water() -> None:
    fills = [
        fill("2026-07-04", "ETH", True, "1", "2000", 1),
        fill("2026-08-01", "ETH", False, "0.5", "3000", 2),
        fill("2026-08-19", "SOL", True, "6", "180", 3),
        fill("2026-09-01", "SOL", False, "1", "150", 4),
    ]
    report = tax.report(
        fills, portfolio(ETH=("0.5", "2600"), SOL=("5", "130"), BTC=("0.01", "70000")), TODAY
    )  # noqa: E501
    assert (report["fy"], report["sales"]) == ("2026-27", 2)
    assert report["realisedGainsAud"] == "750"  # (3000 - 2000) x 0.5 x 1.5
    assert report["realisedLossesAud"] == "-45"  # (150 - 180) x 1 x 1.5
    eth = next(r for r in report["lots"] if r["coin"] == "ETH")
    assert (eth["costAud"], eth["nowAud"], eth["gainAud"]) == ("1500", "1950", "450")
    assert (eth["qualifiesOn"], eth["daysToDiscount"], eth["heldDays"]) == ("2027-07-05", 232, 134)
    btc = next(r for r in report["lots"] if r["coin"] == "BTC")
    assert btc["bought"] is None  # age unknown
    assert btc["daysToDiscount"] is None
    assert report["next"]["coin"] == "ETH"
    assert report["underWater"] == [{"coin": "SOL", "lossAud": "-375", "afterAud": "330"}]


def test_a_sale_warns_when_it_uses_a_lot_under_twelve_months() -> None:
    fills = [fill("2026-07-04", "ETH", True, "1", "2000", 1)]
    check = tax.sell_check(fills, portfolio(ETH=("1", "2600")), "ETH", D("0.4"), TODAY)
    assert check["young"] is True
    assert check["youngest"]["daysToDiscount"] == 232  # noqa: PLR2004
    assert check["gainAud"] == "360"  # (2600 - 2000) x 0.4 x 1.5
    assert check["unknown"] is False
    old = tax.sell_check([], portfolio(ETH=("1", "2600")), "ETH", D("0.4"), TODAY)
    assert (old["young"], old["unknown"], old["gainAud"]) == (False, True, None)


# Drift rebalancing.


def test_drift_flags_coins_outside_the_band_and_sizes_the_order() -> None:
    plan = {
        "goals": {
            "targets": [
                {"coin": "TAO", "pct": "20"},
                {"coin": "BTC", "pct": "40"},
                {"coin": "ETH", "pct": "25"},
            ]
        },  # noqa: E501
        "rules": {"driftBand": "5", "tradeBudgetAud": "500"},
    }
    held = portfolio(
        TAO=("10", "410"), BTC=("0.03", "70000"), ETH=("0.6", "3000"), USDC=("1900", "1")
    )  # noqa: E501
    out = rebalance.drift(held, plan)  # total $9,900: TAO 41.4%, BTC 21.2%, ETH 18.2%
    rows = {r["coin"]: r for r in out["rows"]}
    assert (out["outside"], out["band"]) == (3, "5")
    assert (rows["TAO"]["side"], rows["TAO"]["toTargetAud"], rows["TAO"]["orderAud"]) == (
        "sell",
        "3180",
        "500",
    )  # noqa: E501
    assert rows["TAO"]["capped"] is True
    assert rows["TAO"]["qty"] == "0.81300813"  # A$500 at 1.5 = $333.33, at $410
    assert rows["BTC"]["side"] == "buy"
    assert (
        rebalance.drift(held, plan | {"rules": {"driftBand": "8", "tradeBudgetAud": "500"}})[
            "outside"
        ]
        == 2
    )  # noqa: E501, PLR2004


# The journal.


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    kept = Store(tmp_path / "desk.sqlite")
    yield kept
    kept.close()


def test_the_journal_groups_fills_checks_rules_and_scores(store: Store) -> None:
    fills = [
        fill("2026-11-09", "SOL", True, "2", "180", 10),
        fill("2026-11-09", "SOL", True, "2", "184", 10),  # the same order, two fills
        fill("2026-11-12", "ETH", True, "0.1", "3000", 11),
        fill("2026-11-14", "ETH", False, "0.1", "3200", 12),
    ]
    _, sales = tax.build(fills, {"SOL": D("4")})
    plan = {"rules": {"tradeBudgetAud": "500", "maxCoinPct": "25", "monthlyCapAud": "6000"}}
    view = journal.view(store, fills, sales, plan, {"SOL"}, {"2026-11": D("6500")}, TODAY)
    rows = {r["key"]: r for r in view["entries"]}
    sol = rows["SOLUSDC:10"]
    assert (sol["qty"], sol["price"], sol["aud"]) == ("4", "182", "1092")
    assert sol["broke"] == [
        "Over per-trade size",
        "SOL over its cap",
        "Deposits over cap that month",
    ]
    assert sol["from"] == "Order form or Binance app"
    assert rows["ETHUSDC:12"]["resultAud"] == "30"  # (3200 - 3000) x 0.1 x 1.5
    journal.tag(store, {"key": "ETHUSDC:11", "setups": ["Support buy"], "mistakes": ["FOMO"]})
    with pytest.raises(Refused):
        journal.tag(store, {"key": "ETHUSDC:11", "mistakes": ["Not a tag"]})
    with pytest.raises(Refused):
        journal.tag(store, {"key": "nonsense", "mistakes": []})
    score = journal.view(store, fills, sales, plan, {"SOL"}, {"2026-11": D("6500")}, TODAY)["score"]
    assert (score["trades"], score["kept"], score["keptPct"]) == (3, 1, "33")
    assert score["mostBroken"][0]["what"] == "Deposits over cap that month"
    assert (score["withMistakeAud"], score["withoutMistakeAud"]) == ("0", "30")


def test_the_tag_lists_can_be_edited(store: Store) -> None:
    assert "FOMO" in journal.lists(store)["mistakes"]
    kept = journal.set_lists(store, {"setups": ["Dip buy", "Dip buy"], "mistakes": ["Revenge"]})
    assert kept == {"setups": ["Dip buy"], "mistakes": ["Revenge"]}
    with pytest.raises(Refused):
        journal.set_lists(store, {"setups": ["<script>"], "mistakes": []})


def test_the_journal_names_the_desk_order_that_traded(store: Store) -> None:
    bot = store.add_bot("SOL", "SOLUSDC", json.dumps({"timeframe": "1h"}), 1)
    deal = store.add_deal(bot, 1)
    order = {"deal_id": deal, "rung": 0, "side": "buy", "client_id": "c1", "price": "1", "qty": "1"}
    row = store.add_bot_order(order | {"spend": "1", "created": 1})
    store.save_bot_order(
        {
            "id": row,
            "order_id": 77,
            "status": "filled",
            "executed_qty": "1",
            "executed_quote": "1",
            "fee_base": "0",
            "updated": 1,
        }  # noqa: E501
    )
    assert store.order_sources()["SOLUSDC:77"].startswith("DCA-")
    assert "SOL" in store.desk_coins()


# Telegram.

COACH: dict[str, Any] = {
    "greeting": "Morning, Sam.",
    "mood": "down",
    "changePct": "-4.2",
    "changeAud": "-2450",
    "message": {
        "lines": ["You're within your rules."],
        "quote": {"text": "It passes.", "author": "Me"},
    },  # noqa: E501
    "keyPoints": [{"kind": "concentration", "coin": "TAO", "pct": "41", "cap": "25", "rule": True}],
    "deposits": {"capAud": "6000", "monthAud": "4200", "leftAud": "1800", "overAud": None},
}
TOKEN = "123456789:" + "A" * 35  # made up, the shape only


def test_the_summary_reads_like_the_mockup() -> None:
    assert telegram.summary(COACH) == (
        "Morning, Sam.\nYour portfolio is down 4.2% today (−A$2,450).\nYou're within your rules.\n"
        "\n• TAO is 41% of your portfolio, over your 25% cap.\n\n"
        "Deposits: A$4,200 of A$6,000 this month, A$1,800 left.\n“It passes.” — Me"
    )


def test_it_is_due_once_a_day_after_the_set_time(
    store: Store, monkeypatch: pytest.MonkeyPatch
) -> None:  # noqa: E501
    morning = datetime(2026, 11, 15, 7, 45, tzinfo=SYDNEY)
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    assert telegram.due(store, morning) is False  # no bot yet
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    assert telegram.due(store, morning.replace(hour=7, minute=0)) is False  # before 07:30
    assert telegram.due(store, morning) is True
    telegram.mark_sent(store, morning)
    assert telegram.due(store, morning.replace(hour=20)) is False  # sent today
    with pytest.raises(Refused):
        telegram.set_time(store, {"time": "7.30am"})
    assert telegram.set_time(store, {"time": "06:05"})["time"] == "06:05"


def bot(replies: dict[str, Any], seen: list[dict[str, Any]]) -> httpx.Client:
    def answer(request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        seen.append({"method": method, "body": json.loads(request.content or b"{}")})
        return httpx.Response(200, json=replies[method])

    return httpx.Client(transport=httpx.MockTransport(answer))


def test_it_finds_the_owners_chat_and_sends(store: Store, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    seen: list[dict[str, Any]] = []
    code = telegram.new_link(store)
    stranger = {"message": {"text": "hi", "chat": {"id": 666, "type": "private"}}}
    owner = {"message": {"text": code, "chat": {"id": 4242, "type": "private", "username": "sam"}}}
    late = {"message": {"text": "hello", "chat": {"id": 777, "type": "private"}}}
    updates = {"ok": True, "result": [stranger, owner, late]}
    assert telegram.view(store)["linkCode"] == code
    client = bot({"getUpdates": updates, "sendMessage": {"ok": True, "result": {}}}, seen)
    telegram.send(store, client, "Hello")
    assert [s["method"] for s in seen] == ["getUpdates", "sendMessage"]
    assert seen[1]["body"]["chat_id"] == "4242"  # only the chat that sent the code
    assert telegram.view(store)["chatName"] == "@sam"
    assert telegram.view(store)["linkCode"] is None
    telegram.send(store, client, "Again")
    assert [s["method"] for s in seen][-1] == "sendMessage"  # linked: not searched again
    refused = bot({"sendMessage": {"ok": False, "description": f"Unauthorized {TOKEN}"}}, [])
    with pytest.raises(telegram.TelegramError) as caught:
        telegram.send(store, refused, "Hello")
    assert TOKEN not in str(caught.value)


def test_the_bot_token_has_its_own_shape(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    file = tmp_path / ".env"
    file.write_text("DEMO=0\n", encoding="utf-8")
    monkeypatch.setenv("DESK_ENV_FILE", str(file))
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    env_file.save("TELEGRAM_BOT_TOKEN", TOKEN)
    assert f"TELEGRAM_BOT_TOKEN={TOKEN}" in file.read_text(encoding="utf-8")
    with pytest.raises(Refused, match="Telegram bot token"):
        env_file.save("TELEGRAM_BOT_TOKEN", "sk-ant-api03-" + "k" * 30)


def test_the_plan_keeps_a_drift_band_with_history(store: Store, tmp_path: Path) -> None:
    audit = Audit(tmp_path / "audit.jsonl")
    base = {"maxCoinPct": "25", "tradeBudgetAud": "500", "maxLossPct": "20"}
    trading_plan.save(store, audit, "rules", base, 1)
    assert trading_plan.view(store)["rules"]["driftBand"] == "5"
    trading_plan.save(store, audit, "rules", base | {"driftBand": "8"}, 2)
    history = trading_plan.view(store)["rules"]["history"]
    assert ("Rebalance band (± points)", "5", "8") in {
        (h["rule"], h["from"], h["to"]) for h in history
    }  # noqa: E501
    with pytest.raises(Refused):
        trading_plan.save(store, audit, "rules", base | {"driftBand": "90"}, 3)


# The routes and the watcher.


@pytest.fixture
def call(store: Store, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Any:
    audit = Audit(tmp_path / "audit.jsonl")
    binance = Binance(
        httpx.Client(
            base_url="https://binance.test",
            transport=httpx.MockTransport(lambda _r: httpx.Response(404)),
        ),
        ("k", "s"),
        audit,
    )  # noqa: E501
    fills = [fill("2026-07-04", "ETH", True, "1", "2000", 1)]

    def fake_fills(*_: Any) -> list[Fill]:
        return fills

    def deposits(_s: Services, _q: dict[str, str]) -> dict[str, Any]:
        return {"fy": "2026-27", "total": {"aud": "0"}, "months": []}

    monkeypatch.setattr(ledger, "fills", fake_fills)
    monkeypatch.setattr(handler, "_deposits", deposits)
    held = portfolio(ETH=("1", "2600"))

    @contextmanager
    def factory() -> Generator[Services]:
        def ask(_s: str, _t: str, _shape: dict[str, Any]) -> tuple[dict[str, Any], Decimal]:
            return {}, D(0)

        signals = Signals(ask, store, audit)
        yield Services(binance, store, signals, audit, portfolio=lambda: held)

    @contextmanager
    def trading() -> Generator[Trading]:
        yield Trading(binance, store, audit)

    def send(method: str, path: str, body: object = None, **query: str) -> tuple[int, Any]:
        event: dict[str, object] = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}},
            "queryStringParameters": query,
            "body": json.dumps(body) if body is not None else "",
        }
        result = handler.handler(event, None, trading=trading, services=factory)
        return int(str(result["statusCode"])), json.loads(str(result["body"]))

    send.factory = factory  # type: ignore[attr-defined]
    return send


def test_the_routes_serve_tax_drift_and_the_journal(call: Any) -> None:
    status, report = call("GET", "/tax")
    assert (status, report["lots"][0]["coin"]) == (200, "ETH")
    status, check = call("GET", "/tax/sell-check", coin="ETH", qty="0.5")
    assert (status, check["young"]) == (200, True)
    assert call("GET", "/tax/sell-check", coin="ETH", qty="-1")[0] == 400  # noqa: PLR2004
    assert call("GET", "/rebalance")[1]["hasTargets"] is False
    status, book = call("GET", "/journal")
    assert (status, book["entries"][0]["key"]) == (200, "ETHUSDC:1")
    status, tagged = call("PUT", "/journal/tags", {"key": "ETHUSDC:1", "setups": ["Rebalance"]})
    assert (status, tagged["setups"]) == (200, ["Rebalance"])
    assert call("GET", "/settings/telegram")[1]["chatFound"] is False


def test_the_morning_summary_goes_once_and_a_failure_is_recorded(
    call: Any, store: Store, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    store.set_setting(telegram.CHAT_KEY, "4242")
    seen: list[dict[str, Any]] = []
    monkeypatch.setattr(telegram, "client", lambda: bot({"sendMessage": {"ok": True}}, seen))

    def coach(_s: Services, *, write: bool) -> dict[str, Any]:
        return COACH | {"write": write}

    monkeypatch.setattr(handler, "_coach", coach)
    morning = datetime(2026, 11, 15, 8, 0, tzinfo=SYDNEY)
    with call.factory() as services:
        assert handler.morning_summary(services, morning) is True
        assert handler.morning_summary(services, morning) is False  # once a day
    assert seen[0]["body"]["text"].startswith("Morning, Sam.")
    monkeypatch.setattr(
        telegram,
        "client",
        lambda: bot({"sendMessage": {"ok": False, "description": "blocked"}}, []),
    )  # noqa: E501
    with call.factory() as services:
        assert handler.morning_summary(services, morning.replace(day=16)) is False
    lines = (tmp_path / "audit.jsonl").read_text(encoding="utf-8")
    assert "Failed: Telegram said: blocked" in lines
    assert TOKEN not in lines
    assert datetime.now(UTC)  # the watcher's clock is Sydney's; the test passes its own


def test_one_orders_fills_make_one_lot() -> None:
    fills = [
        fill("2026-07-04", "ETH", True, "1", "2000", 1),
        fill("2026-07-04", "ETH", True, "1", "2200", 1),
        fill("2026-07-05", "ETH", True, "1", "2100", 2),
    ]
    lots, _ = tax.build(fills, {"ETH": D("3")})
    assert [(lot.qty, lot.unit_aud) for lot in lots["ETH"]] == [
        (D("2"), D("3150")),
        (D("1"), D("3150")),
    ]


def test_a_stranger_who_messages_the_bot_is_never_linked(
    store: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    code = telegram.new_link(store)
    stranger = {"message": {"text": "hi", "chat": {"id": 666, "type": "private"}}}
    client = bot({"getUpdates": {"ok": True, "result": [stranger]}}, [])
    with pytest.raises(telegram.TelegramError, match=code):
        telegram.send(store, client, "Hello")
    assert telegram.view(store)["chatFound"] is False


def test_a_non_json_answer_from_telegram_is_words(
    store: Store, monkeypatch: pytest.MonkeyPatch
) -> None:  # noqa: E501
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    store.set_setting(telegram.CHAT_KEY, "4242")
    html = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(502, text="<html>"))
    )
    with pytest.raises(telegram.TelegramError, match="502"):
        telegram.send(store, html, "Hello")


def test_a_sale_never_exceeds_what_binance_holds() -> None:
    plan = {
        "goals": {"targets": [{"coin": "TAO", "pct": "10"}, {"coin": "USDC", "pct": "50"}]},
        "rules": {"driftBand": "5", "tradeBudgetAud": "100000"},
    }  # noqa: E501
    held = portfolio(TAO=("1", "400"), USDC=("100", "1"))
    held["holdings"].append(
        {"asset": "TAO", "source": "TAO wallet", "amount": "20", "price": "400", "value": "8000"}
    )  # noqa: E501
    held["total"]["value"] = "8500"
    rows = rebalance.drift(held, plan)["rows"]
    assert [r["coin"] for r in rows] == ["TAO"]  # no stablecoin target
    assert rows[0]["qty"] == "1"  # all Binance holds; the wallet's TAO can't be sold there


def test_the_sign_in_log_blanks_tokens_codes_and_links() -> None:
    from api.ai_signin import _redacted  # noqa: PLC0415  # pyright: ignore[reportPrivateUsage]

    screen = "Paste code: abcDEF123456789012345678901234 https://claude.com/x?y sk-ant-oat01-secret"
    shown = _redacted(screen)
    for secret in ("abcDEF123456789012345678901234", "https://claude.com", "sk-ant-oat01"):
        assert secret not in shown
