"""The trading journal (decision 56): every filled order the desk can see, with where it came
from, its result, the rules it broke (checked from the Plan) and the owner's setup and mistake
tags; and a 30-day score of how well the rules were kept.
"""

import json
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from api.binance import plain
from api.ledger import Fill
from api.store import Store
from api.tax import Sale
from api.trading import Refused

SYDNEY = ZoneInfo("Australia/Sydney")
LISTS_KEY = "journal_tag_lists"
TAGS_KEY = "journal_tags"
DEFAULT_LISTS = {
    "setups": ["Support buy", "DCA ladder", "Breakout", "Rebalance", "Take profit"],
    "mistakes": ["FOMO", "Chased", "Moved stop", "No plan", "Too big"],
}
WINDOW_DAYS = 30
TAG = re.compile(r"[\w &'+./-]{1,30}")
KEY = re.compile(r"[A-Z0-9]{2,20}:\d{1,20}")


@dataclass(frozen=True)
class Entry:
    key: str
    coin: str
    side: str
    time: int
    day: date
    qty: Decimal
    price: Decimal
    aud: Decimal
    order_id: int


def entries(fills: list[Fill]) -> list[Entry]:
    """One entry per order: its fills summed, at their average price."""
    grouped: dict[str, list[Fill]] = {}
    for f in fills:
        grouped.setdefault(f"{f.symbol}:{f.order_id}", []).append(f)
    out: list[Entry] = []
    for key, group in grouped.items():
        qty = sum((f.qty for f in group), Decimal(0))
        quote = sum((f.quote for f in group), Decimal(0))
        first = group[0]
        out.append(
            Entry(
                key=key,
                coin=first.coin,
                side="buy" if first.buy else "sell",
                time=first.time,
                day=first.day,
                qty=qty,
                price=quote / qty if qty else Decimal(0),
                aud=sum((f.aud for f in group), Decimal(0)),
                order_id=first.order_id,
            )
        )
    return sorted(out, key=lambda e: e.time, reverse=True)


def lists(store: Store) -> dict[str, list[str]]:
    raw = store.setting(LISTS_KEY, "")
    return json.loads(raw) if raw else DEFAULT_LISTS


def _tags(store: Store) -> dict[str, dict[str, list[str]]]:
    raw = store.setting(TAGS_KEY, "")
    return json.loads(raw) if raw else {}


def _clean(values: object, allowed: list[str] | None = None) -> list[str]:
    if not isinstance(values, list):
        raise Refused("Send a list of tags.")
    out: list[str] = []
    for value in values:  # pyright: ignore[reportUnknownVariableType]
        tag = " ".join(str(value).split())  # pyright: ignore[reportUnknownArgumentType]
        if not TAG.fullmatch(tag):
            raise Refused("A tag is up to 30 letters, numbers or simple marks.")
        if allowed is not None and tag not in allowed:
            raise Refused(f"{tag} isn't one of your tags. Add it to the list first.")
        if tag not in out:
            out.append(tag)
    return out[:20]


def set_lists(store: Store, body: dict[str, Any]) -> dict[str, list[str]]:
    kept = {"setups": _clean(body.get("setups")), "mistakes": _clean(body.get("mistakes"))}
    store.set_setting(LISTS_KEY, json.dumps(kept))
    return kept


def tag(store: Store, body: dict[str, Any]) -> dict[str, list[str]]:
    """Sets one trade's setup and mistake tags, from the owner's lists."""
    key = str(body.get("key", ""))
    if not KEY.fullmatch(key):
        raise Refused("That isn't a trade in the journal.")
    known = lists(store)
    chosen = {
        "setups": _clean(body.get("setups", []), known["setups"]),
        "mistakes": _clean(body.get("mistakes", []), known["mistakes"]),
    }
    every = _tags(store)
    every[key] = chosen
    store.set_setting(TAGS_KEY, json.dumps(every))
    return chosen


