"""The four risks that can end the plan (decision 79), ranked on the Risk page above the everyday
limits: money on Binance, the 2026 coins on the Ledger, TAO's share of crypto, and the Ledger's
backup. Each is a board row (risk.py's shape, so the daily check and the weekly review read them
too) with a `rank` and a `detail` for the page. Plain code from the desk's own figures.

The desk never withdraws and never stores a seed word, passphrase or the backup's location: the
backup checks keep dates only."""

import json
import math
from decimal import Decimal
from typing import Any, cast

from api.store import Store

ZERO = Decimal(0)
HUNDRED = Decimal(100)
STABLES = ("USDC", "USDT", "FDUSD")
AREA = "Big"
LEDGER = "Ledger"
EXCHANGE_CAP_AUD = Decimal(10_000)  # Profile 6.7: everything on Binance, coins and USDC
EXCHANGE_WARN_AUD = Decimal(8_000)
COLD_MIN = Decimal(70)  # Profile 6.7: 70%+ of the 2026 coins on the Ledger
COLD_WARN = Decimal(75)
TAO_TARGET = Decimal(60)  # Profile 7.1: TAO's share, reached with new money only
TAO_BY = "31 Dec 2027"
TAO_BY_MS = 1_830_258_000_000  # 31 Dec 2027, Sydney
DAY_MS = 86_400_000
WEEK_MS = 7 * DAY_MS
CHECK_DAYS = 182  # Profile 7.6: the backup checked every 6 months
THESIS_DAYS = 91  # the quarterly TAO question
CHECKS_KEY = "risk_checks"
CHECKS = (
    ("seed", "Seed backed up away from the device"),
    ("place", "Backup is where it should be, and readable"),
    ("pin", "Device PIN and passphrase known only to you"),
    ("heirs", "Inheritance plan: someone you trust can recover it"),
)
NO_EXPIRY = ("heirs",)
MARKS = (*(k for k, _ in CHECKS), "thesis")


def _d(value: object) -> Decimal:
    try:
        return Decimal(str(value)) if value not in (None, "") else ZERO
    except ArithmeticError:
        return ZERO


def _aud(value: Decimal) -> str:
    return f"A${value:,.0f}"


def _pct(value: Decimal) -> str:
    return f"{value.quantize(Decimal('1'))}%"


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def checks_of(store: Store) -> dict[str, int]:
    try:
        kept = json.loads(store.setting(CHECKS_KEY, "{}"))
    except json.JSONDecodeError:
        return {}
    return {k: int(v) for k, v in cast(dict[str, Any], kept).items() if k in MARKS and v}


def mark(store: Store, key: object, now_ms: int) -> None:
    """Records today against one backup check, or the TAO thesis still holding. Dates only."""
    if key not in MARKS:
        raise ValueError("Name a check.")
    kept = checks_of(store)
    kept[str(key)] = now_ms
    store.set_setting(CHECKS_KEY, json.dumps(kept))


def _big(  # noqa: PLR0913 - one of the four, each field named
    key: str,
    rank: int,
    name: str,
    state: str,
    *,
    figure: str,
    of: str,
    rule: str,
    words: str,
    meter: Decimal,
    mark_at: Decimal | None,
    short: str,
    detail: dict[str, Any],
) -> dict[str, Any]:
    return {
        "key": key,
        "area": AREA,
        "rank": rank,
        "name": name,
        "value": _money(meter),
        "warn": None,
        "limit": None if mark_at is None else _money(mark_at),
        "figure": figure,
        "of": of,
        "rule": rule,
        "owner": "you, on Risk",
        "state": state,
        "words": words,
        "short": short,
        "detail": detail,
    }


