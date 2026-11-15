"""The Dashboard's coach (decision 52): a greeting, a mood from the portfolio's day, a deposit
coach against the monthly cap and today's key points, all worked out here. The model only words
the short messages, from these facts and the owner's Plan; quotes come only from the Plan's list.
Messages are kept per day and per mood, and every one has a plain fallback written here.
"""

import hashlib
import json
from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal
from typing import Any, cast

from api.ai_signal import SignalError
from api.binance import plain

SHARP = Decimal(10)
MOVE = Decimal(2)
STREAK_DAYS = 7
STREAK_GAIN = Decimal(15)
NEAR_INVALIDATION = Decimal(3)  # % above the level
STABLES = ("USDC", "USDT", "FDUSD")
DUST = Decimal(5)
POINTS = 4
CACHE_KEY = "coach_message"
NAME_KEY = "owner_name"
LABELS = {
    "sharp_up": "Sharp up",
    "up": "Up",
    "flat": "Flat",
    "down": "Down",
    "sharp_down": "Sharp down",
}

SYSTEM = (
    "You write the short messages on the owner's personal crypto dashboard. Plain, warm and "
    "short; never hype, never panic. Use only the facts given and the owner's own plan: never "
    "invent a number, a quote, a price or a rule. Advice only; never tell them to place an order. "
    "Australian English. Reply in the JSON shape asked for."
)


def mood(change_pct: Decimal) -> str:
    """The band for the portfolio's 24-hour change, in percent."""
    if change_pct >= SHARP:
        return "sharp_up"
    if change_pct >= MOVE:
        return "up"
    if change_pct > -MOVE:
        return "flat"
    if change_pct > -SHARP:
        return "down"
    return "sharp_down"


def streak(values: list[Decimal]) -> dict[str, str] | None:
    """Up 7 days in a row, or 15% or more over 7 days, from the daily account values."""
    if len(values) < STREAK_DAYS + 1:
        return None
    week = values[-(STREAK_DAYS + 1) :]
    if week[0] <= 0:
        return None
    gain = (week[-1] / week[0] - 1) * 100
    every_day = all(b > a for a, b in zip(week, week[1:], strict=False))
    if not every_day and gain < STREAK_GAIN:
        return None
    return {"weekPct": plain(gain.quantize(Decimal("0.1"))), "everyDay": str(every_day).lower()}


def part_of_day(now: datetime) -> str:
    noon, six = 12, 18
    return "Morning" if now.hour < noon else "Afternoon" if now.hour < six else "Evening"


def deposits(
    report: dict[str, Any] | None, today: date, cap: Decimal | None, lessons: list[dict[str, str]]
) -> dict[str, Any]:
    """This financial year's and this month's deposits in AUD, against the monthly cap."""
    month_key = f"{today:%Y-%m}"
    month = next((m for m in (report or {}).get("months", []) if m["month"] == month_key), None)
    in_month = Decimal(month["aud"]) if month else Decimal(0)
    left = cap - in_month if cap is not None else None
    note = next(
        (
            item
            for item in sorted(lessons, key=lambda item: item["date"], reverse=True)
            if any(
                w in (item["happened"] + " " + item["learned"]).lower() for w in ("cap", "deposit")
            )
        ),
        None,
    )
    return {
        "known": report is not None,
        "fy": (report or {}).get("fy"),
        "fyAud": (report or {}).get("total", {}).get("aud", "0"),
        "monthAud": plain(in_month),
        "capAud": plain(cap) if cap is not None else None,
        "leftAud": plain(max(left, Decimal(0))) if left is not None else None,
        "overAud": plain(-left) if left is not None and left < 0 else None,
        "usedPct": plain((in_month / cap * 100).quantize(Decimal("0.1"))) if cap else None,
        "lesson": note,
    }


def coins_held(portfolio: dict[str, Any]) -> list[dict[str, Any]]:
    """One row per coin held, Binance and the wallet together, without stablecoins or dust."""
    by_coin: dict[str, dict[str, Any]] = {}
    for h in portfolio["holdings"]:
        if h["asset"] in STABLES or not h.get("value") or Decimal(h["value"]) < DUST:
            continue
        row = by_coin.get(h["asset"])
        if row is None:
            by_coin[h["asset"]] = {**h, "coin": h["asset"], "value": Decimal(h["value"])}
        else:
            row["value"] += Decimal(h["value"])
    return sorted(by_coin.values(), key=lambda r: r["value"], reverse=True)


