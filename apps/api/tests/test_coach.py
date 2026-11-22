"""The coach Dashboard, the Plan page and the agents (decision 52). Made-up figures only."""

import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
from api import agents, coach, demo, handler, profile
from api.ai_signal import SignalError, Signals
from api.audit import Audit
from api.binance import Binance
from api.handler import Services
from api.profile_md import for_agents
from api.store import Store
from api.trading import Refused, Trading

D = Decimal
SYDNEY = ZoneInfo("Australia/Sydney")
EVENING = datetime(2026, 11, 15, 19, 30, tzinfo=SYDNEY)
NOW_MS = 1_794_000_000_000


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    kept = Store(tmp_path / "desk.sqlite")
    yield kept
    kept.close()


@pytest.fixture
def audit(tmp_path: Path) -> Audit:
    return Audit(tmp_path / "audit.jsonl")


def portfolio(change_pct: str, **extra: Any) -> dict[str, Any]:
    holdings = [
        {
            "asset": "BTC",
            "source": "Binance",
            "value": "3000",
            "price": "70000",
            "change24h": "-3.0",
            "profitPercent": "5",
        },  # noqa: E501
        {
            "asset": "TAO",
            "source": "Ledger",
            "value": "5000",
            "price": "400",
            "change24h": "-18.2",
            "profitPercent": "-25",
        },  # noqa: E501
        {
            "asset": "ETH",
            "source": "Binance",
            "value": "1500",
            "price": "3100",
            "change24h": "-6.1",
            "profitPercent": "2",
        },  # noqa: E501
        {"asset": "USDC", "source": "Binance", "value": "500", "price": "1", "change24h": "0"},
        {
            "asset": "PEPE",
            "source": "Binance",
            "value": "1",
            "price": "0.00001",
            "change24h": "-40",
        },
    ]
    total = {
        "value": "10000",
        "change24hPercent": change_pct,
        "change24h": str(D(change_pct) * 100),  # US dollars on a $10,000 portfolio
        "rates": {"AUD": "1.5"},
    }
    return {"total": total | extra, "holdings": holdings}


def plan_with(store: Store, audit: Audit, **rules: Any) -> dict[str, Any]:
    doc = profile.empty()
    doc["rules"] |= {
        "monthly_deposit_cap_aud": "6000",
        "max_pct_per_coin": "25",
        "per_trade_aud": "500",
        "max_loss_pct": "20",
        "take_profit_rule": "Up 7 days in a row or 15% in 7 days: trim back to target.",
        "behaviour_rules": ["No FOMO"],
    } | rules
    if profile.clean(doc) != profile.current(store)[1]:
        profile.save(store, audit, doc, author=profile.OWNER, now=NOW_MS)
    return profile.current(store)[1]


def week(values: list[str]) -> list[tuple[str, Decimal]]:
    """Daily account values, one a day to 15 Nov 2026."""
    return [(f"2026-11-{15 - len(values) + 1 + i:02d}", D(v)) for i, v in enumerate(values)]


def facts_for(
    store: Store, audit: Audit, change: str, history: list[str] | None = None
) -> dict[str, Any]:  # noqa: E501
    report = {
        "fy": "2026-27",
        "total": {"aud": "21500"},
        "months": [{"month": "2026-11", "aud": "4200"}],
    }  # noqa: E501
    return coach.facts(
        portfolio=portfolio(change),
        history=week(history or []),
        report=report,
        plan=plan_with(store, audit),
        now=EVENING,
        name="Sam",
        last_plan=lambda _coin: None,
    )


# Mood: one message per band (the spec's done-when).