def _custody(  # noqa: PLR0914 - the exchange and the Ledger, worked out together
    holdings: list[dict[str, Any]], coins: list[str], rate: Decimal
) -> list[dict[str, Any]]:
    on_binance = [h for h in holdings if h.get("source", "Binance") == "Binance"]
    total = sum((_d(h.get("value")) * rate for h in on_binance), ZERO)
    dca = sum((_d(h.get("value")) * rate for h in on_binance if h["asset"] in coins), ZERO)
    stables = sum((_d(h.get("value")) * rate for h in on_binance if h["asset"] in STABLES), ZERO)
    per: dict[str, dict[str, Decimal]] = {
        c: {"ledger": ZERO, "binance": ZERO, "price": ZERO} for c in coins
    }
    ledger_set = any(h.get("source") == LEDGER for h in holdings)
    for h in holdings:
        if h["asset"] not in per:
            continue
        where = "ledger" if h.get("source") == LEDGER else "binance"
        if where == "binance" and h.get("source", "Binance") != "Binance":
            continue
        per[h["asset"]][where] += _d(h.get("value")) * rate
        per[h["asset"]]["price"] = _d(h.get("price")) * rate or per[h["asset"]]["price"]
    held_l = sum((p["ledger"] for p in per.values()), ZERO)
    held_b = sum((p["binance"] for p in per.values()), ZERO)
    both = held_l + held_b
    share = held_l / both * HUNDRED if both else HUNDRED

    # One move meets both rules: under the cap, and 70% of the 2026 coins on the Ledger.
    need = max(total - EXCHANGE_CAP_AUD, both * COLD_MIN / HUNDRED - held_l, ZERO)
    need = min(Decimal(math.ceil(need / 100) * 100), held_b)
    moves: list[dict[str, str]] = []
    left = need
    for coin, p in sorted(per.items(), key=lambda kv: kv[1]["binance"], reverse=True):
        if left <= ZERO or p["binance"] <= ZERO:
            continue
        take = min(p["binance"], left)
        left -= take
        qty = take / p["price"] if p["price"] else ZERO
        moves.append(
            {
                "coin": coin,
                "aud": _money(take),
                "qty": str(qty.quantize(Decimal("0.0001"))),
                "leaves": _money(p["binance"] - take),
            }
        )

    over = total - EXCHANGE_CAP_AUD
    ex_state = "broken" if over > ZERO else "near" if total >= EXCHANGE_WARN_AUD else "kept"
    exchange = _big(
        "big-exchange",
        1,
        "Money on Binance",
        ex_state,
        figure=_aud(total),
        of=_aud(EXCHANGE_CAP_AUD),
        rule="6.7",
        words="If the exchange fails, everything on it goes: coins and USDC alike.",
        meter=total,
        mark_at=EXCHANGE_CAP_AUD,
        short=f"{_aud(over)} over your Binance limit"
        if over > ZERO
        else f"{_aud(total)} on Binance",
        detail={
            "totalAud": _money(total),
            "capAud": _money(EXCHANGE_CAP_AUD),
            "dcaAud": _money(dca),
            "stablesAud": _money(stables),
            "otherAud": _money(total - dca - stables),
            "moveAud": _money(need),
            "moves": moves,
            "afterAud": _money(total - need),
        },
    )
    if not coins:
        cold_state = "kept"
    elif not ledger_set:
        cold_state = "broken"
    else:
        cold_state = "broken" if share < COLD_MIN else "near" if share < COLD_WARN else "kept"
    cold = _big(
        "big-cold",
        2,
        "2026 coins on the Ledger",
        cold_state,
        figure=_pct(share) if ledger_set else "Not set up",
        of=f"{_pct(COLD_MIN)} or more",
        rule="6.7",
        words="Measured apart from TAO, so its bag can't make up for coins left on the exchange."
        if ledger_set
        else "No Ledger addresses yet, so every 2026 coin counts as on the exchange.",
        meter=share if ledger_set else ZERO,
        mark_at=COLD_MIN,
        short=f"{_pct(share)} of your 2026 coins on the Ledger"
        if ledger_set
        else "no Ledger addresses yet",
        detail={
            "setUp": ledger_set,
            "sharePct": _money(share),
            "coins": [
                {
                    "coin": c,
                    "ledgerAud": _money(p["ledger"]),
                    "binanceAud": _money(p["binance"]),
                    "pct": _money(
                        p["ledger"] / (p["ledger"] + p["binance"]) * HUNDRED
                        if p["ledger"] + p["binance"]
                        else ZERO
                    ),
                }
                for c, p in per.items()
            ],
        },
    )
    return [exchange, cold]