def _breaches(
    rows: list[dict[str, Any]], total: Decimal, rules: dict[str, str]
) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    cap, max_loss = Decimal(rules["maxCoinPct"]), Decimal(rules["maxLossPct"])
    for row in rows:
        share = row["value"] / total * 100 if total else Decimal(0)
        if share > cap:
            points.append(
                {
                    "kind": "concentration",
                    "coin": row["coin"],
                    "rule": True,
                    "pct": plain(share.quantize(Decimal(1))),
                    "cap": rules["maxCoinPct"],
                }
            )
    for row in rows:
        lost = row.get("profitPercent")
        if lost is not None and Decimal(lost) <= -max_loss:
            points.append(
                {
                    "kind": "loss",
                    "coin": row["coin"],
                    "rule": True,
                    "pct": plain(Decimal(lost).quantize(Decimal("0.1"))),
                    "cap": rules["maxLossPct"],
                }
            )
    return points


def _zone(row: dict[str, Any], plan: dict[str, Any] | None) -> dict[str, Any] | None:
    """In its add zone, or within 3% above its invalidation, on the coin's last plan."""
    zones = cast(dict[str, Any], (plan or {}).get("zones") or {})
    price = Decimal(row["price"]) if row.get("price") else None
    buy = cast(dict[str, str] | None, zones.get("buy"))
    invalid = cast(dict[str, str] | None, zones.get("invalidation"))
    if not price:
        return None
    if buy and Decimal(buy["low"]) <= price <= Decimal(buy["high"]):
        return {
            "kind": "addZone",
            "coin": row["coin"],
            "low": buy["low"],
            "high": buy["high"],
            "rule": False,
        }
    if invalid and invalid.get("price"):
        level = Decimal(invalid["price"])
        above = (price / level - 1) * 100 if level else None
        if above is not None and 0 <= above <= NEAR_INVALIDATION:
            return {
                "kind": "nearInvalidation",
                "coin": row["coin"],
                "rule": False,
                "pct": plain(above.quantize(Decimal("0.1"))),
                "price": invalid["price"],
            }
    return None


def key_points(
    portfolio: dict[str, Any],
    rules: dict[str, str],
    last_plan: Callable[[str], dict[str, Any] | None],
) -> list[dict[str, Any]]:
    """Up to four points from real data: rule breaches first, then the day's biggest mover,
    then coins in their add zone or near their invalidation on their last plan."""
    rows = coins_held(portfolio)
    points = _breaches(rows, Decimal(portfolio["total"]["value"] or "0"), rules)
    moved = [r for r in rows if r.get("change24h") is not None]
    if moved:
        top = max(moved, key=lambda r: abs(Decimal(r["change24h"])))
        change = Decimal(top["change24h"]).quantize(Decimal("0.1"))
        points.append({"kind": "mover", "coin": top["coin"], "pct": plain(change), "rule": False})
    zoned = (_zone(row, last_plan(row["coin"])) for row in rows)
    points += [point for point in zoned if point]
    return points[:POINTS]


def facts(  # noqa: PLR0913 - every input is a separate source, passed in for tests
    *,
    portfolio: dict[str, Any],
    history: list[Decimal],
    report: dict[str, Any] | None,
    plan: dict[str, Any],
    now: datetime,
    name: str,
    last_plan: Callable[[str], dict[str, Any] | None],
) -> dict[str, Any]:
    """Every number the Dashboard shows, worked out here."""
    total = portfolio["total"]
    pct = Decimal(total.get("change24hPercent") or "0")
    rates = cast(dict[str, str], total.get("rates") or {})
    aud = Decimal(rates.get("AUD") or total.get("audRate") or "1")
    change_aud = Decimal(total.get("change24h") or "0") * aud
    rules = plan["rules"]
    cap = Decimal(rules["monthlyCapAud"]) if rules.get("monthlyCapAud") else None
    points = key_points(portfolio, rules, last_plan)
    up = streak(history)
    band = mood(pct)
    return {
        "greeting": f"{part_of_day(now)}, {name}." if name else f"{part_of_day(now)}.",
        "mood": band,
        "moodLabel": LABELS[band],
        "changePct": plain(pct.quantize(Decimal("0.1"))),
        "changeAud": plain(change_aud.quantize(Decimal(1))),
        "streak": up if band not in ("down", "sharp_down") else None,
        "takeProfit": rules.get("takeProfit") or None,
        "withinRules": not any(p["rule"] for p in points),
        "deposits": deposits(report, now.date(), cap, plan["lessons"]["items"]),
        "keyPoints": points,
        "day": now.date().isoformat(),
    }


def quote(plan: dict[str, Any], day: str) -> dict[str, str] | None:
    """One of the owner's own quotes, the same all day; none if the list is empty."""
    quotes = plan["quotes"]["items"]
    if not quotes:
        return None
    index = int(hashlib.sha256(day.encode()).hexdigest(), 16) % len(quotes)
    return {"text": quotes[index]["text"], "author": quotes[index]["author"]}


