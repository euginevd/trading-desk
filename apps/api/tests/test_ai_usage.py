"""The subscription's usage (decision 102): the plan's windows for the whole account, and this
app's own runs, kept apart."""

from collections.abc import AsyncGenerator
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from api import ai_usage
from api.ai_client import subscription
from api.ai_signal import SignalError
from api.store import Store
from claude_agent_sdk import RateLimitEvent, RateLimitInfo, ResultMessage

OAUTH = "made-up-oauth-value"
PLAN = {"action": "Wait", "confidence": 60}
SHAPE = {"type": "object"}


class FakeQuery:
    """Stands in for claude_agent_sdk.query, replaying messages."""

    def __init__(self, *messages: Any) -> None:
        self.messages = messages

    async def __call__(self, **_: Any) -> AsyncGenerator[Any]:
        for message in self.messages:
            yield message


NOON = datetime.fromisoformat("2026-11-24T12:00:00+11:00").timestamp()
RESETS = int(NOON) + 3 * 3600
WEEK = int(NOON) + 3 * 86400


def limit(status: str = "allowed") -> RateLimitEvent:
    raw = {
        "status": status,
        "rateLimitType": "five_hour",
        "unifiedWindows": {
            "five_hour": {"utilization": 0.9, "resetsAt": RESETS, "status": status},
            "seven_day": {"utilization": 0.22, "resetsAt": WEEK, "status": "allowed"},
        },
    }
    info = RateLimitInfo(status=status, resets_at=RESETS, rate_limit_type="five_hour", raw=raw)  # type: ignore[arg-type]
    return RateLimitEvent(info, "u", "s")


def answered(cost: float = 0.18) -> ResultMessage:
    return ResultMessage(
        subtype="success",
        duration_ms=1,
        duration_api_ms=1,
        is_error=False,
        num_turns=2,
        session_id="s",
        structured_output=PLAN,
        total_cost_usd=cost,
        usage={
            "input_tokens": 9000,
            "output_tokens": 1000,
            "cache_read_input_tokens": 1500,
            "cache_creation_input_tokens": 500,
        },
    )


@pytest.fixture
def store(tmp_path: Path) -> Store:
    return Store(tmp_path / "desk.sqlite")


def test_a_run_keeps_the_plans_windows_and_counts_this_apps_tokens(
    monkeypatch: pytest.MonkeyPatch, store: Store
) -> None:
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    record = ai_usage.recorder(store, lambda: NOON)
    ask = subscription(FakeQuery(limit(), answered()), record=record)
    ask("system", "the facts", SHAPE)
    ask("system", "the facts", SHAPE)
    shown = ai_usage.view(store, lambda: NOON)
    assert [(w["name"], w["used"], w["resetsAt"]) for w in shown["windows"]] == [
        ("5-hour", 90, RESETS * 1000),
        ("Weekly", 22, WEEK * 1000),
    ]
    assert shown["checkedAt"] == int(NOON * 1000)
    assert shown["today"] == {"runs": 2, "tokens": 24000, "apiCost": "0.36"}
    assert shown["month"] == shown["today"]


def test_a_run_refused_at_the_limit_still_shows_the_limit_but_counts_no_run(
    monkeypatch: pytest.MonkeyPatch, store: Store
) -> None:
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    ask = subscription(FakeQuery(limit("rejected")), record=ai_usage.recorder(store, lambda: NOON))
    with pytest.raises(SignalError, match="usage limit"):
        ask("system", "the facts", SHAPE)
    shown = ai_usage.view(store, lambda: NOON)
    assert shown["windows"][0]["status"] == "rejected"
    assert shown["today"]["runs"] == 0


def test_a_window_that_has_reset_since_is_unknown_not_full(store: Store) -> None:
    ai_usage.recorder(store, lambda: NOON)({"windows": ai_usage.windows(limit().rate_limit_info)})
    later = ai_usage.view(store, lambda: RESETS + 60)
    assert later["windows"][0] == {
        "kind": "five_hour",
        "name": "5-hour",
        "used": None,
        "resetsAt": None,
        "status": "allowed",
    }
    assert later["windows"][1]["used"] == 22  # the week hasn't reset


