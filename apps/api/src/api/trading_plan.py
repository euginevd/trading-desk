"""The owner's written trading plan (decision 52): goals, strategy, rules, lessons and quotes,
the source every agent reads. Saved in SQLite; each section knows when it was last updated, and
the rules keep a history of every change. The three risk rules stay where the AI plan reads
them (api.advisor), so there is one set of rules, edited only here.
"""

import json
import re
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any, cast

from api.advisor import rules_of, set_rules
from api.audit import Audit
from api.binance import plain
from api.store import Store
from api.trading import Refused

SECTIONS = ("goals", "strategy", "rules", "lessons", "quotes")
CAP_KEY = "plan_monthly_cap_aud"
HISTORY_KEY = "plan_rules_history"
HISTORY_KEPT = 200
COIN = re.compile(r"[A-Z0-9]{1,15}")
DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
LABELS = {
    "monthlyCapAud": "Monthly deposit cap (A$)",
    "maxCoinPct": "Max % per coin",
    "tradeBudgetAud": "Per-trade size (A$)",
    "maxLossPct": "Max loss per position (%)",
    "driftBand": "Rebalance band (± points)",
    "takeProfit": "Take-profit rule",
    "behaviour": "Behaviour rules",
    "notes": "Rule notes",
}


def _key(section: str) -> str:
    return f"plan_{section}"


def _saved(store: Store, section: str) -> dict[str, Any]:
    raw = store.setting(_key(section), "")
    try:
        data: Any = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        data = {}
    return _dict(data)


def _dict(item: object) -> dict[str, Any]:
    return cast(dict[str, Any], item) if isinstance(item, dict) else {}


