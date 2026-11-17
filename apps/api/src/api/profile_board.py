"""The Profile page's four widgets (decision 62): the summary, the road to the first goal, the
BTC stack and the cash floor, worked out in code from profile.md's figures and the live portfolio.

The goal total is the TAO wallet, Binance and the emergency fund: never parked tax money or
super. "On track" compares it with a straight path from the file's own starting point (section
8's date and total) through each milestone in section 2. Projections use today's price and the
weekly amounts in section 5, and say so.
"""

import math
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from api.binance import plain

ZERO = Decimal(0)
HUNDRED = Decimal(100)
MONTHS_A_YEAR = 12
WEEK = 7
BTC_TICKS = (Decimal("0.1"), Decimal("0.25"), Decimal("0.5"), Decimal("0.75"))
CASH_TICKS = (Decimal("0.5"), Decimal("0.9"))  # half and nine tenths of the floor
DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
BTC = "BTC"


def _s(value: Decimal | None, places: str = "0.01") -> str | None:
    return plain(value.quantize(Decimal(places))) if value is not None else None


def _pct(part: Decimal, whole: Decimal | None) -> str | None:
    if not whole:
        return None
    return _s(max(min(part / whole * HUNDRED, HUNDRED), ZERO), "0.1")


def months_between(start: date, end: date) -> int:
    return max((end.year - start.year) * MONTHS_A_YEAR + end.month - start.month, 0)