@pytest.mark.parametrize(
    ("change", "band", "says"),
    [
        ("12", "sharp_up", "A good day: up 12%."),
        ("5", "up", "A good day: up 5%."),
        ("0", "flat", "A quiet day."),
        ("-5", "down", "Days like this are hard to watch, and they pass."),
        ("-14", "sharp_down", "Days like this are hard to watch, and they pass."),
    ],
)
def test_each_mood_band_gets_its_message(
    store: Store, audit: Audit, change: str, band: str, says: str
) -> None:
    facts = facts_for(store, audit, change)
    assert facts["mood"] == band
    assert facts["greeting"] == "Evening, Sam."
    message = coach.written(facts, profile.current(store)[1])
    assert message["lines"][0].startswith(says)
    assert "quote" not in message  # Quotes are gone (decision 62)
    if band in ("down", "sharp_down"):
        assert "rules" in message["lines"][1]
    if band in ("up", "sharp_up"):
        assert message["lines"][-1].startswith("Your take-profit rule:")


def test_the_bands_edges() -> None:
    assert [coach.mood(D(p)) for p in ("10", "9.9", "2", "1.9", "-1.9", "-2", "-9.9", "-10")] == [
        "sharp_up", "up", "up", "flat", "flat", "down", "down", "sharp_down",
    ]  # fmt: skip


def test_the_headline_figures_are_in_aud(store: Store, audit: Audit) -> None:
    facts = facts_for(store, audit, "-14")
    assert (facts["changePct"], facts["changeAud"]) == ("-14", "-2100")  # -$1,400 at 1.5


def test_a_seven_day_streak_suggests_the_take_profit_rule(store: Store, audit: Audit) -> None:
    every_day = ["100", "101", "102", "103", "104", "105", "106", "107"]
    facts = facts_for(store, audit, "3", every_day)
    assert facts["streak"] == {"weekPct": "7", "everyDay": "true"}
    message = coach.written(facts, profile.current(store)[1])
    assert (
        "You're up 7% this week. Your rule says consider taking some profit" in message["lines"][-1]
    )  # noqa: E501
    assert message["link"] == "trade"
    jump = ["100", "99", "101", "100", "104", "110", "112", "116"]  # not every day, but +16%
    assert coach.streak(week(jump)) == {"weekPct": "16", "everyDay": "false"}
    assert coach.streak(week(["100", "99", "101", "100", "104", "105", "106", "107"])) is None  # noqa: E501
    assert coach.streak(week(["1", "1", "1"])) is None  # not a week of history yet
    # A deposit isn't a gain: +16% that was all paid in is no streak.
    assert coach.streak(week(jump), {"2026-11-15": D("16")}) is None
    assert coach.inflows({"deposits": [{"day": "2026-11-15", "amount": "16"}]}) == {
        "2026-11-15": D("16")
    }
    # A down day ends the suggestion, whatever the week did.
    assert facts_for(store, audit, "-5", every_day)["streak"] is None


# The deposit coach.


def test_the_deposit_card_shows_the_year_the_month_and_the_cap(store: Store, audit: Audit) -> None:
    facts = facts_for(store, audit, "0")
    assert facts["deposits"] | {"lesson": None} == {
        "known": True,
        "fy": "2026-27",
        "fyAud": "21500",
        "monthAud": "4200",
        "capAud": "6000",
        "leftAud": "1800",
        "overAud": None,
        "usedPct": "70",
        "resetsOn": facts["deposits"]["resetsOn"],
        "daysLeft": facts["deposits"]["daysLeft"],
        "lesson": None,
    }
    over = coach.deposits(
        {"months": [{"month": "2026-11", "aud": "6500"}], "total": {"aud": "9"}},
        date(2026, 11, 15),
        D(6000),
        [],
    )  # noqa: E501
    assert (over["leftAud"], over["overAud"]) == ("0", "500")
    assert (
        "over your monthly cap by A$500"
        in coach.written(facts | {"deposits": over}, profile.current(store)[1])["coach"]
    )


def test_a_lesson_about_the_cap_shows_on_the_deposit_card() -> None:
    lessons = [
        {"year": "2025", "text": "Chased a breakout. Wait for the retest"},
        {"year": "2026", "text": "Raised the monthly cap. Keep it lower"},
    ]
    card = coach.deposits(None, date(2026, 11, 15), None, lessons)
    assert card["lesson"]["year"] == "2026"
    assert card["known"] is False