def _text(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _items(value: object, limit: int) -> list[Any]:
    if not isinstance(value, list):
        raise Refused("Send a list.")
    items = cast(list[Any], value)
    if len(items) > limit:
        raise Refused(f"Keep it to {limit}.")
    return items


def monthly_cap(store: Store) -> Decimal | None:
    raw = store.setting(CAP_KEY, "")
    return Decimal(raw) if raw else None


def view(store: Store) -> dict[str, Any]:
    """Every section as the Plan page shows it."""
    goals, strategy = _saved(store, "goals"), _saved(store, "strategy")
    rules, lessons, quotes = (
        _saved(store, "rules"),
        _saved(store, "lessons"),
        _saved(store, "quotes"),
    )
    risk = rules_of(store).view()
    cap = monthly_cap(store)
    history: list[dict[str, Any]] = json.loads(store.setting(HISTORY_KEY, "[]"))
    return {
        "goals": {
            "text": goals.get("text", ""),
            "targets": goals.get("targets", []),
            "updated": goals.get("updated"),
        },
        "strategy": {"text": strategy.get("text", ""), "updated": strategy.get("updated")},
        "rules": {
            "monthlyCapAud": plain(cap) if cap is not None else None,
            "maxCoinPct": risk["maxCoinPct"],
            "tradeBudgetAud": risk["tradeBudgetAud"],
            "maxLossPct": risk["maxLossPct"],
            "driftBand": rules.get("driftBand", "5"),
            "takeProfit": rules.get("takeProfit", ""),
            "behaviour": rules.get("behaviour", []),
            "notes": rules.get("notes", ""),
            "updated": rules.get("updated"),
            "history": history[::-1],  # newest first
        },
        "lessons": {"items": lessons.get("items", []), "updated": lessons.get("updated")},
        "quotes": {"items": quotes.get("items", []), "updated": quotes.get("updated")},
    }


def save(
    store: Store, audit: Audit, section: str, body: dict[str, Any], now: int
) -> dict[str, Any]:
    """Saves one section, checked, and returns the whole plan."""
    if section not in SECTIONS:
        raise Refused("No such section of the plan.")
    if section == "goals":
        data: dict[str, Any] = {"text": _text(body.get("text"), 2000), "targets": _targets(body)}
    elif section == "strategy":
        data = {"text": _text(body.get("text"), 4000)}
    elif section == "rules":
        data = _rules(store, body, now)
    elif section == "lessons":
        data = {"items": [_lesson(item) for item in _items(body.get("items"), 200)]}
    else:
        data = {"items": [_quote(item) for item in _items(body.get("items"), 100)]}
    store.set_setting(_key(section), json.dumps(data | {"updated": now}))
    audit.record("plan", f"Plan: {section} saved", "Saved")
    return view(store)


def _targets(body: dict[str, Any]) -> list[dict[str, str]]:
    targets: list[dict[str, str]] = []
    for item in _items(body.get("targets", []), 20):
        target = _dict(item)
        coin = str(target.get("coin", "")).strip().upper()
        if not COIN.fullmatch(coin):
            raise Refused("Each target needs a coin, such as BTC.")
        pct = _number(target.get("pct"), "A target", Decimal(0), Decimal(100))
        targets.append({"coin": coin, "pct": plain(pct)})
    return targets


def _number(value: object, name: str, low: Decimal, high: Decimal) -> Decimal:
    try:
        number = Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        raise Refused(f"{name} must be a number.") from None
    if not number.is_finite() or not low <= number <= high:
        raise Refused(f"{name} must be from {low} to {high}.")
    return number


def _rules(store: Store, body: dict[str, Any], now: int) -> dict[str, Any]:
    before = view(store)["rules"]
    raw_cap = str(body.get("monthlyCapAud") or "").strip()
    cap = _number(raw_cap, "The monthly cap", Decimal(0), Decimal(10_000_000)) if raw_cap else None
    set_rules(store, body)  # the three risk rules, checked where the AI plan reads them
    store.set_setting(CAP_KEY, plain(cap) if cap is not None else "")
    behaviour = [_text(b, 120) for b in _items(body.get("behaviour", []), 20) if _text(b, 120)]
    raw_band = str(body.get("driftBand") or "5").strip()
    band = _number(raw_band, "The rebalance band", Decimal(1), Decimal(50))
    data = {
        "driftBand": plain(band),
        "takeProfit": _text(body.get("takeProfit"), 500),
        "behaviour": behaviour,
        "notes": _text(body.get("notes"), 2000),
    }
    after = view(store)["rules"] | data
    changes = [
        {"time": now, "rule": label, "from": _shown(before[name]), "to": _shown(after[name])}
        for name, label in LABELS.items()
        if _shown(before[name]) != _shown(after[name])
    ]
    if changes:
        history: list[dict[str, Any]] = json.loads(store.setting(HISTORY_KEY, "[]"))
        store.set_setting(HISTORY_KEY, json.dumps((history + changes)[-HISTORY_KEPT:]))
    return data


def _shown(value: object) -> str:
    if isinstance(value, list):
        return "; ".join(str(v) for v in cast(list[Any], value)) or "none"
    return str(value) if value not in (None, "") else "none"


def _lesson(raw: object) -> dict[str, str]:
    item = _dict(raw)
    date = str(item.get("date", "")).strip()
    happened = _text(item.get("happened"), 300)
    if not DAY.fullmatch(date) or not happened:
        raise Refused("Each lesson needs a date and what happened.")
    return {
        "id": _text(item.get("id"), 40) or uuid.uuid4().hex[:12],
        "date": date,
        "happened": happened,
        "learned": _text(item.get("learned"), 300),
    }


def _quote(raw: object) -> dict[str, str]:
    item = _dict(raw)
    text = _text(item.get("text"), 200)
    if not text:
        raise Refused("Each quote needs its words.")
    return {
        "id": _text(item.get("id"), 40) or uuid.uuid4().hex[:12],
        "text": text,
        "author": _text(item.get("author"), 60),
    }


def for_agents(store: Store) -> dict[str, Any]:
    """The plan as every agent reads it: no history, the newest lessons first, no ids."""
    plan = view(store)
    rules = {k: v for k, v in plan["rules"].items() if k not in ("history", "updated")}
    lessons = sorted(plan["lessons"]["items"], key=lambda item: item["date"], reverse=True)[:10]
    return {
        "goals": {"text": plan["goals"]["text"], "targets": plan["goals"]["targets"]},
        "strategy": plan["strategy"]["text"],
        "rules": rules,
        "lessons": [{k: v for k, v in item.items() if k != "id"} for item in lessons],
        "quotes": [
            {k: v for k, v in item.items() if k != "id"} for item in plan["quotes"]["items"]
        ],
    }
