"""Tax lots and the 12-month CGT discount countdown (decision 54). Estimates for the owner's
records, not tax advice.

Each buy since the cost start date (1 Jul 2026, decision 34) is a lot with its cost in AUD at
the day's rate; sales use lots first in, first out. Whatever is held beyond those buys, bought
before the start date or moved in from elsewhere (the TAO wallet among them), is one lot of
unknown age and cost, used first. A lot qualifies for the discount once held more than 12
months; this follows today's rule, not the proposed 2027 change.
"""

from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

from api.binance import plain
from api.ledger import Fill

SYDNEY = ZoneInfo("Australia/Sydney")
ZERO = Decimal(0)
DUST = Decimal("0.00000001")
STABLES = ("USDT", "USDC", "FDUSD")
FY_FIRST_MONTH = 7


@dataclass(frozen=True)
class Lot:
    coin: str
    bought: date | None  # None: before the start date, or moved in; age unknown
    qty: Decimal
    unit_aud: Decimal | None  # cost per coin in AUD; None when unknown
    order: str = ""  # PAIR:order id it was bought in; "" for the opening lot


@dataclass(frozen=True)
class Sale:
    coin: str
    order: str  # PAIR:order id: Binance's ids are unique within a pair only
    day: date
    qty: Decimal
    proceeds_aud: Decimal
    cost_aud: Decimal | None
    bought: date | None

    @property
    def gain(self) -> Decimal | None:
        return None if self.cost_aud is None else self.proceeds_aud - self.cost_aud

    @property
    def discounted(self) -> bool:
        return self.bought is not None and qualifies(self.bought) <= self.day


def qualifies(bought: date) -> date:
    """The first day a lot bought on `bought` counts as held more than 12 months."""
    try:
        anniversary = bought.replace(year=bought.year + 1)
    except ValueError:  # 29 February
        anniversary = bought.replace(year=bought.year + 1, day=28)
    return date.fromordinal(anniversary.toordinal() + 1)


def fy_of(day: date) -> int:
    """The financial year a day falls in, by its starting year: 2026 for 2026-27."""
    return day.year if day.month >= FY_FIRST_MONTH else day.year - 1


def _take(lots: list[Lot], qty: Decimal) -> tuple[list[tuple[Lot, Decimal]], list[Lot]]:
    """Takes qty from the oldest lots: what was taken from each, and the lots left."""
    taken: list[tuple[Lot, Decimal]] = []
    left = list(lots)
    while qty > DUST and left:
        lot = left[0]
        part = min(lot.qty, qty)
        taken.append((lot, part))
        qty -= part
        if lot.qty - part > DUST:
            left[0] = replace(lot, qty=lot.qty - part)
        else:
            left.pop(0)
    if qty > DUST:  # sold more than the record shows: count it as unknown
        taken.append((Lot("", None, qty, None), qty))
    return taken, left


def build(fills: list[Fill], held: dict[str, Decimal]) -> tuple[dict[str, list[Lot]], list[Sale]]:
    """The lots left for each coin, and every sale, from the fills and what's held now."""
    lots: dict[str, list[Lot]] = {}
    sales: list[Sale] = []
    coins = {f.coin for f in fills} | set(held)
    for coin in sorted(coins):
        mine = [f for f in fills if f.coin == coin]
        net = sum((f.qty if f.buy else -f.qty for f in mine), ZERO)
        opening = held.get(coin, ZERO) - net
        queue = [Lot(coin, None, opening, None)] if opening > DUST else []
        for fill in mine:
            if fill.buy:
                last = queue[-1] if queue else None
                if last and last.order == fill.order:  # one order's fills, one lot
                    qty = last.qty + fill.qty
                    unit = (last.qty * (last.unit_aud or ZERO) + fill.aud) / qty
                    queue[-1] = replace(last, qty=qty, unit_aud=unit)
                else:
                    queue.append(Lot(coin, fill.day, fill.qty, fill.aud / fill.qty, fill.order))
                continue
            taken, queue = _take(queue, fill.qty)
            unit = fill.aud / fill.qty
            for lot, part in taken:
                cost = lot.unit_aud * part if lot.unit_aud is not None else None
                sales.append(Sale(coin, fill.order, fill.day, part, unit * part, cost, lot.bought))
        lots[coin] = queue
    return lots, sales


def _lot_view(lot: Lot, price_aud: Decimal | None, today: date) -> dict[str, Any]:
    now = lot.qty * price_aud if price_aud is not None else None
    cost = lot.qty * lot.unit_aud if lot.unit_aud is not None else None
    on = qualifies(lot.bought) if lot.bought else None
    return {
        "coin": lot.coin,
        "bought": lot.bought.isoformat() if lot.bought else None,
        "qty": plain(lot.qty),
        "costAud": plain(cost.quantize(Decimal("0.01"))) if cost is not None else None,
        "nowAud": plain(now.quantize(Decimal("0.01"))) if now is not None else None,
        "gainAud": plain((now - cost).quantize(Decimal("0.01")))
        if now is not None and cost is not None
        else None,
        "heldDays": (today - lot.bought).days if lot.bought else None,
        "qualifiesOn": on.isoformat() if on else None,
        "daysToDiscount": max((on - today).days, 0) if on else None,
    }


