"""The Profile against live data (decision 58): the top strip, each holding's value now, a live
check beside each rule, the Foundations' status, and the pre-trade check every buy passes.
All worked out here; a rule the owner hasn't set is never checked."""

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

from api.binance import plain
from api.profile import rule
from api.store import Store
from api.tax import aud_rate

SYDNEY = ZoneInfo("Australia/Sydney")
ZERO = Decimal(0)
HUNDRED = Decimal(100)
STABLES = ("USDT", "USDC", "FDUSD")
SOURCES = {"binance": "Binance", "taostats": "Ledger"}  # taostats: the Ledger (99)
RATE_KEY = "aud_per_usd"
HELD_KEY = "last_coin_values"
NEAR = Decimal(80)  # % of a cap used: attention from here
NEAR_POINTS = Decimal(5)  # points under the max per coin: attention from here
DUST = Decimal(1)


def _q(value: Decimal, places: str = "1") -> str:
    return plain(value.quantize(Decimal(places)))


def month_start_ms(now: datetime) -> int:
    start = now.astimezone(SYDNEY).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return int(start.timestamp() * 1000)


def month_spent_aud(store: Store, rate: Decimal, now: datetime) -> Decimal:
    """This month's buys on the desk, the owner's and the bots', in AUD: what the monthly cap
    counts (decision 58)."""
    return store.spent_since(month_start_ms(now)) * rate


def remember_rate(store: Store, portfolio: dict[str, Any]) -> Decimal:
    """The AUD rate and each coin's value the portfolio was read at, kept for the bots, which
    have no portfolio of their own."""
    rate = aud_rate(portfolio)
    store.set_setting(RATE_KEY, plain(rate))
    values: dict[str, str] = {}
    for h in portfolio["holdings"]:
        values[h["asset"]] = plain(
            Decimal(values.get(h["asset"], "0")) + Decimal(h.get("value") or "0")
        )
    held = {"total": str(portfolio["total"]["value"] or "0"), "values": values}
    store.set_setting(HELD_KEY, json.dumps(held))
    return rate


def _last_held(store: Store) -> dict[str, Any] | None:
    raw = store.setting(HELD_KEY, "")
    return cast(dict[str, Any], json.loads(raw)) if raw else None


def coin_shares(portfolio: dict[str, Any]) -> dict[str, Decimal]:
    """Each coin's share of the whole portfolio, in %, Binance and the wallet together."""
    total = Decimal(portfolio["total"]["value"] or "0")
    values: dict[str, Decimal] = {}
    for h in portfolio["holdings"]:
        if h["asset"] in STABLES or not h.get("value"):
            continue
        values[h["asset"]] = values.get(h["asset"], ZERO) + Decimal(h["value"])
    return {c: v / total * HUNDRED for c, v in values.items() if total and v >= DUST}


