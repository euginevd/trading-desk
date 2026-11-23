"""How much of Claude the desk uses, on the subscription or the API key (decision 102).

Two kinds of figure, kept apart because they mean different things:

- The plan's windows (5-hour, weekly): Anthropic's own share used, for the whole account, so
  Claude Code and claude.ai count too. Claude Code reports them on every run; the desk keeps the
  last it saw, so they're only as fresh as the desk's last run.
- This app's runs: each subscription run's tokens and what it would have cost on the API key, by
  Sydney day and month. Anthropic doesn't say how tokens turn into plan share, so these stay in
  tokens and dollars.
- On the API key, everything is this app's own: its runs, tokens and what Anthropic bills.
"""

import json
import threading
import time
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

from api.store import Store

SYDNEY = ZoneInfo("Australia/Sydney")
_LOCK = threading.Lock()
WINDOWS_KEY = "sub_windows"
NAMES = {
    "five_hour": "5-hour",
    "seven_day": "Weekly",
    "seven_day_opus": "Weekly, Opus",
    "seven_day_sonnet": "Weekly, Sonnet",
}
TOKEN_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)


def windows(info: Any) -> dict[str, dict[str, Any]]:
    """The plan's windows from one of Claude Code's rate limit events: all of them from its raw
    `unifiedWindows`, else the one window the event names."""
    raw = cast(dict[str, Any], getattr(info, "raw", None) or {})
    found: dict[str, dict[str, Any]] = {}
    unified = raw.get("unifiedWindows")
    if isinstance(unified, dict):
        for kind, window in cast(dict[str, Any], unified).items():
            if kind in NAMES and isinstance(window, dict):
                parts = cast(dict[str, Any], window)
                found[kind] = _window(
                    parts.get("utilization"), parts.get("resetsAt"), parts.get("status")
                )
    kind = getattr(info, "rate_limit_type", None)
    if not found and kind in NAMES:
        found[kind] = _window(info.utilization, info.resets_at, info.status)
    return found


def _window(used: Any, resets: Any, status: Any) -> dict[str, Any]:
    return {
        "used": float(used) if isinstance(used, int | float) else None,
        "resetsAt": int(resets) if isinstance(resets, int | float) else None,
        "status": str(status) if status else "allowed",
    }


def tokens(usage: Any) -> int:
    """Every token a run used: input, output and the cache's reads and writes."""
    if isinstance(usage, dict):
        counts = cast(dict[str, Any], usage)
        return sum(int(counts.get(name) or 0) for name in TOKEN_FIELDS)
    return sum(int(getattr(usage, name, 0) or 0) for name in TOKEN_FIELDS)


def recorder(
    store: Store, clock: Callable[[], float] = time.time, source: str = "sub"
) -> Callable[[dict[str, Any]], None]:
    """What a run calls with what it saw: on the subscription, `windows`; and `tokens` and
    `apiCost` (billed, on the API key) when Claude answered. `source` is sub or api."""

    def record(seen: dict[str, Any]) -> None:
        with _LOCK:  # two runs at once each read, add and write: one at a time, or one is lost
            _add(store, seen, clock(), source)

    return record


def _add(store: Store, seen: dict[str, Any], now: float, source: str) -> None:
    if seen.get("windows"):
        kept = _load(store, WINDOWS_KEY) | seen["windows"]
        store.set_setting(WINDOWS_KEY, json.dumps(kept | {"at": int(now * 1000)}))
    if "tokens" in seen:
        for key in _keys(now, source):
            total = _load(store, key)
            added = {
                "runs": int(total.get("runs", 0)) + 1,
                "tokens": int(total.get("tokens", 0)) + int(seen["tokens"]),
                "apiCost": str(
                    Decimal(str(total.get("apiCost", "0"))) + Decimal(str(seen.get("apiCost") or 0))
                ),
            }
            store.set_setting(key, json.dumps(added))


def view(store: Store, clock: Callable[[], float] = time.time) -> dict[str, Any]:
    """The Settings page's usage: the plan's windows as last seen, and this app's runs today
    and this month."""
    now = clock()
    saved = _load(store, WINDOWS_KEY)
    shown: list[dict[str, Any]] = []
    for kind, name in NAMES.items():
        if not isinstance(saved.get(kind), dict):
            continue
        window = cast(dict[str, Any], saved[kind])
        resets = window.get("resetsAt")
        lapsed = isinstance(resets, int) and resets <= now
        used = window.get("used")
        shown.append(
            {
                "kind": kind,
                "name": name,
                # A window that has reset since is unknown until the next run, not still full.
                "used": None if lapsed or used is None else round(float(used) * 100),
                "resetsAt": None if lapsed or resets is None else resets * 1000,
                "status": "allowed" if lapsed else str(window.get("status", "allowed")),
            }
        )
    return {"windows": shown, "checkedAt": saved.get("at")} | app(store, "sub", clock)


def app(store: Store, source: str, clock: Callable[[], float] = time.time) -> dict[str, Any]:
    """This app's runs on one source, today and this month."""
    day, month = _keys(clock(), source)
    return {"today": _totals(store, day), "month": _totals(store, month)}


def _keys(now: float, source: str) -> tuple[str, str]:
    at = datetime.fromtimestamp(now, SYDNEY)
    return f"{source}_usage_d_{at:%Y-%m-%d}", f"{source}_usage_m_{at:%Y-%m}"


def _load(store: Store, key: str) -> dict[str, Any]:
    try:
        loaded = json.loads(store.setting(key, "{}"))
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}  # pyright: ignore[reportUnknownVariableType]


def _totals(store: Store, key: str) -> dict[str, Any]:
    total = _load(store, key)
    cost = Decimal(str(total.get("apiCost", "0"))).quantize(Decimal("0.01"))
    return {
        "runs": int(total.get("runs", 0)),
        "tokens": int(total.get("tokens", 0)),
        "apiCost": str(cost),
    }
