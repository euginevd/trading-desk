"""The Profile (decision 58): versions, Markdown, locks, the command bar's diff and approve
flow, the pre-trade check, the bots' hold, the recap and out-of-date marks. Made-up figures only
(known-mistakes 7)."""

import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal as D
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
from api import demo, handler, profile, profile_ai, profile_live, profile_routes
from api.ai_signal import Signals
from api.audit import Audit
from api.binance import Binance
from api.handler import Services
from api.profile_md import export, parse
from api.store import Store
from api.trading import Refused, Trading

SYDNEY = ZoneInfo("Australia/Sydney")
NOW = 1_794_000_000_000


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    kept = Store(tmp_path / "desk.sqlite")
    yield kept
    kept.close()


@pytest.fixture
def audit(tmp_path: Path) -> Audit:
    return Audit(tmp_path / "audit.jsonl")


def sample() -> dict[str, Any]:
    doc = profile.empty()
    doc["identity"] = {"name": "Sam", "date_of_birth": "1988-03-04"}
    doc["income"]["available_monthly_aud"] = "5,600"
    doc["goals"] = [
        {
            "label": "First milestone",
            "amount": "500K",
            "currency": "usd",
            "date": "2030-12-31",
            "then_rule": "never drop below it",
        }
    ]
    doc["foundations"]["min_cash_aud"] = "60000"
    doc["rules"]["monthly_deposit_cap_aud"] = "A$4,000"
    doc["rules"]["deposit_cadence"] = "weekly"
    doc["rules"]["behaviour_rules"] = ["No buying after a 20% day"]
    doc["holdings"] = [
        {"name": "Binance", "source": "binance", "invested_aud": "9000", "counts": True},
        {"name": "Bank", "source": "manual", "invested_aud": "45000", "value_aud": "45000"}
        | {"cash": True, "counts": True},
    ]
    doc["lessons"] = [{"year": "2025", "text": "Doubled monthly deposits, then stopped."}]
    doc["additional_info"] = "## Notes\n- a: b | c"
    doc["locks"] = {"deposit_cap": True}
    return doc


def saved(store: Store, audit: Audit, doc: dict[str, Any] | None = None) -> dict[str, Any]:
    return profile.save(store, audit, doc or sample(), author=profile.OWNER, now=NOW)


# The document and its versions.


def test_unset_rules_are_null_and_typed_fields_are_checked(store: Store, audit: Audit) -> None:
    page = saved(store, audit)
    doc = page["profile"]
    assert doc["rules"]["monthly_deposit_cap_aud"] == "4000"  # A$4,000 read as a number
    assert doc["goals"][0]["amount"] == "500000"  # 500K
    assert doc["goals"][0]["currency"] == "USD"
    for unset in ("max_pct_per_coin", "per_trade_aud", "max_loss_pct", "rebalance_band"):
        assert doc["rules"][unset] is None  # no defaults: Not set
    with pytest.raises(Refused, match="must be from"):
        profile.save_section(
            store, audit, "rules", doc["rules"] | {"max_pct_per_coin": "250"}, now=NOW
        )
    with pytest.raises(Refused, match="date"):
        profile.save_section(store, audit, "identity", {"date_of_birth": "yesterday"}, now=NOW)
    with pytest.raises(Refused, match="No such section"):
        profile.save_section(store, audit, "diary", {}, now=NOW)


def test_each_save_is_a_version_with_a_summary_and_restore_adds_one(
    store: Store, audit: Audit
) -> None:
    saved(store, audit)
    _, doc = profile.current(store)
    rules = doc["rules"] | {"monthly_deposit_cap_aud": "3000"}
    profile.save_section(store, audit, "rules", rules, now=NOW + 1, reason="Holiday month")
    history = profile.history(store)
    assert [v["n"] for v in history] == [2, 1]
    assert history[0]["summary"] == "Monthly deposit cap (A$) A$4,000 → A$3,000"
    assert (history[0]["author"], history[0]["reason"]) == ("You", "Holiday month")
    with pytest.raises(Refused, match="Nothing changed"):
        profile.save_section(store, audit, "rules", rules, now=NOW + 2)
    page = profile.restore(store, audit, 1, NOW + 3)
    assert page["version"] == 3  # restoring never rewrites history  # noqa: PLR2004
    assert page["profile"]["rules"]["monthly_deposit_cap_aud"] == "4000"
    assert profile.history(store)[0]["summary"] == "Restored v1"
    assert page["updated"]["rules"] == NOW + 3
    assert page["updated"]["identity"] == NOW
    assert store.profile_md.read_text(encoding="utf-8").startswith("# Profile\n\nVersion 3")


