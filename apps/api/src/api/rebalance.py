"""Drift from the Plan's target allocation (decision 55): each target coin's share now against
its target, outside a band set on the Plan (default ±5 points), and the limit order that would
bring it back, within the per-trade size. Shown and prefilled only; the owner confirms each.
"""

from decimal import Decimal
from typing import Any

from api.binance import plain
from api.tax import aud_rate

DEFAULT_BAND = Decimal(5)
STABLES = ("USDT", "USDC", "FDUSD")


def drift(portfolio: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    """Each target against now, with the trade back to target for those outside the band."""
    total_usd = Decimal(portfolio["total"]["value"] or "0")
    rate = aud_rate(portfolio)
    rules = plan["rules"]
    band = Decimal(rules.get("driftBand") or DEFAULT_BAND)
    budget = Decimal(rules["tradeBudgetAud"])
    values: dict[str, Decimal] = {}
    prices: dict[str, Decimal] = {}
    for h in portfolio["holdings"]:
        coin = h["asset"]
        values[coin] = values.get(coin, Decimal(0)) + Decimal(h.get("value") or "0")
        if h.get("price"):
            prices[coin] = Decimal(h["price"])
    rows: list[dict[str, Any]] = []
    for target in plan["goals"]["targets"]:
        coin, want = target["coin"], Decimal(target["pct"])
        now = values.get(coin, Decimal(0)) / total_usd * 100 if total_usd else Decimal(0)
        gap = want - now
        outside = abs(gap) > band
        row: dict[str, Any] = {
            "coin": coin,
            "targetPct": plain(want),
            "nowPct": plain(now.quantize(Decimal("0.1"))),
            "outside": outside,
            "side": None,
        }
        if outside and total_usd:
            aud = abs(gap) / 100 * total_usd * rate
            price = prices.get(coin)
            row |= {
                "side": "buy" if gap > 0 else "sell",
                "toTargetAud": plain(aud.quantize(Decimal(1))),
                "orderAud": plain(min(aud, budget).quantize(Decimal(1))),
                "price": plain(price) if price else None,
                "qty": plain((min(aud, budget) / rate / price).quantize(Decimal("0.00000001")))
                if price
                else None,
                "capped": aud > budget,
            }
        rows.append(row)
    return {
        "band": plain(band),
        "rows": rows,
        "outside": sum(1 for r in rows if r["outside"]),
        "hasTargets": bool(rows),
    }
