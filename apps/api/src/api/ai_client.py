"""How the AI plan reaches Claude (TODO 4, decisions 48 and 50), read at every call: the
choice on the Settings page, else `AI_AUTH_MODE` in `.env`:

- `api_key` (the default): the Anthropic API, paid per use (decision 16).
- `subscription`: the owner's Claude plan, through the Claude Agent SDK and
  `CLAUDE_CODE_OAUTH_TOKEN`, for the owner's own testing.

The subscription's Claude Code process gets the token and no other secret: the API key and the
exchange keys are blanked in its environment, it may only search the web, and it runs in a
throwaway home that's deleted afterwards. The token is never logged, stored or sent to the desk.
"""

import asyncio
import contextlib
import os
import re
import tempfile
from collections.abc import AsyncGenerator, Callable
from datetime import datetime
from decimal import Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

from api.ai_signal import EFFORT, MODEL, MODELS, STEP, Ask, SignalError, Signals, chosen_model
from api.audit import Audit
from api.store import Store
from api.trading import Refused

API_KEY = "api_key"
SUBSCRIPTION = "subscription"
SOURCE = {API_KEY: "API key", SUBSCRIPTION: "Claude subscription"}
# Blanked for the subscription's process, so it can't use or see them: these by name, and any
# other variable whose name looks secret (an AWS key, a GitHub token, one added to .env later).
SECRETS = ("ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID", "TAO_COLDKEY")
SECRET_NAME = re.compile(r"KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|COLDKEY|AUTH", re.IGNORECASE)
SYDNEY = ZoneInfo("Australia/Sydney")
TIMEOUT_SECONDS = 180  # a plan with searches takes a minute or two; nginx waits 400 s

Query = Callable[..., AsyncGenerator[Any]]


MODE_KEY = "ai_auth_mode"
FALLBACK_KEY = "ai_fallback"
MODEL_KEY = "ai_model"


def model(store: Store | None = None) -> str:
    """The Settings page's model, else `AI_MODEL` in `.env`, else Claude Opus 5.5."""
    saved = store.setting(MODEL_KEY, "") if store else ""
    chosen = saved or os.environ.get("AI_MODEL", MODEL).strip()
    return chosen if chosen in MODELS else MODEL


def mode(store: Store | None = None) -> str:
    """The Settings page's choice, else `.env`'s, else the API key."""
    saved = store.setting(MODE_KEY, "") if store else ""
    chosen = saved or os.environ.get("AI_AUTH_MODE", API_KEY).strip().lower()
    return chosen if chosen in SOURCE else API_KEY


def _fallback(store: Store | None = None) -> bool:
    saved = store.setting(FALLBACK_KEY, "") if store else ""
    return (saved or os.environ.get("AI_FALLBACK_TO_API_KEY", "0").strip()) == "1"


def capped(store: Store | None = None) -> bool:
    """Whether the monthly API cap applies: not to a subscription run that can't fall back."""
    return mode(store) != SUBSCRIPTION or _fallback(store)


def view(store: Store, signals: Signals) -> dict[str, Any]:
    """The Settings page's AI section: the choice and whether each credential is set, never
    the credential itself."""
    return {
        "mode": mode(store),
        "fallback": _fallback(store),
        "apiKeySet": bool(os.environ.get("ANTHROPIC_API_KEY", "").strip()),
        "tokenSet": bool(os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "").strip()),
        "model": model(store),
        "models": [{"id": key, "name": m.name} for key, m in MODELS.items()],
        "effort": EFFORT,
        "budget": signals.budget(),
    }


def choose(store: Store, audit: Audit, signals: Signals, body: dict[str, Any]) -> dict[str, Any]:
    chosen, fallback = body.get("mode"), body.get("fallback")
    if chosen not in SOURCE or not isinstance(fallback, bool):
        raise Refused("Choose api_key or subscription, and whether to fall back.")
    picked = body.get("model", model(store))
    if picked not in MODELS:
        raise Refused("Choose one of the listed models.")
    store.set_setting(MODEL_KEY, str(picked))
    store.set_setting(MODE_KEY, str(chosen))
    store.set_setting(FALLBACK_KEY, "1" if fallback else "0")
    back = ", falling back to the API key" if fallback and chosen == SUBSCRIPTION else ""
    audit.record(
        "settings", "AI provider", f"Set to {SOURCE[str(chosen)]}{back}, {MODELS[str(picked)].name}"
    )
    return view(store, signals)


def switched(api: Callable[[], Ask], subscription: Ask, store: Store | None = None) -> Ask:
    """One Ask for the plan, whichever way it goes; its reply names the source in `_via`."""

    def ask(system: str, text: str, shape: dict[str, Any]) -> tuple[dict[str, Any], Decimal]:
        if mode(store) == SUBSCRIPTION:
            try:
                reply, cost = subscription(system, text, shape)
            except SignalError:
                if not _fallback(store):
                    raise
                reply, cost = api()(system, text, shape)
                return reply | {"_via": "API key (the subscription failed)"}, cost
            return reply | {"_via": SOURCE[SUBSCRIPTION]}, cost
        reply, cost = api()(system, text, shape)
        return reply | {"_via": SOURCE[API_KEY]}, cost

    return ask