def written(facts_: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    """The plain wording, used until the model has written its own, and if it can't."""
    band, dep = facts_["mood"], facts_["deposits"]
    ok = facts_["withinRules"]
    rules_line = (
        "You're within your rules. Nothing to do today."
        if ok
        else "One of your rules needs a look: see today's key points."
    )
    if band in ("down", "sharp_down"):
        lines = ["Days like this are hard to watch, and they pass.", rules_line]
    elif band == "flat":
        lines = [
            "A quiet day." + (" Everything's within your rules." if ok else ""),
            *([] if ok else [rules_line]),
        ]
    else:
        lines = [f"A good day: up {facts_['changePct']}%."]
    if facts_["streak"]:
        lines.append(
            f"You're up {facts_['streak']['weekPct']}% this week. Your rule says consider taking "
            "some profit back to target allocation. You can rebuy lower."
        )
    elif band in ("up", "sharp_up") and facts_["takeProfit"]:
        lines.append(f"Your take-profit rule: {facts_['takeProfit']}")
    if dep["capAud"] is None:
        coach = "Set a monthly deposit cap on your Plan to track it here."
    elif dep["overAud"]:
        coach = f"You're over your monthly cap by A${dep['overAud']}. The next deposit can wait."
    else:
        coach = f"A${dep['leftAud']} left under your A${dep['capAud']} cap this month."
        if band in ("down", "sharp_down"):
            coach += " Stick to it; opportunities come back."
    show_quote = band in ("down", "sharp_down")
    return {
        "lines": lines[:3],
        "coach": coach,
        "quote": quote(plan, facts_["day"]) if show_quote else None,
        "link": "trade" if facts_["streak"] else None,
        "source": "plain",
    }


def cache_key(facts_: dict[str, Any]) -> str:
    """A new message each day, and when the mood, streak or cap standing changes."""
    dep = facts_["deposits"]
    return "|".join(
        [
            facts_["day"],
            facts_["mood"],
            str(bool(facts_["streak"])),
            str(bool(dep["overAud"])),
            str(facts_["withinRules"]),
        ]
    )


SHAPE: dict[str, Any] = {
    "type": "object",
    "properties": {
        "lines": {"type": "array", "items": {"type": "string"}, "maxItems": 2},
        "coach": {"type": "string"},
    },
    "required": ["lines", "coach"],
    "additionalProperties": False,
}


def prompt(facts_: dict[str, Any], plan: dict[str, Any], plain_: dict[str, Any]) -> str:
    asks = {
        "down": "lines: 1 calm, consoling line, then 1 practical line tied to the owner's rules.",
        "sharp_down": "lines: 1 calm, consoling line, then 1 practical line tied to their rules.",
        "flat": "lines: 1 short status line.",
        "up": "lines: 1 line; if the take-profit rule applies, a second line reminding them of it.",
        "sharp_up": "lines: 1 line; if the take-profit rule applies, a second line on it.",
    }
    return (
        f"{asks[facts_['mood']]} coach: 1 line on this month's deposits against the cap, "
        "grounded in the plan (its rules and lessons). Use the figures exactly as given.\n"
        f"Facts: {json.dumps({k: v for k, v in facts_.items() if k != 'keyPoints'})}\n"
        f"Key points: {json.dumps(facts_['keyPoints'])}\n"
        f"Plan: {json.dumps(plan)}\n"
        f"A plain version to improve on: {json.dumps(plain_)}"
    )


def message(
    facts_: dict[str, Any],
    plan: dict[str, Any],
    agents_plan: dict[str, Any],
    kept: dict[str, Any] | None,
    write: Callable[[str, str, dict[str, Any]], dict[str, Any]] | None,
) -> dict[str, Any]:
    """The kept message if it still fits; else the model's, checked; else the plain one."""
    key = cache_key(facts_)
    if kept and kept.get("key") == key:
        return dict(kept["message"])
    base = written(facts_, plan)
    if write is None:
        return base
    try:
        reply = write(SYSTEM, prompt(facts_, agents_plan, base), SHAPE)
    except SignalError:
        return base
    lines = [str(line).strip()[:240] for line in reply.get("lines", []) if str(line).strip()][:2]
    coach = str(reply.get("coach", "")).strip()[:240]
    if not lines or not coach:
        return base
    if facts_["streak"]:
        lines = [*lines[:1], base["lines"][-1]]  # the streak line is the rule's own words
    return base | {"lines": lines, "coach": coach, "source": "model"}