def test_the_cap_resets_on_the_first_of_next_month() -> None:
    nov = coach.deposits(None, date(2026, 11, 17), None, [])
    assert (nov["resetsOn"], nov["daysLeft"]) == ("2026-12-01", 14)
    dec = coach.deposits(None, date(2026, 12, 31), None, [])
    assert (dec["resetsOn"], dec["daysLeft"]) == ("2027-01-01", 1)


# Key points from real data.


def test_key_points_put_rule_breaches_first_and_keep_to_four(store: Store, audit: Audit) -> None:
    plan = plan_with(store, audit)
    zones = {"ETH": {"zones": {"buy": {"low": "3000", "high": "3200"}}}}
    points = coach.key_points(portfolio("-5"), plan["rules"], zones.get)
    assert [(p["kind"], p["coin"]) for p in points] == [
        ("concentration", "TAO"),  # 50% against a 25% cap
        ("concentration", "BTC"),  # 30%
        ("loss", "TAO"),  # -25% against a 20% max loss
        ("mover", "TAO"),  # -18.2%; PEPE's -40% is dust
    ]
    assert points[0]["pct"] == "50"
    roomy = coach.key_points(
        portfolio("-5"), plan["rules"] | {"max_pct_per_coin": "60", "max_loss_pct": "30"}, zones.get
    )  # noqa: E501
    assert [p["kind"] for p in roomy] == ["mover", "addZone"]
    near = {"BTC": {"zones": {"invalidation": {"price": "68000"}}}}
    assert coach.key_points(portfolio("-5"), plan["rules"] | {"max_pct_per_coin": "60", "max_loss_pct": "30"}, near.get)[1] == {  # noqa: E501
        "kind": "nearInvalidation", "coin": "BTC", "rule": False, "pct": "2.9", "price": "68000",
    }  # fmt: skip


# The model's words: kept per day and mood, checked, and plain if it can't.


def test_the_model_words_the_message_once_per_day_and_mood(store: Store, audit: Audit) -> None:
    facts = facts_for(store, audit, "-14")
    plan = profile.current(store)[1]
    asked: list[str] = []

    def write(_system: str, text: str, _shape: dict[str, Any]) -> dict[str, Any]:
        asked.append(text)
        return {"lines": ["Hard day.", "You're within your rules."], "coach": "Stay under A$6000."}

    first = coach.message(facts, plan, for_agents(store), None, write)
    assert (first["lines"], first["source"]) == (
        ["Hard day.", "You're within your rules."],
        "model",
    )  # noqa: E501
    assert '"mood": "sharp_down"' in asked[0]
    assert "No FOMO" in asked[0]  # the Plan goes with it
    kept = {"key": coach.cache_key(facts), "message": first}
    assert coach.message(facts, plan, "", kept, write) == first
    assert len(asked) == 1  # kept: not asked again
    calmer = facts_for(store, audit, "-5")
    assert coach.message(calmer, plan, "", kept, write)["lines"] == [
        "Hard day.",
        "You're within your rules.",
    ]  # noqa: E501
    assert len(asked) == 2  # the mood changed: asked again  # noqa: PLR2004


def test_without_the_model_the_plain_words_stand(store: Store, audit: Audit) -> None:
    facts = facts_for(store, audit, "-5")
    plan = profile.current(store)[1]

    def broken(_s: str, _t: str, _shape: dict[str, Any]) -> dict[str, Any]:
        raise SignalError("No key")

    message = coach.message(facts, plan, "", None, broken)
    assert message["source"] == "plain"
    empty = coach.message(facts, plan, "", None, lambda _s, _t, _shape: {"lines": [], "coach": ""})
    assert empty["source"] == "plain"


# The agents.


