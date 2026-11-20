"""The AI provider switch (decision 48): API key or the owner's Claude subscription."""

import asyncio
import dataclasses
from collections.abc import AsyncGenerator
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from api import ai_client
from api.ai_client import subscription, switched
from api.ai_signal import Ask, SignalError, Signals
from api.audit import Audit
from api.store import Store
from api.trading import Refused
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    RateLimitEvent,
    RateLimitInfo,
    ResultMessage,
)

OAUTH = "made-up-oauth-value"
PLAN = {"action": "Wait", "confidence": 60}
SHAPE = {"type": "object"}


def result(**fields: Any) -> ResultMessage:
    base: dict[str, Any] = {
        "subtype": "success",
        "duration_ms": 1,
        "duration_api_ms": 1,
        "is_error": False,
        "num_turns": 2,
        "session_id": "s",
        "structured_output": PLAN,
    }
    return ResultMessage(**(base | fields))


class FakeQuery:
    """Stands in for claude_agent_sdk.query: records the options, replays messages."""

    def __init__(self, *messages: Any) -> None:
        self.messages = messages
        self.options: ClaudeAgentOptions | None = None

    async def __call__(self, *, prompt: str, options: ClaudeAgentOptions) -> AsyncGenerator[Any]:
        assert prompt == "the facts"
        self.options = options
        for message in self.messages:
            yield message


def api_ask(calls: list[str]) -> Ask:
    def ask(_system: str, _text: str, _shape: dict[str, Any]) -> tuple[dict[str, Any], Decimal]:
        calls.append("api")
        return dict(PLAN), Decimal("0.2")

    return ask


@pytest.fixture(autouse=True)
def env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in ("AI_AUTH_MODE", "AI_FALLBACK_TO_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_the_api_key_is_the_default_and_an_unknown_mode_falls_back_to_it(
    env: pytest.MonkeyPatch,
) -> None:
    assert ai_client.mode() == "api_key"
    env.setenv("AI_AUTH_MODE", "free")
    assert ai_client.mode() == "api_key"
    env.setenv("AI_AUTH_MODE", " Subscription ")
    assert ai_client.mode() == "subscription"