def test_the_markdown_round_trips_and_imports_as_a_version(store: Store, audit: Audit) -> None:
    doc = profile.clean(sample())
    text = export(doc, 7, NOW)
    assert "- Max % per coin: Not set" in text
    assert parse(text) == doc
    with pytest.raises(Refused, match="# Profile"):
        parse("Just some notes")
    with pytest.raises(Refused, match="Unknown section"):
        parse("# Profile\n\n## Diary\n- x")


def test_only_the_owner_changes_a_locked_field(store: Store, audit: Audit) -> None:
    saved(store, audit)
    _, doc = profile.current(store)
    lower = doc | {"rules": doc["rules"] | {"monthly_deposit_cap_aud": "3000"}}
    with pytest.raises(Refused, match="Deposit cap locked"):
        profile.save(store, audit, lower, author="Command bar", now=NOW + 1)
    unlock = doc | {"locks": doc["locks"] | {"deposit_cap": False}}
    with pytest.raises(Refused, match="locked"):  # an agent can't unlock it either
        profile.save(store, audit, unlock, author="Command bar", now=NOW + 1)
    assert profile.save(store, audit, lower, author=profile.OWNER, now=NOW + 1)["version"] == 2  # noqa: PLR2004


# The command bar: a change is a diff to approve; a question changes nothing.


def stub(reply: dict[str, Any]) -> Any:
    asked: list[str] = []

    def write(_system: str, text: str, _shape: dict[str, Any]) -> dict[str, Any]:
        asked.append(text)
        return reply

    write.asked = asked  # type: ignore[attr-defined]
    return write


def change(sections: dict[str, Any], summary: str = "") -> dict[str, Any]:
    return {
        "kind": "change",
        "answer": "",
        "sections": [{"section": k, "value_json": json.dumps(v)} for k, v in sections.items()],
        "summary": summary,
        "reason": "",
    }


def test_a_change_request_is_a_proposal_with_its_diff_and_conflicts(
    store: Store, audit: Audit
) -> None:
    saved(store, audit)
    _, doc = profile.current(store)
    raise_cap = {"rules": doc["rules"] | {"per_trade_aud": "5000", "max_pct_per_coin": "40"}}
    write = stub(change(raise_cap, "Per-trade A$5K, max per coin 40%"))
    shares = {"TAO": D(70)}
    found = profile_ai.command(
        store, audit, write, text="per trade 5k, 40% a coin", live={}, shares=shares
    )
    suggestion = found["suggestion"]
    assert found["kind"] == "change"
    assert {(c["label"], c["from"], c["to"]) for c in suggestion["changes"]} == {
        ("Per-trade size (A$)", "Not set", "A$5,000"),
        ("Max % per coin", "Not set", "40%"),
    }
    assert any("more than the A$4,000 monthly cap" in c for c in suggestion["conflicts"])
    assert any("TAO is 70%" in c for c in suggestion["conflicts"])
    assert suggestion["blocked"] is None
    assert "per trade 5k" in write.asked[0]
    assert profile.current(store)[0] == 1  # nothing saved until it's accepted
    page = profile_ai.accept(store, audit, suggestion["id"], "", NOW + 1)
    assert page["version"] == 2  # noqa: PLR2004
    assert profile.history(store)[0]["author"] == "Command bar"
    assert profile.history(store)[0]["summary"] == "Per-trade A$5K, max per coin 40%"
    assert profile_ai.suggestions(store) == []


def test_a_locked_field_is_blocked_and_a_rejection_saves_nothing(
    store: Store, audit: Audit
) -> None:
    saved(store, audit)
    _, doc = profile.current(store)
    lower = {"rules": doc["rules"] | {"monthly_deposit_cap_aud": "3000"}}
    write = stub(change(lower))
    suggestion = profile_ai.command(store, audit, write, text="cap 3k", live={}, shares={})[
        "suggestion"
    ]
    assert suggestion["blocked"] == "Deposit cap locked: unlock on the card first."
    assert any("2025 lesson" in c for c in suggestion["conflicts"])
    with pytest.raises(Refused, match="locked"):
        profile_ai.accept(store, audit, suggestion["id"], "", NOW + 1)
    assert profile_ai.suggestions(store)[0]["id"] == suggestion["id"]  # kept, so the owner sees why
    assert profile_ai.reject(store, audit, suggestion["id"]) == {"suggestions": []}
    assert profile.current(store)[0] == 1


def test_a_question_is_answered_and_changes_nothing(store: Store, audit: Audit) -> None:
    saved(store, audit)
    write = stub(
        {
            "kind": "answer",
            "answer": "Behind: 28% there.",
            "sections": [],
            "summary": "",
            "reason": "",
        }
    )
    found = profile_ai.command(store, audit, write, text="am I on track?", live={"x": 1}, shares={})
    assert found == {
        "kind": "answer",
        "answer": "Behind: 28% there.",
        "question": "am I on track?",
        "profileVersion": 1,
    }
    assert profile.current(store)[0] == 1
    with pytest.raises(Refused):
        profile_ai.command(store, audit, write, text="   ", live={}, shares={})