def test_a_new_day_and_month_start_from_nothing(store: Store) -> None:
    ai_usage.recorder(store, lambda: NOON)({"tokens": 100, "apiCost": 0.01})
    next_month = datetime.fromisoformat("2026-12-01T09:00:00+11:00").timestamp()
    shown = ai_usage.view(store, lambda: next_month)
    assert shown["today"]["runs"] == 0
    assert shown["month"]["runs"] == 0


def test_an_event_without_its_raw_windows_gives_the_one_it_names() -> None:
    info = RateLimitInfo(
        status="allowed_warning", resets_at=RESETS, rate_limit_type="seven_day", utilization=0.81
    )
    assert ai_usage.windows(info) == {
        "seven_day": {"used": 0.81, "resetsAt": RESETS, "status": "allowed_warning"}
    }


def test_a_failing_count_never_fails_the_plan(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)

    def broken(_seen: dict[str, Any]) -> None:
        raise OSError("disk full")

    reply, _ = subscription(FakeQuery(answered()), record=broken)("system", "the facts", SHAPE)
    assert reply["action"] == PLAN["action"]


def test_the_api_key_counts_each_billed_run_even_one_it_couldnt_use(store: Store) -> None:
    from api.ai_signal import claude  # noqa: PLC0415

    class Usage:
        input_tokens = 1_000_000
        output_tokens = 1_000_000
        server_tool_use = None

    class Reply:
        stop_reason = "end_turn"
        usage = Usage()
        content = [type("Text", (), {"type": "text", "text": "not JSON"})()]

    class Messages:
        def create(self, **_request: Any) -> Reply:
            return Reply()

    client = type("Client", (), {"beta": type("Beta", (), {"messages": Messages()})()})()
    record = ai_usage.recorder(store, lambda: NOON, source="api")
    with pytest.raises(SignalError, match="expected shape"):
        claude(client, lambda: "claude-haiku-5-5", lambda: "low", record)("s", "t", SHAPE)
    shown = ai_usage.app(store, "api", lambda: NOON)
    assert shown["today"] == {"runs": 1, "tokens": 2_000_000, "apiCost": "0.60"}
    assert ai_usage.view(store, lambda: NOON)["today"]["runs"] == 0  # the subscription's apart


def test_the_desk_counts_each_source_and_settings_shows_both(
    monkeypatch: pytest.MonkeyPatch, store: Store, tmp_path: Path
) -> None:
    """The wiring: the handler's Ask records each source, and /settings/ai shows both."""
    from decimal import Decimal  # noqa: PLC0415

    from api import ai_client, handler  # noqa: PLC0415
    from api.ai_signal import Signals  # noqa: PLC0415
    from api.audit import Audit  # noqa: PLC0415

    def fake_subscription(**kw: Any) -> Any:
        def ask(*_: Any) -> tuple[dict[str, Any], Decimal]:
            kw["record"]({"tokens": 5, "apiCost": 0})
            return dict(PLAN), Decimal(0)

        return ask

    def fake_claude(_client: Any, _model: Any, _effort: Any, record: Any) -> Any:
        def ask(*_: Any) -> tuple[dict[str, Any], Decimal]:
            record({"tokens": 7, "apiCost": Decimal("0.1")})
            return dict(PLAN), Decimal("0.1")

        return ask

    monkeypatch.setattr(handler, "_demo", lambda: False)
    monkeypatch.setattr(handler, "subscription", fake_subscription)
    monkeypatch.setattr(handler, "claude", fake_claude)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "made-up-key")
    store.set_setting(ai_client.MODE_KEY, "subscription")
    handler._ask(store)("s", "t", SHAPE)  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    store.set_setting(ai_client.MODE_KEY, "api_key")
    handler._ask(store)("s", "t", SHAPE)  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]

    def unused(*_: str | dict[str, Any]) -> tuple[dict[str, Any], Decimal]:
        return dict(PLAN), Decimal(0)

    signals = Signals(unused, store, Audit(tmp_path / "a.jsonl"))
    shown = ai_client.view(store, signals)
    assert shown["usage"]["today"]["tokens"] == 5
    assert shown["apiUsage"]["today"] == {"runs": 1, "tokens": 7, "apiCost": "0.10"}
