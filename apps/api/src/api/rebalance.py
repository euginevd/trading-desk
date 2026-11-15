"""Drift from the Profile's target allocation (decisions 55 and 58): each target coin's share
now against its target, outside the rebalance band if one is set, and the limit order that would
bring it back, within the per-trade size if one is set. Shown and prefilled only; the owner
confirms each.
"""

from decimal import Decimal
from typing import Any

from api.binance import plain
from api.tax import aud_rate

STABLES = ("USDT", "USDC", "FDUSD")


def drift(portfolio: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    """Each target against now, with the trade back to target for those outside the band."""
    total_usd = Decimal(portfolio["total"]["value"] or "0")
    rate = aud_rate(portfolio)
    rules = plan["rules"]
    band = Decimal(rules["rebalance_band"]) if rules["rebalance_band"] else None
    budget = Decimal(rules["per_trade_aud"]) if rules["per_trade_aud"] else None
    values: dict[str, Decimal] = {}
    prices: dict[str, Decimal] = {}
    on_binance: dict[str, Decimal] = {}
    for h in portfolio["holdings"]:
        coin = h["asset"]
        values[coin] = values.get(coin, Decimal(0)) + Decimal(h.get("value") or "0")
        if h.get("price"):
            prices[coin] = Decimal(h["price"])
        if h.get("source") == "Binance":
            on_binance[coin] = on_binance.get(coin, Decimal(0)) + Decimal(h.get("amount") or "0")
    rows: list[dict[str, Any]] = []
    for target in plan["strategy"]["targets"]:
        coin, want = target["coin"], Decimal(target["pct"])
        if coin in STABLES:
            continue  # cash: what's left over, not something to trade toward
        now = values.get(coin, Decimal(0)) / total_usd * 100 if total_usd else Decimal(0)
        gap = want - now
        outside = band is not None and abs(gap) > band
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
            order_aud = min(aud, budget) if budget is not None else aud
            qty = order_aud / rate / price if price else None
            if qty is not None and gap < 0:  # a sale can't be more than Binance holds
                qty = min(qty, on_binance.get(coin, Decimal(0)))
                order_aud = qty * price * rate if price else order_aud
            row |= {
                "side": "buy" if gap > 0 else "sell",
                "toTargetAud": plain(aud.quantize(Decimal(1))),
                "orderAud": plain(order_aud.quantize(Decimal(1))),
                "price": plain(price) if price else None,
                "qty": plain(qty.quantize(Decimal("0.00000001"))) if qty is not None else None,
                "capped": aud > order_aud,
            }
        rows.append(row)
    return {
        "band": plain(band) if band is not None else None,
        "rows": rows,
        "outside": sum(1 for r in rows if r["outside"]),
        "hasTargets": bool(rows),
    }
