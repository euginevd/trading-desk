"""The macro calendar: US high-impact releases (CPI, FOMC, jobs and the like) for the next three
weeks, read once a day. This week's come from Forex Factory's public feed, with exact times;
the weeks after (the feed only covers this week) from one small model call with a web search,
asked by the caller. trading-agent's scan and dca-agent read the same list (owner, 21 Nov
2026), as context and warnings, never as a rule."""

import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from zoneinfo import ZoneInfo

import httpx

FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
KEY = "macro_calendar"
SYDNEY = ZoneInfo("Australia/Sydney")
NEW_YORK = ZoneInfo("America/New_York")
AHEAD_DAYS = 21
OK = 200
# A model's lookup: (prompt, schema) to its reply, or None when it can't be asked.
Ask = Callable[[str, dict[str, Any]], dict[str, Any] | None]

LOOKUP: dict[str, Any] = {
    "type": "object",
    "properties": {
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "date": {"type": "string"},
                    "timeEt": {"type": "string"},
                },
                "required": ["title", "date", "timeEt"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["events"],
    "additionalProperties": False,
}


def _ff(http: httpx.Client) -> list[dict[str, Any]] | None:
    """This week's US high-impact releases from Forex Factory; None if it didn't answer."""
    try:
        response = http.get(FF_URL)
        if response.status_code != OK:
            return None
        rows = cast(list[dict[str, Any]], response.json())
    except (httpx.HTTPError, ValueError):
        return None
    found: list[dict[str, Any]] = []
    for r in rows:
        if r.get("country") != "USD" or r.get("impact") != "High":
            continue
        try:
            at = datetime.fromisoformat(str(r["date"]))
        except (KeyError, ValueError):
            continue
        found.append({"title": str(r.get("title") or "")[:60], "at": int(at.timestamp() * 1000)})
    return found


def _lookup(ask: Ask, start: datetime) -> list[dict[str, Any]]:
    """The weeks after this one, by one model call with a web search."""
    end = start + timedelta(days=AHEAD_DAYS)
    prompt = (
        "List the US high-impact economic releases scheduled from "
        f"{start:%d %b %Y} to {end:%d %b %Y}: CPI, PPI, the FOMC rate decision, nonfarm "
        "payrolls, PCE, GDP and retail sales. Search the official schedules (BLS, the Fed, "
        "BEA). For each: title (at most 6 words), date as YYYY-MM-DD, and timeEt as HH:MM in "
        "US Eastern time (empty if unknown). Only events you found on a schedule; none made up."
    )
    reply = ask(prompt, LOOKUP)
    if not reply:
        return []
    found: list[dict[str, Any]] = []
    for e in cast(list[dict[str, Any]], reply.get("events") or []):
        try:
            day = datetime.strptime(str(e.get("date")), "%Y-%m-%d")  # noqa: DTZ007 - Eastern
            hh, mm = (str(e.get("timeEt") or "08:30") + ":00").split(":")[:2]
            at = day.replace(hour=int(hh), minute=int(mm), tzinfo=NEW_YORK)
        except ValueError:
            continue
        found.append({"title": str(e.get("title") or "")[:60], "at": int(at.timestamp() * 1000)})
    return found


def words(when: datetime) -> str:
    """'Wed 10 Dec, 12:30am': the same on every platform (no %-d on Windows)."""
    hour = when.hour % 12 or 12
    half = "am" if when.hour < 12 else "pm"  # noqa: PLR2004 - noon
    return f"{when:%a} {when.day} {when:%b}, {hour}:{when.minute:02d}{half}"


def events(
    store: Any, http: httpx.Client | None, ask: Ask | None, now_ms: int
) -> list[dict[str, Any]]:
    """The next three weeks' events, soonest first, each with its Sydney time as words.
    Read once a Sydney day and kept in the local database; yesterday's list stands in when a
    source doesn't answer."""
    now = datetime.fromtimestamp(now_ms / 1000, UTC)
    today = now.astimezone(SYDNEY).strftime("%Y-%m-%d")
    raw = store.setting(KEY, "")
    kept: dict[str, Any] = json.loads(raw) if raw else {}
    if kept.get("day") != today and (http is not None or ask is not None):
        week = _ff(http) if http is not None else None
        ahead = _lookup(ask, now) if ask is not None else []
        kept = {
            "day": today,
            "week": week if week is not None else kept.get("week", []),
            "ahead": ahead or kept.get("ahead", []),
        }
        store.set_setting(KEY, json.dumps(kept))
    week = cast(list[dict[str, Any]], kept.get("week") or [])
    # The feed is exact for its week: a looked-up event in the same span is dropped.
    last = max((e["at"] for e in week), default=0)
    merged = week + [
        e for e in cast(list[dict[str, Any]], kept.get("ahead") or []) if e["at"] > last
    ]
    end = now_ms + AHEAD_DAYS * 86_400_000
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for e in sorted(merged, key=lambda e: e["at"]):
        when = datetime.fromtimestamp(e["at"] / 1000, SYDNEY)
        key = (e["title"].lower(), when.strftime("%Y-%m-%d"))
        if not now_ms <= e["at"] <= end or key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "title": e["title"],
                "at": e["at"],
                "when": words(when),
                "inDays": max(0, round((e["at"] - now_ms) / 86_400_000)),
            }
        )
    return out


def inside(found: list[dict[str, Any]], now_ms: int, hold_days: float) -> list[dict[str, Any]]:
    """The events that fall inside a hold of `hold_days` from now."""
    end = now_ms + hold_days * 86_400_000
    return [e for e in found if e["at"] <= end]