def test_goal_paths_project_the_monthly_amount_at_each_return() -> None:
    doc = profile.clean(sample())
    paths = profile_ai.goal_paths(doc, D(150000), D("1.5"), date(2026, 12, 15))
    assert paths[0]["monthsLeft"] == 48  # noqa: PLR2004
    assert paths[0]["projected"]["0%"] == "228,000"  # (150,000 + 48 x 4,000) / 1.5
    assert profile_ai.projection(D(100), D(0), D(12), 12) > D(112)  # compounded monthly


# Live figures.


def held(**extra: Any) -> dict[str, Any]:
    return {
        "total": {"value": "10000", "rates": {"AUD": "1.5"}} | extra,
        "holdings": [
            {
                "asset": "TAO",
                "source": "TAO wallet",
                "value": "7000",
                "price": "400",
                "profitPercent": "-30",
            },
            {
                "asset": "BTC",
                "source": "Binance",
                "value": "2000",
                "price": "90000",
                "profitPercent": "10",
            },
            {"asset": "USDT", "source": "Binance", "value": "1000", "price": "1"},
        ],
    }


def test_the_strip_and_checks_skip_unset_rules() -> None:
    doc = profile.clean(sample())
    rows = profile_live.holdings(doc, held())
    assert rows[0]["now_aud"] == "4500"  # Binance's $3,000 at 1.5
    assert rows[0]["pnl_aud"] == "-4500"
    strip = profile_live.strip(doc, rows, held(), D(3500), date(2026, 11, 15))
    assert strip["cash"] == {"now": "45000", "floor": "60000", "pct": "75", "status": "attention"}
    assert strip["month"]["status"] == "attention"  # 87.5% of the cap
    assert strip["nextGoal"]["pct"] == "6.6"  # 49,500 / 1.5 of 500,000
    checks = profile_live.rule_checks(doc, held(), D(3500))
    assert set(checks) == {"monthly_deposit_cap_aud"}  # nothing unset is checked
    doc["rules"]["max_pct_per_coin"] = "25"
    checks = profile_live.rule_checks(doc, held(), D(3500))
    assert checks["max_pct_per_coin"] == {"status": "broken", "text": "TAO 70% vs max 25%"}
    assert profile_live.foundations(doc, "45000")["min_cash_aud"] == "below"


# The pre-trade check, through the routes.


@pytest.fixture
def call(store: Store, audit: Audit, monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    binance = Binance(
        httpx.Client(base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)),
        ("k", "s"),
        audit,
    )

    def ask(_s: str, _t: str, _shape: dict[str, Any]) -> tuple[dict[str, Any], D]:
        return {"headline": "A steady week", "lines": ["Kept every rule."]}, D(0)

    @contextmanager
    def services() -> Generator[Services]:
        yield Services(binance, store, Signals(ask, store, audit), audit, portfolio=held)

    @contextmanager
    def trading() -> Generator[Trading]:
        yield Trading(binance, store, audit)

    def send(method: str, path: str, body: object = None) -> tuple[int, Any]:
        event: dict[str, object] = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}},
            "queryStringParameters": {},
            "body": json.dumps(body) if body is not None else "",
        }
        result = handler.handler(event, None, portfolio=held, trading=trading, services=services)
        return int(str(result["statusCode"])), json.loads(str(result["body"]))

    return send


def buy(**fields: Any) -> dict[str, Any]:
    return {
        "clientId": "a1b2c3d4-0000-0000-0000-000000000001",
        "symbol": "BTCUSDT",
        "side": "buy",
        "price": "90000",
        "amount": "0.001",
    } | fields


def test_a_buy_over_the_monthly_cap_needs_a_second_confirm(call: Any, store: Store) -> None:
    call("PUT", "/limits", {"perOrder": "100000", "perDay": "100000"})
    assert call("PUT", "/profile/rules", {"value": {"per_trade_aud": "100000"}})[0] == 200  # noqa: PLR2004
    assert call("POST", "/orders", buy())[0] == 200  # noqa: PLR2004 - no cap set: not checked
    status, page = call("PUT", "/profile/rules", {"value": {"monthly_deposit_cap_aud": "200"}})
    assert (status, page["version"]) == (200, 2)
    big = buy(clientId="a1b2c3d4-0000-0000-0000-000000000002", amount="0.002")
    status, held_back = call("POST", "/orders", big)  # A$270 on top of A$135 this month
    assert status == 409  # noqa: PLR2004
    assert held_back["ruleBreaks"][0]["label"] == "Monthly deposit cap"
    assert "over your A$200 cap" in held_back["ruleBreaks"][0]["message"]
    status, _ = call("POST", "/orders", big | {"override": True})
    assert status == 200  # noqa: PLR2004
    assert profile_ai.overrides(store)[0]["rules"] == ["monthly_deposit_cap_aud"]
    sell = big | {"side": "sell", "clientId": "a1b2c3d4-0000-0000-0000-000000000003"}
    assert call("POST", "/orders", sell)[0] != 409  # noqa: PLR2004 - sales aren't checked


