"""Works out the portfolio from Binance's replies (decision 9). Pure: no network, easy to test."""

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

STABLES = ("USDT", "USDC", "FDUSD")
QUOTES = (*STABLES, "BTC", "ETH", "BNB")
RECENT_TRADES = 20
ZERO = Decimal(0)
HUNDRED = Decimal(100)


@dataclass(frozen=True)
class Cost:
    """What a coin's trades against stablecoins say it cost: the average, and how much it covers."""

    average: Decimal | None
    covered: Decimal


def pair(symbol: str) -> str:
    for quote in QUOTES:
        if symbol.endswith(quote) and len(symbol) > len(quote):
            return f"{symbol[: -len(quote)]}/{quote}"
    return symbol


def average_cost(asset: str, trades: Iterable[dict[str, Any]]) -> Cost:
    """Average cost, oldest trade first: buys add at their price, sells take out at the average."""
    held = ZERO
    cost = ZERO
    for trade in sorted(trades, key=lambda t: int(t["time"])):
        qty = Decimal(str(trade["qty"]))
        price = Decimal(str(trade["price"]))
        fee = Decimal(str(trade["commission"]))
        fee_asset = str(trade["commissionAsset"])
        if trade["isBuyer"]:
            cost += qty * price + (fee if fee_asset in STABLES else ZERO)
            held += qty - (fee if fee_asset == asset else ZERO)
        elif held > ZERO:
            sold = min(qty + (fee if fee_asset == asset else ZERO), held)
            cost -= sold * (cost / held)
            held -= sold
    if held <= ZERO:
        return Cost(None, ZERO)
    return Cost(cost / held, held)


def _holding(
    balance: dict[str, str],
    tickers: dict[str, dict[str, str]],
    trades: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    asset = balance["asset"]
    amount = Decimal(balance["free"]) + Decimal(balance["locked"])
    if amount <= ZERO:
        return None
    if asset in STABLES:
        price: Decimal | None = Decimal(1)
        change: Decimal | None = ZERO
    else:
        ticker = tickers.get(f"{asset}USDT")
        price = Decimal(ticker["lastPrice"]) if ticker else None
        change = Decimal(ticker["priceChangePercent"]) if ticker else None
    value = amount * price if price is not None else None
    holding: dict[str, Any] = {
        "asset": asset,
        "amount": amount,
        "price": price,
        "value": value,
        "change24h": change,
        "averageCost": None,
        "covered": None,
        "profit": None,
        "profitPercent": None,
    }
    if asset in STABLES or price is None:
        return holding
    cost = average_cost(asset, trades.get(asset, []))
    if cost.average is None:
        return holding
    covered = min(cost.covered, amount)
    paid = covered * cost.average
    holding["averageCost"] = cost.average
    holding["covered"] = covered
    holding["profit"] = covered * price - paid
    holding["profitPercent"] = (covered * price - paid) / paid * HUNDRED if paid else None
    return holding


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value.normalize(), "f")
    return value


def build(
    balances: list[dict[str, str]],
    tickers: dict[str, dict[str, str]],
    trades: dict[str, list[dict[str, Any]]],
    open_orders: list[dict[str, Any]],
    aud: tuple[Decimal, str] | None,
) -> dict[str, Any]:
    """The portfolio page's data: holdings, totals, open orders and recent trades."""
    holdings = [h for b in balances if (h := _holding(b, tickers, trades)) is not None]
    total = sum((h["value"] for h in holdings if h["value"] is not None), ZERO)
    change = ZERO
    profit = ZERO
    paid = ZERO
    for h in holdings:
        if h["value"] is not None and h["change24h"] is not None:
            change += h["value"] - h["value"] / (1 + h["change24h"] / HUNDRED)
        if h["profit"] is not None:
            profit += h["profit"]
            paid += h["covered"] * h["averageCost"]
        h["share"] = h["value"] / total * HUNDRED if total and h["value"] is not None else None
    holdings.sort(key=lambda h: h["value"] if h["value"] is not None else Decimal(-1), reverse=True)
    recent = sorted(
        (t for pair_trades in trades.values() for t in pair_trades),
        key=lambda t: int(t["time"]),
        reverse=True,
    )[:RECENT_TRADES]
    return {
        "total": {
            "value": _plain(total),
            "aud": _plain(total * aud[0]) if aud else None,
            "audRate": _plain(aud[0]) if aud else None,
            "audDate": aud[1] if aud else None,
            "change24h": _plain(change),
            "change24hPercent": _plain(change / (total - change) * HUNDRED)
            if total - change
            else None,
            "profit": _plain(profit),
            "profitPercent": _plain(profit / paid * HUNDRED) if paid else None,
            "cost": _plain(paid),
        },
        "holdings": [{k: _plain(v) for k, v in h.items()} for h in holdings],
        "openOrders": [
            {
                "time": int(o["time"]),
                "pair": pair(str(o["symbol"])),
                "side": str(o["side"]).title(),
                "type": str(o["type"]).replace("_", " ").title(),
                "price": _plain(Decimal(str(o["price"]))),
                "amount": _plain(Decimal(str(o["origQty"]))),
                "filled": _plain(Decimal(str(o["executedQty"]))),
            }
            for o in sorted(open_orders, key=lambda o: int(o["time"]), reverse=True)
        ],
        "recentTrades": [
            {
                "time": int(t["time"]),
                "pair": pair(str(t["symbol"])),
                "side": "Buy" if t["isBuyer"] else "Sell",
                "price": _plain(Decimal(str(t["price"]))),
                "amount": _plain(Decimal(str(t["qty"]))),
                "total": _plain(Decimal(str(t["quoteQty"]))),
                "fee": f"{_plain(Decimal(str(t['commission'])))} {t['commissionAsset']}",
            }
            for t in recent
        ],
    }
