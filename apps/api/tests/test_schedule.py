import json
from collections.abc import Generator, Iterator
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from api import demo, jobs, schedule, telegram
from api.audit import Audit
from api.binance import Binance
from api.handler import Services
from api.pot import Pot
from api.store import Store
from api.trading import Trading

SYDNEY = schedule.SYDNEY
TUESDAY_NOON = datetime(2026, 11, 17, 12, 0, tzinfo=SYDNEY)
NOW = TUESDAY_NOON.timestamp()


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    found = Store(tmp_path / "desk.sqlite")
    yield found
    found.close()


def test_each_job_has_a_slot_in_sydney_time() -> None:
    scan, deposit, close, *_ = schedule.JOBS
    assert schedule.slot(scan, TUESDAY_NOON) == TUESDAY_NOON.replace(hour=11, minute=15)
    early = TUESDAY_NOON.replace(hour=9)
    assert schedule.slot(scan, early) == early.replace(hour=11, minute=15) - timedelta(days=1)
    assert schedule.slot(deposit, TUESDAY_NOON) == datetime(2026, 11, 13, 19, 0, tzinfo=SYDNEY)
    assert schedule.slot(close, TUESDAY_NOON) == datetime(2026, 11, 16, 17, 0, tzinfo=SYDNEY)
    assert schedule.next_slot(close, TUESDAY_NOON) == datetime(2026, 11, 23, 17, 0, tzinfo=SYDNEY)
    assert [j.when() for j in schedule.JOBS] == [
        "Daily 11:15am",
        "Friday 7pm",
        "Monday 5pm",
        "Daily 9pm",
        "Sunday 6pm",
    ]


def test_a_slot_runs_once_within_its_grace_and_never_when_off(store: Store) -> None:
    calls: list[str] = []
    logged: list[str] = []

    def runner() -> str:
        calls.append("scan")
        return "No setup today."

    def broken() -> str:
        raise RuntimeError("model down")

    run = {"pot-scan": runner}

    def log(what: str, line: str) -> None:
        logged.append(f"{what}: {line}")

    assert schedule.run_due(store, run, TUESDAY_NOON, log) == ["pot-scan"]
    assert schedule.run_due(store, run, TUESDAY_NOON + timedelta(minutes=1), log) == []
    assert calls == ["scan"]
    assert logged == ["trading-agent: the daily scan: No setup today."]
    # The desk was off past the grace: that day's slot is skipped, not run late.
    assert schedule.run_due(store, run, TUESDAY_NOON + timedelta(days=1, hours=4), log) == []
    schedule.set_on(store, on=False)
    assert schedule.run_due(store, run, TUESDAY_NOON + timedelta(days=2), log) == []
    schedule.set_on(store, on=True)
    assert schedule.run_due(store, {"pot-scan": broken}, TUESDAY_NOON + timedelta(days=2), log)
    shown = schedule.view(store, TUESDAY_NOON + timedelta(days=2))
    assert shown["on"] is True
    last = shown["jobs"][0]["last"]
    assert last["status"] == "failed"
    assert "model down" in last["line"]


def test_a_button_works_once_and_expires(store: Store) -> None:
    until = TUESDAY_NOON + timedelta(hours=1)
    token = schedule.offer(store, "pot-place", "p1", until, TUESDAY_NOON)
    assert len(token) >= 12
    assert schedule.take(store, token, TUESDAY_NOON) == {
        "kind": "pot-place",
        "arg": "p1",
        "until": int(until.timestamp() * 1000),
    }
    assert schedule.take(store, token, TUESDAY_NOON) is None  # used
    late = schedule.offer(store, "pot-dismiss", "p1", until, TUESDAY_NOON)
    assert schedule.take(store, late, until + timedelta(seconds=1)) is None  # expired
    assert schedule.take(store, "made-up", TUESDAY_NOON) is None