def test_every_agent_reads_the_plan_and_answers_with_a_placeholder(
    store: Store, audit: Audit
) -> None:
    plan_with(store, audit)
    team = agents.listing()["agents"]
    assert [a["title"] for a in team] == [
        "Desk Coordinator",
        "Risk Officer",
        "Market Researcher",
        "Technical Analyst",
        "Tax Specialist (AU)",
    ]
    assert {a["reportsTo"] for a in team[1:]} == {"desk"}  # the specialists report to Morgan
    for persona in agents.PERSONAS:
        told = agents.instructions(store, persona)
        assert "No FOMO" in told
        assert "break one of its rules" in told
    thread = agents.send(store, audit, "risk", {"text": "  Should I add TAO? "})
    assert [m["text"] for m in thread["messages"]] == [
        "Should I add TAO?",
        "Riley will answer here soon.",
    ]
    assert agents.send(store, audit, "desk", {"text": "Hi"})["messages"][-1]["text"] == (
        "Morgan will answer here soon."
    )
    assert agents.thread(store, "risk")["messages"][0]["role"] == "owner"
    with pytest.raises(Refused):
        agents.send(store, audit, "oracle", {"text": "Hi"})


# The routes.


@pytest.fixture
def call(tmp_path: Path, store: Store, audit: Audit, monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    binance = Binance(
        httpx.Client(base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)),
        ("k", "s"),
        audit,
    )
    report: dict[str, Any] = {"fy": "2026-27", "total": {"aud": "900"}, "months": []}

    def deposits(_s: Services, _q: dict[str, str]) -> dict[str, Any]:
        return report

    monkeypatch.setattr(handler, "_deposits", deposits)
    written: list[str] = []

    def ask(_s: str, _t: str, _shape: dict[str, Any]) -> tuple[dict[str, Any], Decimal]:
        written.append("asked")
        return {"lines": ["A calm line."], "coach": "Under your cap."}, D(0)

    @contextmanager
    def factory() -> Generator[Services]:
        yield Services(
            binance, store, Signals(ask, store, audit), audit, portfolio=lambda: portfolio("-5")
        )  # noqa: E501

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
        result = handler.handler(event, None, trading=trading, services=factory)
        return int(str(result["statusCode"])), json.loads(str(result["body"]))

    send.written = written  # type: ignore[attr-defined]
    return send


def test_the_routes_serve_the_coach_plan_agents_and_name(call: Any) -> None:
    assert call("PUT", "/settings/profile", {"name": "Sam"})[0] == 404  # noqa: PLR2004 - the Profile's
    assert call("PUT", "/profile/strategy", {"value": {}})[0] == 404  # noqa: PLR2004 - no form edits
    status, dashboard = call("GET", "/coach")
    assert status == 200  # noqa: PLR2004
    assert dashboard["greeting"].endswith(".")  # the Profile's name, when its file has one
    assert (dashboard["mood"], dashboard["pending"]) == ("down", True)
    assert dashboard["message"]["source"] == "plain"
    assert call.written == []  # the GET never waits on the model
    status, dashboard = call("POST", "/coach/message")
    assert (dashboard["message"]["lines"][0], dashboard["pending"]) == ("A calm line.", False)
    assert call("GET", "/coach")[1]["pending"] is False  # kept for today and this mood
    assert call.written == ["asked"]
    status, dashboard = call("GET", "/coach")
    assert dashboard["pending"] is False
    assert call.written == ["asked"]
    assert call("POST", "/agents/research", {"text": "Rates?"})[1]["messages"][-1]["text"] == (
        "Quinn will answer here soon."
    )
    assert call("GET", "/agents")[1]["agents"][0]["name"] == "Morgan"
    assert call("PUT", "/risk", {"maxCoinPct": "30"})[0] == 404  # noqa: PLR2004 - rules live on the Profile


def test_a_failed_wording_is_not_kept_so_it_is_tried_again(
    call: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    def failing(*_: Any) -> dict[str, Any]:
        raise SignalError("No key")

    monkeypatch.setattr(Signals, "write", failing)
    assert call("POST", "/coach/message")[1]["message"]["source"] == "plain"
    assert call("GET", "/coach")[1]["pending"] is True  # asked again on the next visit