def aud_rate(portfolio: dict[str, Any]) -> Decimal:
    """US dollars to AUD, as the portfolio was valued."""
    total = cast(dict[str, Any], portfolio["total"])
    rates = cast(dict[str, str], total.get("rates") or {})
    return Decimal(rates.get("AUD") or total.get("audRate") or "1.5")


def prices_aud(portfolio: dict[str, Any]) -> dict[str, Decimal]:
    """Each coin's price now in AUD, from the portfolio's US dollar prices."""
    rate = aud_rate(portfolio)
    return {
        h["asset"]: Decimal(h["price"]) * rate
        for h in portfolio["holdings"]
        if h.get("price") and h["asset"] not in STABLES
    }


def held_of(portfolio: dict[str, Any]) -> dict[str, Decimal]:
    held: dict[str, Decimal] = {}
    for h in portfolio["holdings"]:
        if h["asset"] not in STABLES:
            held[h["asset"]] = held.get(h["asset"], ZERO) + Decimal(h["amount"])
    return held


def report(fills: list[Fill], portfolio: dict[str, Any], today: date) -> dict[str, Any]:
    """The Tax tab: this year's realised gains and losses, the lots, the next to qualify, and
    the holdings under water before 30 June."""
    lots, sales = build(fills, held_of(portfolio))
    prices = prices_aud(portfolio)
    fy = fy_of(today)
    this_year = [s for s in sales if fy_of(s.day) == fy]
    gains = sum((s.gain for s in this_year if s.gain is not None and s.gain > 0), ZERO)
    losses = sum((s.gain for s in this_year if s.gain is not None and s.gain < 0), ZERO)
    rows = [
        _lot_view(lot, prices.get(coin), today)
        for coin, queue in lots.items()
        for lot in queue
        if lot.qty > DUST and coin in prices
    ]
    waiting = [r for r in rows if r["daysToDiscount"] is not None and r["daysToDiscount"] > 0]
    nxt = min(waiting, key=lambda r: r["daysToDiscount"]) if waiting else None
    under = _under_water(rows, gains + losses)
    return {
        "fy": f"{fy}-{(fy + 1) % 100:02d}",
        "realisedGainsAud": plain(gains.quantize(Decimal("0.01"))),
        "realisedLossesAud": plain(losses.quantize(Decimal("0.01"))),
        "sales": len(this_year),
        "unknownSales": sum(1 for s in this_year if s.gain is None),
        "discountedAud": plain(
            sum((max(r_gain(r), ZERO) for r in rows if r["daysToDiscount"] == 0), ZERO).quantize(
                Decimal("0.01")
            )
        ),
        "next": nxt,
        "lots": sorted(rows, key=lambda r: (r["bought"] or "", r["coin"])),
        "underWater": under,
    }


def r_gain(row: dict[str, Any]) -> Decimal:
    return Decimal(row["gainAud"]) if row["gainAud"] is not None else ZERO


def _under_water(rows: list[dict[str, Any]], net_gains: Decimal) -> list[dict[str, Any]]:
    """Coins whose lots with a known cost are under water, biggest loss first, with this
    year's net gains after each: what selling would offset. No suggestion to sell."""
    by_coin: dict[str, Decimal] = {}
    for r in rows:
        if r["gainAud"] is not None:
            by_coin[r["coin"]] = by_coin.get(r["coin"], ZERO) + Decimal(r["gainAud"])
    out: list[dict[str, Any]] = []
    running = net_gains
    for coin, gain in sorted(by_coin.items(), key=lambda kv: kv[1]):
        if gain >= 0:
            continue
        running += gain
        out.append(
            {
                "coin": coin,
                "lossAud": plain(gain.quantize(Decimal("0.01"))),
                "afterAud": plain(running.quantize(Decimal("0.01"))),
            }
        )  # noqa: E501
    return out


def sell_check(
    fills: list[Fill], portfolio: dict[str, Any], coin: str, qty: Decimal, today: date
) -> dict[str, Any]:
    """Which lots a sale of qty would use, first in first out, and whether any is under 12
    months: for the warning on the sell form."""
    lots, _ = build(fills, held_of(portfolio))
    taken, _ = _take(lots.get(coin, []), qty)
    price = prices_aud(portfolio).get(coin)
    used = [_lot_view(replace(lot, qty=part, coin=coin), price, today) for lot, part in taken]
    young = [u for u in used if u["daysToDiscount"]]
    gains = [Decimal(u["gainAud"]) for u in used if u["gainAud"] is not None]
    return {
        "coin": coin,
        "qty": plain(qty),
        "lots": used,
        "young": bool(young),
        "youngest": min(young, key=lambda u: u["heldDays"]) if young else None,
        "gainAud": plain(sum(gains, ZERO).quantize(Decimal("0.01"))) if gains else None,
        "unknown": any(u["bought"] is None for u in used),
    }


def today_sydney() -> date:
    return datetime.now(UTC).astimezone(SYDNEY).date()
