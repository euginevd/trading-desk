"""Demo mode (DEMO=1): made-up Binance replies, so the desk runs without a key or Binance."""

from decimal import Decimal
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
    if path in ORDER_PATHS or (path == "/api/v3/myTrades" and "orderId" in request.url.params):
        return EXCHANGE.handle(request)
    if path == "/api/v3/exchangeInfo":
        return httpx.Response(200, json={"symbols": [{"filters": FILTERS}]})
    if path not in replies:
        return httpx.Response(404, json={"msg": "Not in the demo."})
    return httpx.Response(200, json=replies[path])


ORDER_PATHS = ("/api/v3/order", "/api/v3/orderList/oco", "/api/v3/orderList")
FILTERS = [
    {"filterType": "LOT_SIZE", "stepSize": "0.00001"},
    {"filterType": "PRICE_FILTER", "tickSize": "0.01"},
    {"filterType": "NOTIONAL", "minNotional": "5"},
]
STEP = Decimal("0.00001")


class Exchange:
    """A pretend order book for demo mode: market orders fill at the demo price, others wait."""

    def __init__(self) -> None:
        self.orders: dict[int, dict[str, Any]] = {}
        self.lists: dict[int, list[int]] = {}
        self.next_id = 1

    def _id(self) -> int:
        self.next_id += 1
        return self.next_id

    def _new(self, p: dict[str, str]) -> dict[str, Any]:
        symbol, kind, side = p["symbol"], p["type"], p["side"]
        price = Decimal(PRICES[symbol][0])
        order: dict[str, Any] = {
            "symbol": symbol,
            "orderId": self._id(),
            "side": side,
            "type": kind,
            "status": "NEW",
            "executedQty": "0",
            "cummulativeQuoteQty": "0",
            "time": NOW_MS,
        }
        if kind == "MARKET":
            qty = (
                (Decimal(p["quoteOrderQty"]) / price // STEP) * STEP
                if "quoteOrderQty" in p
                else Decimal(p["quantity"])
            )
            order |= {"status": "FILLED", "executedQty": str(qty)}
            order["cummulativeQuoteQty"] = str(qty * price)
        self.orders[order["orderId"]] = order
        return order

    def handle(self, request: httpx.Request) -> httpx.Response:
        p = dict(request.url.params)
        path, method = request.url.path, request.method
        if path == "/api/v3/myTrades":
            order = self.orders[int(p["orderId"])]
            fills = [{"commission": "0", "commissionAsset": "USDT"}]
            return httpx.Response(200, json=fills if order["status"] == "FILLED" else [])
        if path == "/api/v3/orderList/oco":
            legs = [
                self._new({**p, "type": "LIMIT_MAKER"}),
                self._new({**p, "type": "STOP_LOSS"}),
            ]
            list_id = self._id()
            self.lists[list_id] = [leg["orderId"] for leg in legs]
            return httpx.Response(200, json={"orderListId": list_id, "orders": legs})
        if path == "/api/v3/orderList":
            ids = self.lists[int(p["orderListId"])]
            filled = any(self.orders[i]["status"] == "FILLED" for i in ids)
            for i in ids:  # as on Binance: once one leg fills, the other is cancelled
                if method == "DELETE" or (filled and self.orders[i]["status"] == "NEW"):
                    self.orders[i]["status"] = "CANCELED"
            done = all(self.orders[i]["status"] != "NEW" for i in ids)
            status = "ALL_DONE" if done else "EXECUTING"
            orders = [{"orderId": i} for i in ids]
            return httpx.Response(200, json={"listOrderStatus": status, "orders": orders})
        if method == "POST":
            return httpx.Response(200, json=self._new(p))
        order = self.orders.get(int(p["orderId"]))
        if order is None:
            return httpx.Response(400, json={"msg": "Order does not exist."})
        if method == "DELETE":
            order["status"] = "CANCELED"
        return httpx.Response(200, json=order)


EXCHANGE = Exchange()


def fx(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"date": "2026-11-13", "rates": {"AUD": 1.4738}})