def _tao(  # noqa: PLR0914 - share, glide path and P&L
    holdings: list[dict[str, Any]],
    rate: Decimal,
    weekly_aud: Decimal,
    thesis_at: int | None,
    now_ms: int,
) -> dict[str, Any] | None:
    crypto = [h for h in holdings if h["asset"] not in STABLES and h.get("value")]
    value = sum((_d(h.get("value")) * rate for h in crypto), ZERO)
    taos = [h for h in crypto if h["asset"] == "TAO"]
    tao = sum((_d(h.get("value")) * rate for h in taos), ZERO)
    if value <= ZERO or tao <= ZERO:
        return None
    other = value - tao
    share = tao / value * HUNDRED
    gap = tao / (TAO_TARGET / HUNDRED) - tao - other
    weeks = math.ceil(gap / weekly_aud) if gap > ZERO and weekly_aud > ZERO else 0
    reach = now_ms + weeks * WEEK_MS if weekly_aud > ZERO or gap <= ZERO else None
    on_track = reach is not None and reach <= TAO_BY_MS
    costed = [h for h in taos if h.get("profit") is not None]
    profit = sum((_d(h.get("profit")) * rate for h in costed), ZERO) if costed else None
    cost = tao - profit if profit is not None and len(costed) == len(taos) else None
    state = "kept" if share <= TAO_TARGET else "near" if on_track else "broken"
    due = thesis_at is None or now_ms - thesis_at > THESIS_DAYS * DAY_MS
    return _big(
        "big-tao",
        3,
        "TAO's share of crypto",
        state,
        figure=_pct(share),
        of=f"{_pct(TAO_TARGET)} by {TAO_BY}",
        rule="7.1",
        words="One coin, high conviction: new money goes elsewhere, and the desk never proposes "
        "selling it (Profile 6.3).",
        meter=share,
        mark_at=TAO_TARGET,
        short=f"TAO at {_pct(share)} of crypto"
        + ("" if on_track or share <= TAO_TARGET else ", off its glide path"),
        detail={
            "valueAud": _money(tao),
            "costAud": None if cost is None else _money(cost),
            "pnlAud": None if cost is None or profit is None else _money(profit),
            "cryptoAud": _money(value),
            "otherAud": _money(other),
            "weeklyAud": _money(weekly_aud),
            "targetPct": _money(TAO_TARGET),
            "by": TAO_BY,
            "weeks": weeks,
            "reach": reach,
            "onTrack": on_track,
            "thesisAt": thesis_at,
            "thesisDue": due,
        },
    )


def _backup(checks: dict[str, int], now_ms: int) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for key, label in CHECKS:
        at = checks.get(key)
        stale = at is not None and key not in NO_EXPIRY and now_ms - at > CHECK_DAYS * DAY_MS
        items.append(
            {
                "key": key,
                "label": label,
                "at": at,
                "due": None if at is None or key in NO_EXPIRY else at + CHECK_DAYS * DAY_MS,
                "state": "no" if at is None else "due" if stale else "ok",
            }
        )
    current = sum(1 for i in items if i["state"] == "ok")
    state = "broken" if checks.get("seed") is None else "near" if current < len(items) else "kept"
    return _big(
        "big-backup",
        4,
        "Ledger backup",
        state,
        figure=f"{current} of {len(items)}",
        of="checks current",
        rule="7.6",
        words="The seed is a single point of failure: checked every 6 months.",
        meter=Decimal(current) / Decimal(len(items)) * HUNDRED,
        mark_at=HUNDRED,
        short="the Ledger backup check is due" if state != "kept" else "the backup is checked",
        detail={"items": items},
    )


def big_four(
    portfolio: dict[str, Any], plan: dict[str, Any] | None, checks: dict[str, int], now_ms: int
) -> list[dict[str, Any]]:
    total = cast(dict[str, Any], portfolio.get("total") or {})
    rate = _d(total.get("audRate")) or Decimal(1)
    holdings = [
        h for h in cast(list[dict[str, Any]], portfolio.get("holdings") or []) if h.get("value")
    ]
    orders = cast(list[dict[str, Any]], (plan or {}).get("orders") or [])
    coins = list(dict.fromkeys(str(o["coin"]) for o in orders))
    weekly_aud = sum((_d(o.get("spend")) for o in orders), ZERO) * rate
    rows = _custody(holdings, coins, rate)
    tao = _tao(holdings, rate, weekly_aud, checks.get("thesis"), now_ms)
    if tao is not None:
        rows.append(tao)
    rows.append(_backup(checks, now_ms))
    return rows


def lead(rows: list[dict[str, Any]]) -> str | None:
    """The page's sentence from the four: what's broken, else what's near, else all kept."""
    bigs = sorted((r for r in rows if r["area"] == AREA), key=lambda r: r["rank"])
    if not bigs:
        return None
    broken = [r["short"] for r in bigs if r["state"] == "broken"]
    near = [r["short"] for r in bigs if r["state"] == "near"]
    if broken:
        words = broken[0] if len(broken) == 1 else f"{', '.join(broken[:-1])} and {broken[-1]}"
        return words[0].upper() + words[1:] + "."
    if near:
        return f"Your four big risks hold; to watch: {', '.join(near)}."
    return "Your four big risks are kept."