def test_the_mode_is_read_at_each_call_and_the_reply_names_its_source(
    env: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    query = FakeQuery(result())
    ask = switched(lambda: api_ask(calls), subscription(query))
    reply, cost = ask("system", "the facts", SHAPE)
    assert (reply["_via"], cost, calls) == ("API key", Decimal("0.2"), ["api"])
    env.setenv("AI_AUTH_MODE", "subscription")
    env.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    reply, cost = ask("system", "the facts", SHAPE)
    assert reply == PLAN | {"_via": "Claude subscription", "_model": "claude-opus-5-5"}
    assert cost == 0  # the plan's usage, not the API bill
    assert calls == ["api"]


def test_the_subscription_sees_the_token_and_no_other_secret(env: pytest.MonkeyPatch) -> None:
    env.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    for name in ("ANTHROPIC_API_KEY", "BINANCE_API_KEY", "BINANCE_API_SECRET", "TAOSTATS_API_KEY"):
        env.setenv(name, "made-up-secret")
    query = FakeQuery(result())
    subscription(query)("system", "the facts", SHAPE)
    options = query.options
    assert options is not None
    assert options.env["CLAUDE_CODE_OAUTH_TOKEN"] == OAUTH
    for name in ("ANTHROPIC_API_KEY", "BINANCE_API_KEY", "BINANCE_API_SECRET", "TAOSTATS_API_KEY"):
        assert options.env[name] == ""
    assert options.tools == ["WebSearch"]  # nothing that reads files or runs commands
    assert options.setting_sources == []
    assert options.output_format == {"type": "json_schema", "schema": SHAPE}
    assert options.env["HOME"] == options.cwd  # a throwaway home


def test_a_missing_token_says_how_to_get_one() -> None:
    with pytest.raises(SignalError, match="claude setup-token"):
        subscription(FakeQuery(result()))("system", "the facts", SHAPE)


@pytest.mark.parametrize(
    ("messages", "words"),
    [
        (
            [RateLimitEvent(RateLimitInfo(status="rejected", resets_at=1_794_000_000), "u", "s")],
            "usage limit is reached. It resets at 8:20 am, 7 Nov",
        ),
        ([AssistantMessage([], "m", error="rate_limit")], "usage limit is reached"),
        ([AssistantMessage([], "m", error="authentication_failed")], "claude setup-token"),
        ([AssistantMessage([], "m", error="billing_error")], "Check your plan"),
        ([result(is_error=True, subtype="error_max_turns")], "error_max_turns"),
        ([result(structured_output="not json")], "expected shape"),
        ([], "no answer"),
    ],
)
def test_each_failure_says_what_to_do(
    env: pytest.MonkeyPatch, messages: list[Any], words: str
) -> None:
    env.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    with pytest.raises(SignalError, match=words) as caught:
        subscription(FakeQuery(*messages))("system", "the facts", SHAPE)
    assert OAUTH not in str(caught.value)


def test_a_failed_subscription_uses_the_api_key_only_when_allowed(
    env: pytest.MonkeyPatch,
) -> None:
    env.setenv("AI_AUTH_MODE", "subscription")
    env.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    calls: list[str] = []
    failing = subscription(FakeQuery(AssistantMessage([], "m", error="rate_limit")))
    ask = switched(lambda: api_ask(calls), failing)
    with pytest.raises(SignalError, match="usage limit"):
        ask("system", "the facts", SHAPE)
    assert calls == []
    env.setenv("AI_FALLBACK_TO_API_KEY", "1")
    reply, _ = ask("system", "the facts", SHAPE)
    assert reply["_via"] == "API key (the subscription failed)"
    assert calls == ["api"]


def test_every_secret_looking_variable_is_blanked_for_claude_code(
    env: pytest.MonkeyPatch,
) -> None:
    env.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    env.setenv("AWS_SECRET_ACCESS_KEY", "made-up-aws")
    env.setenv("GITHUB_TOKEN", "made-up-github")
    env.setenv("SOME_NEW_PASSWORD", "made-up")
    query = FakeQuery(result())
    subscription(query)("system", "the facts", SHAPE)
    assert query.options is not None
    passed = query.options.env
    for name in ("AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "SOME_NEW_PASSWORD", "TAO_COLDKEY"):
        assert passed[name] == ""
    assert passed["CLAUDE_CODE_OAUTH_TOKEN"] == OAUTH


def test_the_claude_code_command_allows_web_search_and_nothing_else(
    env: pytest.MonkeyPatch,
) -> None:
    from claude_agent_sdk._internal.transport.subprocess_cli import (  # noqa: PLC0415
        SubprocessCLITransport,
    )

    env.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    query = FakeQuery(result())
    subscription(query)("system", "the facts", SHAPE)
    assert query.options is not None
    options = dataclasses.replace(query.options, cli_path="claude")
    transport = SubprocessCLITransport(prompt="x", options=options)
    command = transport._build_command()  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    joined = " ".join(command)
    assert "--tools WebSearch" in joined
    assert "--permission-mode dontAsk" in joined
    assert "--setting-sources=" in command or "--setting-sources" in command
    assert "--strict-mcp-config" in command
    assert "--mcp-config" not in command
    assert OAUTH not in joined  # the token goes by environment, not the command line


class Broken:
    """A query that fails partway, as the SDK or the CLI can."""

    def __init__(self, error: Exception) -> None:
        self.error = error

    async def __call__(self, **_: Any) -> AsyncGenerator[Any]:
        raise self.error
        yield  # pragma: no cover - makes this an async generator


def test_sdk_failures_become_words_without_the_token(env: pytest.MonkeyPatch) -> None:
    from claude_agent_sdk import ClaudeSDKError, CLINotFoundError  # noqa: PLC0415

    env.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    cases = [
        (CLINotFoundError("gone"), "isn't installed"),
        (ClaudeSDKError(f"exit 1 with {OAUTH}"), "Claude Code stopped"),
        (ExceptionGroup("tasks", [ValueError(f"bad {OAUTH}")]), "Claude Code failed"),
    ]
    for error, words in cases:
        with pytest.raises(SignalError, match=words) as caught:
            subscription(Broken(error))("system", "the facts", SHAPE)
        assert OAUTH not in str(caught.value)


def test_a_slow_run_times_out(env: pytest.MonkeyPatch) -> None:
    env.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    env.setattr(ai_client, "TIMEOUT_SECONDS", 0.05)

    async def slow(**_: Any) -> AsyncGenerator[Any]:
        await asyncio.sleep(5)
        yield result()

    with pytest.raises(SignalError, match="too long"):
        subscription(slow)("system", "the facts", SHAPE)


def test_a_missing_token_falls_back_when_allowed(env: pytest.MonkeyPatch) -> None:
    env.setenv("AI_AUTH_MODE", "subscription")
    env.setenv("AI_FALLBACK_TO_API_KEY", "1")
    calls: list[str] = []
    reply, _ = switched(lambda: api_ask(calls), subscription(FakeQuery()))("s", "the facts", SHAPE)
    assert reply["_via"] == "API key (the subscription failed)"
    assert calls == ["api"]


def test_the_api_cap_skips_a_subscription_run_that_cannot_fall_back(
    env: pytest.MonkeyPatch,
) -> None:
    assert ai_client.capped()
    env.setenv("AI_AUTH_MODE", "subscription")
    assert not ai_client.capped()
    env.setenv("AI_FALLBACK_TO_API_KEY", "1")
    assert ai_client.capped()


def test_the_settings_choice_overrides_env_and_shows_no_secret(
    env: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    store = Store(tmp_path / "desk.sqlite")
    audit = Audit(tmp_path / "audit.jsonl")
    signals = Signals(api_ask([]), store, audit)
    env.setenv("ANTHROPIC_API_KEY", "made-up-key")
    try:
        assert ai_client.view(store, signals)["mode"] == "api_key"
        assert ai_client.view(store, signals)["effort"] == "medium"  # said on Settings
        shown = ai_client.choose(store, audit, signals, {"mode": "subscription", "fallback": False})
        assert shown["mode"] == "subscription"
        assert ai_client.mode(store) == "subscription"
        assert not ai_client.capped(store)
        assert shown["apiKeySet"] is True
        assert shown["tokenSet"] is False
        assert "made-up-key" not in str(shown)
        env.setenv("AI_AUTH_MODE", "api_key")  # the page's choice wins over .env
        assert ai_client.mode(store) == "subscription"
        lines = (tmp_path / "audit.jsonl").read_text(encoding="utf-8")
        assert "Set to Claude subscription" in lines
        with pytest.raises(Refused):
            ai_client.choose(store, audit, signals, {"mode": "free", "fallback": False})
    finally:
        store.close()


def test_the_model_is_chosen_on_settings_priced_and_passed_on(
    env: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from api.ai_signal import claude, usage_cost  # noqa: PLC0415

    store = Store(tmp_path / "desk.sqlite")
    audit = Audit(tmp_path / "audit.jsonl")
    signals = Signals(api_ask([]), store, audit)
    try:
        assert ai_client.model(store) == "claude-opus-5-5"
        shown = ai_client.choose(
            store,
            audit,
            signals,
            {"mode": "api_key", "fallback": False, "model": "claude-haiku-5-5"},
        )
        assert shown["model"] == "claude-haiku-5-5"
        assert {m["name"] for m in shown["models"]} == {
            "Claude Opus 5.5",
            "Claude Sonnet 5.5",
            "Claude Haiku 5.5",
        }
        with pytest.raises(Refused):
            ai_client.choose(
                store, audit, signals, {"mode": "api_key", "fallback": False, "model": "gpt"}
            )
    finally:
        store.close()

    class Usage:
        input_tokens = 1_000_000
        output_tokens = 1_000_000
        server_tool_use = None

    assert usage_cost(Usage(), "claude-haiku-5-5") == Decimal("0.6")
    assert usage_cost(Usage(), "claude-sonnet-5-5") == Decimal(12)

    sent: dict[str, Any] = {}

    class Reply:
        stop_reason = "end_turn"
        usage = Usage()
        content = [type("Text", (), {"type": "text", "text": '{"action": "Wait"}'})()]

    class Messages:
        def create(self, **request: Any) -> Reply:
            sent.update(request)
            return Reply()

    client = type("Client", (), {"beta": type("Beta", (), {"messages": Messages()})()})()
    reply, _ = claude(client, lambda: "claude-haiku-5-5")("system", "the facts", SHAPE)
    assert sent["model"] == "claude-haiku-5-5"
    assert sent["tools"][0]["type"] == "web_search_20250305"  # Haiku's search tool
    assert reply["_model"] == "claude-haiku-5-5"

    env.setenv("CLAUDE_CODE_OAUTH_TOKEN", OAUTH)
    query = FakeQuery(result())
    subscription(query, model=lambda: "claude-sonnet-5-5")("system", "the facts", SHAPE)
    assert query.options is not None
    assert query.options.model == "claude-sonnet-5-5"