def _breaches(  # noqa: PLR0913 - each is a separate fact the checks need
    e: Entry,
    rules: dict[str, Any],
    over_cap_now: set[str],
    deposits_over: set[str],
) -> list[str]:
    """The Plan's rules a buy broke: size, a coin over its cap, deposits over the cap that month."""
    if e.side != "buy":
        return []
    broke: list[str] = []
    size = rules["per_trade_aud"]
    if size is not None and e.aud > Decimal(size):
        broke.append("Over per-trade size")
    if e.coin in over_cap_now:
        broke.append(f"{e.coin} over its cap")
    if f"{e.day:%Y-%m}" in deposits_over:
        broke.append("Deposits over cap that month")
    return broke


def view(  # noqa: PLR0913, PLR0917 - every input is a separate source
    store: Store,
    fills: list[Fill],
    sales: list[Sale],
    plan: dict[str, Any],
    over_cap_now: set[str],
    deposit_months: dict[str, Decimal],
    today: date,
) -> dict[str, Any]:
    """The Journal page: the entries, newest first, and the 30-day score."""
    rules = plan["rules"]
    cap = Decimal(rules["monthly_deposit_cap_aud"]) if rules["monthly_deposit_cap_aud"] else None

    deposits_over = {m for m, aud in deposit_months.items() if cap is not None and aud > cap}
    sources = store.order_sources()
    tags = _tags(store)
    gains: dict[str, Decimal] = {}
    unknown: set[str] = set()
    for sale in sales:
        if sale.gain is None:
            unknown.add(sale.order)
        else:
            gains[sale.order] = gains.get(sale.order, Decimal(0)) + sale.gain
    rows: list[dict[str, Any]] = []
    for e in entries(fills):
        broke = _breaches(e, rules, over_cap_now, deposits_over)
        mine = tags.get(e.key, {"setups": [], "mistakes": []})
        result = None if e.side == "buy" or e.key in unknown else gains.get(e.key)
        rows.append(
            {
                "key": e.key,
                "time": e.time,
                "coin": e.coin,
                "side": e.side,
                "qty": plain(e.qty),
                "price": plain(e.price),
                "aud": plain(e.aud.quantize(Decimal("0.01"))),
                "from": sources.get(e.key, "Order form or Binance app"),
                "resultAud": plain(result.quantize(Decimal("0.01")))
                if result is not None
                else None,
                "broke": broke,
                "setups": mine["setups"],
                "mistakes": mine["mistakes"],
            }
        )
    return {"entries": rows, "score": score(rows, today), "lists": lists(store)}


def _day(ms: int) -> date:
    return datetime.fromtimestamp(ms / 1000, UTC).astimezone(SYDNEY).date()


def score(rows: list[dict[str, Any]], today: date) -> dict[str, Any]:
    """The last 30 days: trades, how many kept every rule (no breach, no mistake tag), what
    was broken most, and the realised result with and without a mistake tag."""
    since = today - timedelta(days=WINDOW_DAYS)
    recent = [r for r in rows if _day(r["time"]) >= since]
    kept = [r for r in recent if not r["broke"] and not r["mistakes"]]
    counts: dict[str, int] = {}
    for r in recent:
        for what in [*r["broke"], *r["mistakes"]]:
            counts[what] = counts.get(what, 0) + 1
    most = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:3]

    def total(group: list[dict[str, Any]]) -> str:
        found = [Decimal(r["resultAud"]) for r in group if r["resultAud"] is not None]
        return plain(sum(found, Decimal(0)).quantize(Decimal("0.01")))

    return {
        "days": WINDOW_DAYS,
        "trades": len(recent),
        "kept": len(kept),
        "keptPct": plain(Decimal(len(kept) * 100 // len(recent))) if recent else None,
        "mostBroken": [{"what": w, "times": n} for w, n in most],
        "withMistakeAud": total([r for r in recent if r["mistakes"]]),
        "withoutMistakeAud": total([r for r in recent if not r["mistakes"]]),
    }