def test_only_the_owners_chat_can_press_a_button(
    store: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:test")
    store.set_setting(telegram.CHAT_KEY, "42")
    sent: list[dict[str, Any]] = []

    def reply(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        sent.append({"method": request.url.path.rsplit("/", 1)[-1], **body})

        def tap(n: int, chat: int, who: int) -> dict[str, Any]:
            return {
                "update_id": n,
                "callback_query": {
                    "id": f"t{n}",
                    "data": "tok",
                    "from": {"id": who},
                    "message": {"message_id": 7, "chat": {"id": chat}, "text": "SOL"},
                },
            }

        result = [tap(5, 42, 42), tap(6, 99, 99), tap(7, 42, 99)]
        return httpx.Response(200, json={"ok": True, "result": result})

    with httpx.Client(transport=httpx.MockTransport(reply)) as client:
        found = telegram.taps(store, client)
        assert [t["id"] for t in found] == ["t5"]
        assert store.setting(telegram.OFFSET_KEY, "") == "8"  # all three are read, once
        telegram.answer(store, client, found[0], "Dismissed.")
        msg = telegram.send(store, client, "Hello", [("Place it", "abc")])
    assert msg is None  # the mock's result is a list, not a message
    assert sent[0]["offset"] == 0
    assert sent[1] == {
        "method": "answerCallbackQuery",
        "callback_query_id": "t5",
        "text": "Dismissed.",
    }
    assert sent[2]["text"] == "SOL\n\nDismissed."
    assert sent[3]["reply_markup"] == {
        "inline_keyboard": [[{"text": "Place it", "callback_data": "abc"}]]
    }


@pytest.fixture
def services(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Services]:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)
    )
    audit = Audit(tmp_path / "audit.jsonl")
    store = Store(tmp_path / "desk.sqlite")
    binance = Binance(client, ("k", "s"), audit)
    Trading(binance, store, audit, clock=lambda: NOW).set_limits("100", "500")
    yield Services(binance, store, cast(Any, None), audit)
    store.close()


def test_a_button_places_trading_agents_setup_with_the_desks_checks(services: Services) -> None:
    pot = Pot(Trading(services.binance, services.store, services.audit))
    pot.put_in({"usdc": "100"})
    pot.set_proposals(
        [
            {
                "id": "p1",
                "coin": "SOL",
                "setup": "Pullback",
                "reason": "Back to its 20-day.",
                "entry": "200",
                "stop": "190",
                "target": "230",
            }
        ]
    )
    pot._regime = ("neutral", "")  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    said = jobs.act(services, {"kind": "pot-place", "arg": "p1"}, TUESDAY_NOON)
    assert said.startswith("Placed TRD-SOL-")
    assert jobs.act(services, {"kind": "pot-place", "arg": "p1"}, TUESDAY_NOON).startswith(
        "That setup is gone"
    )
    pot.set_proposals(
        [
            {
                "id": "p2",
                "coin": "SOL",
                "setup": "x",
                "reason": "",
                "entry": "200",
                "stop": "190",
                "target": "230",
            }
        ]
    )
    # A second SOL trade breaks a rule: the button answers with the desk's refusal.
    assert jobs.act(services, {"kind": "pot-place", "arg": "p2"}, TUESDAY_NOON) == (
        "Not done: A SOL trade is on already."
    )
    assert jobs.act(services, {"kind": "pot-dismiss", "arg": "p2"}, TUESDAY_NOON) == "Dismissed."


def test_the_close_out_button_stops_working_when_the_week_turns(services: Services) -> None:
    monday = datetime(2026, 11, 16, 17, 30, tzinfo=SYDNEY)
    assert jobs.close_out(services, monday).startswith("Every weekly limit filled")
    week = "26W46"
    said = jobs.act(services, {"kind": "dca-close-out", "arg": week}, monday + timedelta(hours=2))
    assert said.startswith("Too late")


def test_the_switch_routes_reach_the_scheduler(services: Services) -> None:
    """The persona routes (/agents/<name>) must not swallow the scheduler's."""
    from contextlib import contextmanager  # noqa: PLC0415

    from api.handler import handler  # noqa: PLC0415

    @contextmanager
    def factory() -> Generator[Services]:
        yield services

    def call(method: str, body: object = None) -> dict[str, Any]:
        event: dict[str, object] = {
            "rawPath": "/my-agents/schedule",
            "requestContext": {"http": {"method": method}},
            "body": json.dumps(body) if body is not None else None,
        }
        reply = handler(event, None, services=factory)
        return {"status": reply["statusCode"], **json.loads(str(reply["body"]))}

    assert call("GET")["on"] is True
    off = call("PUT", {"on": False})
    assert off["status"] == 200
    assert off["on"] is False
    assert [j["key"] for j in off["jobs"]] == [
        "pot-scan",
        "dca-deposit",
        "dca-close-out",
        "risk-check",
        "risk-review",
    ]
    assert call("PUT", {"on": "yes"})["status"] == 400