def holdings(doc: dict[str, Any], portfolio: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Each holding with its value now: Binance's and the wallet's live, a manual one as typed.
    A live source counts once, on the first holding that names it."""
    rate = aud_rate(portfolio) if portfolio else None
    live: dict[str, Decimal] = {}
    if portfolio and rate is not None:
        for h in portfolio["holdings"]:
            live[h["source"]] = live.get(h["source"], ZERO) + Decimal(h.get("value") or "0")
    used: set[str] = set()
    rows: list[dict[str, Any]] = []
    for item in doc["holdings"]:
        now: Decimal | None = None
        if item["source"] == "manual":
            now = Decimal(item["value_aud"]) if item["value_aud"] is not None else None
        elif portfolio is not None and rate is not None and item["source"] not in used:
            used.add(item["source"])
            now = live.get(SOURCES[item["source"]], ZERO) * rate
        invested = Decimal(item["invested_aud"]) if item["invested_aud"] is not None else None
        pnl = now - invested if now is not None and invested is not None else None
        rows.append(
            item
            | {
                "now_aud": _q(now) if now is not None else None,
                "pnl_aud": _q(pnl) if pnl is not None else None,
                "pnl_pct": _q(pnl / invested * HUNDRED, "0.1")
                if pnl is not None and invested
                else None,
            }
        )
    return rows


def _goal_progress(doc: dict[str, Any], total_aud: Decimal, rate: Decimal, today: date) -> Any:
    for goal in doc["goals"]:
        amount = Decimal(goal["amount"])
        have = total_aud / rate if goal["currency"] == "USD" else total_aud
        due = date.fromisoformat(goal["date"]) if goal["date"] else None
        if (due is None or due >= today) and have < amount:
            return goal | {"pct": _q(have / amount * HUNDRED, "0.1"), "have": _q(have)}
    return None


def strip(
    doc: dict[str, Any],
    rows: list[dict[str, Any]],
    portfolio: dict[str, Any] | None,
    spent: Decimal,
    today: date,
) -> dict[str, Any]:
    """Total now, the next goal, the cash floor and this month's buys against the cap."""
    rate = aud_rate(portfolio) if portfolio else Decimal("1.5")
    counted = [Decimal(r["now_aud"]) for r in rows if r["counts"] and r["now_aud"] is not None]
    if counted:
        total = sum(counted, ZERO)
    else:  # no holdings listed: the portfolio's own total
        total = Decimal(portfolio["total"]["value"] or "0") * rate if portfolio else ZERO
    cash_rows = [Decimal(r["now_aud"]) for r in rows if r["cash"] and r["now_aud"] is not None]
    cash = sum(cash_rows, ZERO) if cash_rows else None
    floor = (
        Decimal(doc["foundations"]["min_cash_aud"]) if doc["foundations"]["min_cash_aud"] else None
    )
    cap = rule(doc, "monthly_deposit_cap_aud")
    return {
        "totalAud": _q(total),
        "totalUsd": _q(total / rate),
        "nextGoal": _goal_progress(doc, total, rate, today),
        "cash": {
            "now": _q(cash) if cash is not None else None,
            "floor": plain(floor) if floor is not None else None,
            "pct": _q(cash / floor * HUNDRED) if cash is not None and floor else None,
            "status": _status(cash, floor, below_is_bad=True),
        },
        "month": {
            "spent": _q(spent),
            "cap": plain(cap) if cap is not None else None,
            "pct": _q(spent / cap * HUNDRED) if cap else None,
            "status": _status(spent, cap, below_is_bad=False),
        },
    }


def _status(value: Decimal | None, limit: Decimal | None, *, below_is_bad: bool) -> str:
    if value is None or limit is None:
        return "unset"
    if below_is_bad:
        return "ok" if value >= limit else "attention"
    if value > limit:
        return "broken"
    return "attention" if limit and value / limit * HUNDRED >= NEAR else "ok"


def rule_checks(
    doc: dict[str, Any], portfolio: dict[str, Any] | None, spent: Decimal
) -> dict[str, dict[str, str]]:
    """A live check beside each rule that can be checked; unset rules say so."""
    found: dict[str, dict[str, str]] = {}
    cap = rule(doc, "monthly_deposit_cap_aud")
    if cap is not None:
        found["monthly_deposit_cap_aud"] = {
            "status": _status(spent, cap, below_is_bad=False),
            "text": f"A${spent:,.0f} bought this month of A${cap:,.0f}",
        }
    shares = coin_shares(portfolio) if portfolio else {}
    most = rule(doc, "max_pct_per_coin")
    if most is not None and shares:
        coin, share = max(shares.items(), key=lambda kv: kv[1])
        state = "broken" if share > most else "attention" if share >= most - NEAR_POINTS else "ok"
        found["max_pct_per_coin"] = {"status": state, "text": f"{coin} {share:.0f}% vs max {most}%"}
    loss = rule(doc, "max_loss_pct")
    if loss is not None and portfolio:
        worst = _worst(portfolio)
        if worst is not None:
            coin, pct = worst
            state = "broken" if -pct >= loss else "ok"
            found["max_loss_pct"] = {"status": state, "text": f"{coin} {pct:.1f}% vs max −{loss}%"}
    band = rule(doc, "rebalance_band")
    targets = doc["strategy"]["targets"]
    if band is not None and targets and shares:
        out = [
            t["coin"]
            for t in targets
            if abs(shares.get(t["coin"], ZERO) - Decimal(t["pct"])) > band
        ]
        found["rebalance_band"] = {
            "status": "attention" if out else "ok",
            "text": f"Outside the band: {', '.join(out)}"
            if out
            else "Every target within the band",
        }
    if rule(doc, "per_trade_aud") is not None:
        found["per_trade_aud"] = {"status": "ok", "text": "Checked before each buy"}
    return found


def _worst(portfolio: dict[str, Any]) -> tuple[str, Decimal] | None:
    losses = [
        (str(h["asset"]), Decimal(h["profitPercent"]))
        for h in portfolio["holdings"]
        if h.get("profitPercent") is not None and h["asset"] not in STABLES
    ]
    return min(losses, key=lambda t: t[1]) if losses else None


def foundations(doc: dict[str, Any], cash: str | None) -> dict[str, str]:
    """Each Foundations item's status: done, parked, below or unset."""
    f = doc["foundations"]
    floor = Decimal(f["min_cash_aud"]) if f["min_cash_aud"] else None
    if floor is None:
        min_cash = "unset"
    elif cash is None:
        min_cash = "parked"
    else:
        min_cash = "done" if Decimal(cash) >= floor else "below"
    debt = (f["debt"] or "").strip().lower()
    return {
        "emergency_fund_aud": "done" if f["emergency_fund_aud"] else "unset",
        "parked_funds_aud": "parked" if f["parked_funds_aud"] else "unset",
        "min_cash_aud": min_cash,
        "insurance": "done" if f["insurance"] else "unset",
        "health_cover_status": {"active": "done", "parked": "parked", "none": "below"}.get(
            f["health_cover_status"] or "", "unset"
        ),
        "debt": "unset" if not debt else "done" if debt in ("none", "no", "nil") else "parked",
        "wills": "done" if f["wills"] else "unset",
    }


# The pre-trade check (decision 58).


def breaks(
    doc: dict[str, Any],
    *,
    spend_aud: Decimal,
    month_aud: Decimal,
    share_after: Decimal | None,
    coin: str,
) -> list[dict[str, str]]:
    """The set rules a buy would break, each named, with what it would do."""
    found: list[dict[str, str]] = []
    cap = rule(doc, "monthly_deposit_cap_aud")
    if cap is not None and month_aud + spend_aud > cap:
        found.append(
            {
                "rule": "monthly_deposit_cap_aud",
                "label": "Monthly deposit cap",
                "message": f"This buy of A${spend_aud:,.0f} takes this month to "
                f"A${month_aud + spend_aud:,.0f}, over your A${cap:,.0f} cap.",
            }
        )
    size = rule(doc, "per_trade_aud")
    if size is not None and spend_aud > size:
        found.append(
            {
                "rule": "per_trade_aud",
                "label": "Per-trade size",
                "message": f"A${spend_aud:,.0f} is over your A${size:,.0f} per-trade size.",
            }
        )
    most = rule(doc, "max_pct_per_coin")
    if most is not None and share_after is not None and share_after > most:
        found.append(
            {
                "rule": "max_pct_per_coin",
                "label": "Max % per coin",
                "message": f"{coin} would be {share_after:.0f}% of your portfolio, over your "
                f"{most}% max per coin.",
            }
        )
    return found


def share_after(portfolio: dict[str, Any], coin: str, spend_usd: Decimal) -> Decimal | None:
    """The coin's share once a buy fills: cash becomes coin, so the total doesn't change."""
    total = Decimal(portfolio["total"]["value"] or "0")
    if total <= ZERO:
        return None
    held = sum(
        (Decimal(h.get("value") or "0") for h in portfolio["holdings"] if h["asset"] == coin), ZERO
    )
    return (held + spend_usd) / total * HUNDRED


def bot_problem(
    store: Store, doc: dict[str, Any], spend_usd: Decimal, now: datetime, coin: str
) -> str | None:
    """A bot can't confirm a second time, so a buy that breaks a set rule waits (decision 58).
    The share per coin comes from the last portfolio reading; with none, the buy waits too."""
    rate = Decimal(store.setting(RATE_KEY, "1.5"))
    held = _last_held(store)
    share = None
    if held and Decimal(held["total"]) > ZERO:
        value = Decimal(held["values"].get(coin, "0"))
        share = (value + spend_usd) / Decimal(held["total"]) * HUNDRED
    if share is None and rule(doc, "max_pct_per_coin") is not None:
        return "Waiting: your portfolio hasn't been read yet, so max % per coin can't be checked."
    found = breaks(
        doc,
        spend_aud=spend_usd * rate,
        month_aud=month_spent_aud(store, rate, now),
        share_after=share,
        coin=coin,
    )
    return f"Waiting: breaks your {found[0]['label'].lower()}." if found else None