def add_months(day: date, months: int) -> date:
    n = day.month - 1 + months
    return date(day.year + n // MONTHS_A_YEAR, n % MONTHS_A_YEAR + 1, 1)


def next_weekday(today: date, name: str | None) -> date:
    """The next DCA day from today, today included."""
    target = DAYS.index(name) if name in DAYS else DAYS.index("Friday")
    return today + timedelta(days=(target - today.weekday()) % WEEK)


def week_start(today: date, name: str | None) -> date:
    """The latest DCA day on or before today: "this week" for the BTC buy."""
    target = DAYS.index(name) if name in DAYS else DAYS.index("Friday")
    return today - timedelta(days=(today.weekday() - target) % WEEK)


def _by_source(portfolio: dict[str, Any] | None, rate: Decimal) -> dict[str, Decimal] | None:
    if portfolio is None:
        return None
    found = {"TAO wallet": ZERO, "Binance": ZERO}
    for h in portfolio["holdings"]:
        if h["source"] in found:
            found[h["source"]] += Decimal(h.get("value") or "0") * rate
    return found


def _path(v: dict[str, Any], goal: dict[str, Any]) -> list[tuple[date, Decimal]]:
    held = v["holdings"]
    points: list[tuple[date, Decimal]] = []
    if held["asOf"] and held["baselineUsd"] is not None:
        points.append((held["asOf"], held["baselineUsd"]))
    return points + _stops(v, goal)


def _stops(v: dict[str, Any], goal: dict[str, Any]) -> list[tuple[date, Decimal]]:
    """The file's milestones before the goal, in its currency, then the goal itself."""
    steps = [
        (m["date"], m["amount"])
        for m in v["milestones"]
        if m["currency"] == goal["currency"]
        and m["amount"] < goal["amount"]
        and m["date"] < goal["date"]
    ]
    return [*steps, (goal["date"], goal["amount"])]


def expected(points: list[tuple[date, Decimal]], today: date) -> Decimal | None:
    """Where a straight path between the points stands today."""
    if not points:
        return None
    if today <= points[0][0]:
        return points[0][1]
    for (d1, v1), (d2, v2) in zip(points, points[1:], strict=False):
        if d1 <= today <= d2:
            span = Decimal((d2 - d1).days) or Decimal(1)
            return v1 + (v2 - v1) * Decimal((today - d1).days) / span
    return points[-1][1]


def road(
    v: dict[str, Any], parts: dict[str, Decimal] | None, rate: Decimal, today: date
) -> dict[str, Any] | None:
    goals = [g for g in v["goals"] if g["currency"] == "USD"]
    if not goals:
        return None
    goal, then = goals[0], (goals[1] if len(goals) > 1 else None)
    emergency = v["cash"]["emergency"] or ZERO
    stops = _stops(v, goal)
    ticks: list[dict[str, Any]] = [{"usd": _s(usd, "1"), "year": d.year} for d, usd in stops]
    base = {
        "goalUsd": _s(goal["amount"], "1"),
        "goalDate": goal["date"].isoformat(),
        "ticks": ticks,
        "then": {"usd": _s(then["amount"], "1"), "year": then["date"].year} if then else None,
        # The plan as a line over time, for the chart: the file's start, each milestone, the goal.
        "path": [{"date": d.isoformat(), "usd": _s(usd, "1")} for d, usd in _path(v, goal)],
        "today": today.isoformat(),
    }
    if parts is None:
        return base | {"known": False}
    total_aud = parts["TAO wallet"] + parts["Binance"] + emergency
    total = total_aud / rate
    passed = [s for s in stops if s[1] <= total]
    ahead = [s for s in stops if s[1] > total]
    start = passed[-1][1] if passed else ZERO
    leg = None
    if ahead:
        nxt_day, nxt = ahead[0]
        leg = {
            "fromUsd": _s(start, "1"),
            "toUsd": _s(nxt, "1"),
            "year": nxt_day.year,
            "pct": _pct(total - start, nxt - start),
            "toGoUsd": _s(nxt - total, "1"),
            "monthsLeft": months_between(today, nxt_day),
        }
    should = expected(_path(v, goal), today)
    for t in ticks:
        usd = Decimal(str(t["usd"]))
        t["state"] = "passed" if usd <= total else "next" if ahead and usd == ahead[0][1] else ""
    return base | {
        "known": True,
        "totalUsd": _s(total, "1"),
        "totalAud": _s(total_aud, "1"),
        "parts": {
            "taoAud": _s(parts["TAO wallet"], "1"),
            "binanceAud": _s(parts["Binance"], "1"),
            "emergencyAud": _s(emergency, "1"),
        },
        "pct": _pct(total, goal["amount"]),
        "onTrack": should is None or total >= should,
        "pathUsd": _s(should, "1"),
        "leg": leg,
        "thenPct": _pct(total, then["amount"]) if then else None,
    }


def stack(
    v: dict[str, Any],
    portfolio: dict[str, Any] | None,
    rate: Decimal,
    today: date,
    bought: bool | None,
) -> dict[str, Any] | None:
    target = v["btcTarget"]
    weekly = v["dca"]["btcWeekly"]
    if target is None:
        return None
    base = {
        "target": _s(target, "0.0001"),
        "weeklyAud": _s(weekly, "1"),
        "day": v["dca"]["day"],
        "bought": bought,
        "ticks": [_s(t, "0.01") for t in BTC_TICKS if t < target] + [_s(target, "0.01")],
    }
    if portfolio is None:
        return base | {"known": False}
    rows = [h for h in portfolio["holdings"] if h["asset"] == BTC]
    held = sum((Decimal(h.get("amount") or "0") for h in rows), ZERO)
    price = next((Decimal(h["price"]) for h in rows if h.get("price")), None)
    price_aud = price * rate if price else None
    ticks = [t for t in BTC_TICKS if t < target] + [target]
    nxt = next((t for t in ticks if t > held), None)
    start = max((t for t in ticks if t <= held), default=ZERO)

    def weeks(btc: Decimal) -> int | None:
        if not price_aud or not weekly:
            return None
        return math.ceil(btc * price_aud / weekly)

    to_target = weeks(target - held) if held < target else 0
    first = next_weekday(today, v["dca"]["day"])
    return base | {
        "known": True,
        "held": _s(held, "0.00001"),
        "pct": _pct(held, target),
        "valueAud": _s(held * price_aud, "1") if price_aud else None,
        "priceAud": _s(price_aud, "1"),
        "next": _s(nxt, "0.01") if nxt is not None else None,
        "leg": {
            "from": _s(start, "0.01"),
            "to": _s(nxt, "0.01"),
            "pct": _pct(held - start, nxt - start),
            "toGo": _s(nxt - held, "0.00001"),
            "weeksLeft": weeks(nxt - held),
        }
        if nxt is not None
        else None,
        "projected": (first + timedelta(weeks=to_target - 1)).isoformat() if to_target else None,
    }


def cash(v: dict[str, Any], today: date) -> dict[str, Any] | None:
    c = v["cash"]
    floor = c["floor"]
    if floor is None:
        return None
    parked, emergency = c["parked"] or ZERO, c["emergency"] or ZERO
    total = parked + emergency
    monthly = c["monthlyIn"]
    short = max(floor - total, ZERO)
    months = math.ceil(short / monthly) if monthly and short else 0
    target = c["emergencyTarget"]
    e_short = max(target - emergency, ZERO) if target else None
    ticks = [floor * t for t in CASH_TICKS] + [floor]
    nxt = next((t for t in ticks if t > total), None)
    return {
        "totalAud": _s(total, "1"),
        "floorAud": _s(floor, "1"),
        "pct": _pct(total, floor),
        "parkedAud": _s(parked, "1"),
        "emergencyAud": _s(emergency, "1"),
        "parkedPct": _pct(parked, floor),
        "emergencyPct": _pct(emergency, floor),
        "monthlyAud": _s(monthly, "1"),
        "shortAud": _s(short, "1"),
        "full": short == ZERO,
        "ticks": [
            {"aud": _s(t, "1"), "state": "passed" if t <= total else "next" if t == nxt else ""}
            for t in ticks
        ],
        "projected": add_months(today, months).isoformat()[:7] if months else None,
        "emergency": {
            "targetAud": _s(target, "1"),
            "pct": _pct(emergency, target),
            "toGoAud": _s(e_short, "1"),
            "months": math.ceil(e_short / monthly) if monthly and e_short else 0,
        }
        if target
        else None,
    }


def summary(v: dict[str, Any], road_: dict[str, Any] | None, today: date) -> dict[str, Any]:
    from api.profile_v2 import age  # noqa: PLC0415 - profile_v2 is the reader; this is the page

    dca = v["dca"]
    c = v["cash"]
    floor_total = (c["parked"] or ZERO) + (c["emergency"] or ZERO)
    lesson = v["lessons"][2] if len(v["lessons"]) >= 3 else None  # noqa: PLR2004 - lesson 3
    sub = [x for x in (v["focus"], v["guardrail"]) if x]
    return {
        "name": v["name"],
        "age": age(v["born"], today),
        "subline": " · ".join(
            [s[0].upper() + s[1:] if i == 0 else s[0].lower() + s[1:] for i, s in enumerate(sub)]
        ),
        "risk": v["risk"],
        "goalPct": road_.get("pct") if road_ else None,
        "dca": {
            "weeklyAud": _s(dca["weekly"], "1"),
            "day": dca["day"],
            "extraAud": _s(dca["extra"], "1"),
            "fearGreedBelow": dca["fearGreedBelow"],
            "maxMonthAud": _s(dca["maxMonth"], "1"),
        },
        "split": v["split"],
        "splitLabel": v["splitLabel"],
        "cash": {
            "totalAud": _s(floor_total, "1"),
            "floorAud": _s(c["floor"], "1"),
            "below": c["floor"] is not None and floor_total < c["floor"],
        },
        "chips": v["chips"],
        "openItems": v["openItems"],
        "lesson": lesson,
    }


def board(
    v: dict[str, Any],
    portfolio: dict[str, Any] | None,
    rate: Decimal,
    today: date,
    bought: bool | None,
) -> dict[str, Any]:
    road_ = road(v, _by_source(portfolio, rate), rate, today)
    return {
        "summary": summary(v, road_, today),
        "road": road_,
        "stack": stack(v, portfolio, rate, today, bought),
        "cash": cash(v, today),
        "fx": {
            "audPerUsd": _s(rate, "0.0001"),
            "date": portfolio["total"].get("audDate") if portfolio else None,
        },
    }
