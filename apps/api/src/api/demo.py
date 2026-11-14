"""Demo mode (DEMO=1): made-up Binance replies, so the desk runs without a key or Binance."""

from typing import Any

import httpx

DAY_MS = 86_400_000
NOW_MS = 1_794_000_000_000

BALANCES = [
    {"asset": "BTC", "free": "0.4105", "locked": "0.002"},
    {"asset": "SOL", "free": "83", "locked": "2"},
    {"asset": "ETH", "free": "5.2", "locked": "0"},
    {"asset": "USDT", "free": "6292.15", "locked": "188"},
    {"asset": "BNB", "free": "3.75", "locked": "0"},
]
PRICES = {
    "BTCUSDT": ("98420.00", "2.10"),
    "SOLUSDT": ("212.40", "3.42"),
    "ETHUSDT": ("3310.50", "-1.18"),
    "BNBUSDT": ("642.00", "-0.35"),
}
BUYS = {
    "BTCUSDT": [("81200.00", "0.4125", 9)],
    "SOLUSDT": [("176.30", "85", 5)],
    "ETHUSDT": [("3480.00", "5.2", 3)],
    "BNBUSDT": [("590.00", "2.5", 6)],
}
ORDERS = [
    {"symbol": "BTCUSDT", "side": "BUY", "price": "94000.00", "qty": "0.002", "days": 1},
    {"symbol": "SOLUSDT", "side": "SELL", "price": "240.00", "qty": "2", "days": 3},
]


def _trades(symbol: str) -> list[dict[str, Any]]:
    return [
        {
            "symbol": symbol,
            "id": n,
            "time": NOW_MS - days * DAY_MS,
            "price": price,
            "qty": qty,
            "quoteQty": f"{float(price) * float(qty):.2f}",
            "commission": "0",
            "commissionAsset": "USDT",
            "isBuyer": True,
        }
        for n, (price, qty, days) in enumerate(BUYS.get(symbol, []))
    ]


def binance(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    symbol = request.url.params.get("symbol", "")
    replies: dict[str, Any] = {
        "/api/v3/account": {"balances": BALANCES},
        "/api/v3/ticker/price": [{"symbol": s, "price": p} for s, (p, _) in PRICES.items()],
        "/api/v3/ticker/24hr": [
            {"symbol": s, "lastPrice": p, "priceChangePercent": c} for s, (p, c) in PRICES.items()
        ],
        "/api/v3/myTrades": _trades(symbol),
        "/api/v3/openOrders": [
            {
                "symbol": o["symbol"],
                "side": o["side"],
                "type": "LIMIT",
                "price": o["price"],
                "origQty": o["qty"],
                "executedQty": "0",
                "time": NOW_MS - int(o["days"]) * DAY_MS,
            }
            for o in ORDERS
        ],
    }
    if path not in replies:
        return httpx.Response(404, json={"msg": "Not in the demo."})
    return httpx.Response(200, json=replies[path])


def fx(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"date": "2026-11-13", "rates": {"AUD": 1.4738}})