def test_a_bot_holds_a_buy_that_breaks_a_rule(store: Store, audit: Audit) -> None:
    doc = profile.clean(sample())
    now = datetime(2026, 11, 15, 10, tzinfo=SYDNEY)
    store.set_setting(profile_live.RATE_KEY, "1.5")
    assert profile_live.bot_problem(store, doc, D(100), now) is None  # A$150 under A$4,000
    held_back = profile_live.bot_problem(store, doc, D(3000), now)
    assert held_back == "Waiting: breaks your monthly deposit cap."


def test_the_page_routes_import_export_versions_and_command(call: Any) -> None:
    status, page = call("GET", "/profile")
    assert (status, page["version"], page["live"]["known"]) == (200, 0, True)
    md = export(profile.clean(sample()), 1, NOW)
    status, page = call("POST", "/profile/import", {"markdown": md})
    assert (status, page["version"]) == (200, 1)  # the first import is v1
    assert page["profile"]["identity"]["name"] == "Sam"
    assert call("GET", "/profile/export")[1]["markdown"].startswith("# Profile")
    assert call("GET", "/profile/versions")[1]["versions"][0]["summary"] == "Imported from Markdown"
    assert call("GET", "/profile/versions/1")[1]["profile"]["identity"]["name"] == "Sam"
    assert call("GET", "/profile/versions/9")[0] == 400  # noqa: PLR2004
    assert call("POST", "/profile/restore", {"n": "x"})[0] == 400  # noqa: PLR2004


# The weekly recap and out-of-date marks.


def test_the_recap_is_due_sunday_evening_once_a_week(store: Store, audit: Audit) -> None:
    saved(store, audit)
    sunday = datetime(2026, 11, 15, 18, 5, tzinfo=SYDNEY)
    assert profile_ai.recap_due(store, sunday.replace(hour=17)) is None
    assert profile_ai.recap_due(store, sunday) == "2026-11-15"
    strip = {
        "totalAud": "49500",
        "nextGoal": None,
        "month": {"spent": "1000", "cap": "4000"},
    }
    facts = profile_ai.recap_facts(store, strip, {}, sunday.date())
    plain = profile_ai.make_recap(store, audit, None, facts)
    assert plain["source"] == "plain"
    assert "Bought A$1,000 of your A$4,000 cap this month." in plain["lines"]
    assert profile_ai.recap_due(store, sunday) is None  # one a week


def test_outputs_go_out_of_date_when_the_profile_moves_on(
    call: Any, store: Store, audit: Audit
) -> None:
    saved(store, audit)
    status, recap = call("POST", "/recaps")
    assert (status, recap["recap"]["source"], recap["recap"]["profileVersion"]) == (200, "model", 1)
    assert call("GET", "/profile")[1]["recap"]["outOfDate"] is False
    call("PUT", "/profile/quotes", {"value": [{"text": "Stay the course."}]})
    assert call("GET", "/profile")[1]["recap"]["outOfDate"] is True
    assert call("GET", "/recaps")[1]["recaps"][0]["outOfDate"] is True


def test_the_scorecard_counts_kept_and_broken_buys_for_set_rules() -> None:
    doc = profile.clean(sample())
    today = date(2026, 11, 15)
    ms = int(datetime(2026, 11, 10, tzinfo=SYDNEY).timestamp() * 1000)
    entries: list[dict[str, Any]] = [
        {
            "side": "buy",
            "time": ms,
            "coin": "BTC",
            "price": "100",
            "broke": ["Deposits over cap that month"],
        },
        {"side": "buy", "time": ms, "coin": "BTC", "price": "100", "broke": []},
        {"side": "sell", "time": ms, "coin": "BTC", "price": "120", "broke": []},
    ]
    card = profile_routes.scorecard(doc, entries, {"BTC": D(110)}, today)
    assert card["windows"]["30"] == [
        {
            "rule": "monthly_deposit_cap_aud",
            "label": "Monthly deposit cap",
            "kept": 1,
            "broken": 1,
            "brokenResultPct": "10",
        }
    ]