def subscription(query: Query | None = None, model: Callable[[], str] = lambda: MODEL) -> Ask:
    """The plan through the owner's Claude subscription. Costs nothing per call; it counts
    against the plan's usage limits instead."""

    def ask(system: str, text: str, shape: dict[str, Any]) -> tuple[dict[str, Any], Decimal]:
        token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "").strip()
        if not token:
            raise SignalError(
                "Add CLAUDE_CODE_OAUTH_TOKEN to .env (run `claude setup-token`) "
                "to use your Claude subscription."
            )
        try:
            chosen = chosen_model(model)
            run = asyncio.wait_for(_run(query, system, text, shape, token, chosen), TIMEOUT_SECONDS)
            return asyncio.run(run) | {"_model": chosen}, Decimal(0)
        except TimeoutError:
            raise SignalError("Claude took too long through the subscription. Re-run it.") from None
        except SignalError as error:
            raise SignalError(str(error).replace(token, "[token]")) from None
        except Exception as error:  # noqa: BLE001 - any other failure is a failed run, in words
            detail = " ".join(str(error).replace(token, "[token]").split())[:200]
            raise SignalError(f"Claude Code failed: {detail or type(error).__name__}") from None

    return ask


def _env(token: str, home: str) -> dict[str, str]:
    hidden = {name for name in os.environ if SECRET_NAME.search(name)} | set(SECRETS)
    return dict.fromkeys(sorted(hidden), "") | {
        "CLAUDE_CODE_OAUTH_TOKEN": token,
        "HOME": home,
        "CLAUDE_CONFIG_DIR": home,
        "DISABLE_AUTOUPDATER": "1",
        "DISABLE_TELEMETRY": "1",
        "DISABLE_ERROR_REPORTING": "1",
    }


async def _run(  # noqa: PLR0913, PLR0917 - the call's parts, each needed
    query: Query | None, system: str, text: str, shape: dict[str, Any], token: str, model: str
) -> dict[str, Any]:
    import claude_agent_sdk as sdk  # noqa: PLC0415 - only loaded for the subscription

    run = query or cast(Query, sdk.query)
    searches = STEP.get().searches
    tools = ["WebSearch"] if searches > 0 else []
    with tempfile.TemporaryDirectory(prefix="desk-claude-", ignore_cleanup_errors=True) as home:
        options = sdk.ClaudeAgentOptions(
            system_prompt=system,
            model=model,
            tools=tools,
            allowed_tools=tools,
            permission_mode="dontAsk",
            setting_sources=[],
            strict_mcp_config=True,
            max_turns=searches + 4,
            effort=EFFORT,
            output_format={"type": "json_schema", "schema": shape},
            cwd=home,
            env=_env(token, home),
            stderr=lambda _line: None,  # the CLI's own output stays out of the api's log
        )
        result: Any = None
        error: str | None = None
        limit: Any = None
        try:
            async with contextlib.aclosing(run(prompt=text, options=options)) as messages:
                async for message in messages:
                    if isinstance(message, sdk.AssistantMessage) and message.error:
                        error = message.error
                    elif isinstance(message, sdk.RateLimitEvent):
                        if message.rate_limit_info.status == "rejected":
                            limit = message.rate_limit_info
                    elif isinstance(message, sdk.ResultMessage):
                        result = message
        except sdk.CLINotFoundError as failure:
            raise SignalError("Claude Code isn't installed in the api image.") from failure
        except sdk.ClaudeSDKError as failure:
            if error is None and limit is None:
                detail = " ".join(str(failure).split())[:200]
                raise SignalError(f"Claude Code stopped: {detail}") from failure
    return _structured(result, error, limit)


def _structured(result: Any, error: str | None, limit: Any) -> dict[str, Any]:
    """The plan from the result, or the reason there isn't one, in words the owner can act on."""
    if limit is not None or error == "rate_limit":
        resets = getattr(limit, "resets_at", None)
        at = datetime.fromtimestamp(resets, SYDNEY) if resets else None
        when = f" It resets at {at:%I:%M} {at:%p}, {at.day} {at:%b}." if at else ""
        when = when.replace(" 0", " ").replace("AM", "am").replace("PM", "pm")
        raise SignalError(f"Your Claude plan's usage limit is reached.{when}")
    if error == "authentication_failed":
        raise SignalError(
            "Claude refused the subscription token. Run `claude setup-token` again "
            "and update CLAUDE_CODE_OAUTH_TOKEN."
        )
    if error == "billing_error":
        raise SignalError("Your Claude plan can't take this request. Check your plan.")
    if result is None or result.is_error:
        why = getattr(result, "subtype", None) or error or "no answer"
        raise SignalError(f"Claude didn't finish the plan ({why}). Re-run it.")
    reply = result.structured_output
    if not isinstance(reply, dict):
        raise SignalError("Claude's answer wasn't in the expected shape. Re-run it.")
    return dict(reply)  # pyright: ignore[reportUnknownArgumentType]
