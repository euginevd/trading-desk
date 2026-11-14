"""Demo mode (DEMO=1): made-up Binance replies, so the desk runs without a key or Binance."""

import math
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from api.store import Store

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
    "TAOUSDT": ("412.50", "4.80"),
    "LINKUSDT": ("18.42", "-3.20"),
}
TAO_ADDRESS = "5DemoColdkeyAddressForTheTradingDeskOnlyXXXXXXXX"
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
            {
                "symbol": s,
                "lastPrice": p,
                "priceChangePercent": c,
                "highPrice": f"{float(p) * 1.021:.2f}",
                "lowPrice": f"{float(p) * 0.968:.2f}",
                "quoteVolume": f"{float(p) * 2_000_000:.2f}",
            }
            for s, (p, c) in PRICES.items()
        ],
        "/api/v3/klines": klines(
            symbol,
            request.url.params.get("interval", "4h"),
            min(int(request.url.params.get("limit", "120")), 1000),
        ),
        "/api/v3/myTrades": _trades(symbol),
        "/sapi/v1/capital/deposit/hisrec": [
            {"coin": "USDC", "amount": a, "network": "BASE", "status": 1, "insertTime": t}
            for a, t in DEPOSITS
            if int(request.url.params.get("startTime", 0))
            <= t
            <= int(request.url.params.get("endTime", NOW_MS))
        ],
        "/api/v3/openOrders": [
            {"origQty": o.get("origQty", o["executedQty"]), "price": "0", **o}
            for o in EXCHANGE.orders.values()
            if o["status"] == "NEW"
        ],
    }
    if path == "/api/v3/order/cancelReplace":
        return EXCHANGE.replace(dict(request.url.params))
    if path in ORDER_PATHS or (path == "/api/v3/myTrades" and "orderId" in request.url.params):
        return EXCHANGE.handle(request)
    if path == "/api/v3/exchangeInfo":
        return httpx.Response(200, json={"symbols": [{"filters": FILTERS}]})
    if path not in replies:
        return httpx.Response(404, json={"msg": "Not in the demo."})
    return httpx.Response(200, json=replies[path])


# Two made-up USDC deposits for the FY deposits card (decision 31).
DEPOSITS = [("500", NOW_MS - 90 * DAY_MS), ("750.25", NOW_MS - 9 * DAY_MS)]

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
        self.next_id = 100
        for n, o in enumerate(ORDERS, start=1):  # the demo's standing orders, cancellable
            self.orders[n] = {
                "symbol": o["symbol"],
                "orderId": n,
                "side": o["side"],
                "type": "LIMIT",
                "status": "NEW",
                "price": o["price"],
                "origQty": o["qty"],
                "executedQty": "0",
                "cummulativeQuoteQty": "0",
                "time": NOW_MS - int(o["days"]) * DAY_MS,
            }

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
            "price": p.get("price", "0"),
            "origQty": p.get("quantity", "0"),
            "time": NOW_MS,
            "clientOrderId": p.get("newClientOrderId", ""),
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

    def replace(self, p: dict[str, str]) -> httpx.Response:
        """Binance's cancel-replace: the old order cancelled, the new one placed."""
        old = self.orders.get(int(p["cancelOrderId"]))
        if old is None or old["status"] != "NEW":
            return httpx.Response(400, json={"msg": "Order cancel-replace failed."})
        old["status"] = "CANCELED"
        made = self._new({k: v for k, v in p.items() if k != "cancelOrderId"})
        return httpx.Response(200, json={"cancelResult": "SUCCESS", "newOrderResponse": made})

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
        if "origClientOrderId" in p:
            found = [
                o for o in self.orders.values() if o.get("clientOrderId") == p["origClientOrderId"]
            ]
            order = found[0] if found else None
        else:
            order = self.orders.get(int(p["orderId"]))
        if order is None:
            return httpx.Response(400, json={"msg": "Order does not exist."})
        if method == "DELETE":
            order["status"] = "CANCELED"
        return httpx.Response(200, json=order)


EXCHANGE = Exchange()


def fx(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"date": "2026-11-13", "rates": {"AUD": 1.4738, "INR": 84.21}})


HOT_RSI = 68
STEPS_MS = {"15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": DAY_MS}


def klines(symbol: str, interval: str, count: int = 120) -> list[list[Any]]:
    """Made-up candles that wander and end at the demo price, the same every time."""
    if symbol not in PRICES:
        return []
    last = float(PRICES[symbol][0])
    seed = sum(map(ord, symbol + interval))
    step = STEPS_MS.get(interval, STEPS_MS["4h"])
    closes = [
        last * (1 + 0.06 * math.sin((i + seed) / 9) - 0.0004 * (count - i)) for i in range(count)
    ]
    closes[-1] = last
    rows: list[list[Any]] = []
    for i, close in enumerate(closes):
        opened = closes[i - 1] if i else close * 0.995
        wiggle = abs(math.sin(i * 1.7 + seed)) * last * 0.006
        rows.append(
            [
                NOW_MS - (count - i) * step,
                f"{opened:.4f}",
                f"{max(opened, close) + wiggle:.4f}",
                f"{min(opened, close) - wiggle:.4f}",
                f"{close:.4f}",
                "0",
                0,
                f"{(0.3 + abs(math.cos(i + seed))) * last * 5000:.2f}",
            ]
        )
    return rows


def taostats(request: httpx.Request) -> httpx.Response:
    """Made-up Taostats reply: 12.4 TAO free, 85 staked and 1.5 to claim, in rao."""
    del request
    row = {
        "balance_free": "12400000000",
        "balance_staked": "85000000000",
        "balance_total": "97400000000",
        "root_basket_claimable_tao": "1500000000",
    }
    return httpx.Response(200, json={"data": [row]})


def history(store: "Store", today: str, value: str) -> None:
    """Fills 30 days of made-up account value before today, once."""
    if len(store.history(2)) > 1:
        return
    end = date.fromisoformat(today)
    for back in range(1, 30):
        day = (end - timedelta(days=back)).isoformat()
        swing = 1 - 0.002 * back + 0.02 * math.sin(back / 3)
        store.record_value(day, f"{float(value) * swing:.2f}")


def ask(system: str, prompt: str, shape: dict[str, Any]) -> tuple[dict[str, Any], Decimal]:
    """A made-up plan from the facts in the prompt, so demo mode needs no Anthropic key."""
    del system, shape
    import json  # noqa: PLC0415 - demo only

    facts = json.loads(prompt.split("\n", 3)[3])
    trend = facts["frames"]["4h"]["trend"]
    held = facts["position"]["held"]
    ids: list[str] = [str(lv["id"]) for lv in facts["levels"]]

    def pick(name: str) -> str:
        return name if name in ids else "none"

    action = ("Hold" if held else "Wait") if trend == "Down" else ("Add" if held else "Buy")
    reply: dict[str, Any] = {
        "action": action,
        "confidence": 62,
        "horizons": {"short": "Wait", "swing": action, "long": "Hold" if held else "Buy"},
        "buy_from": pick("S2"),
        "buy_to": pick("S1"),
        "no_chase": pick("R1"),
        "invalidation": pick("S2"),
        "trim_from": pick("R1"),
        "trim_to": pick("R2"),
        "bull": "Holding above its weekly swing low",
        "bear": f"4-hour trend {trend.lower()}, RSI {facts['frames']['4h']['rsi']}",
        "change_mind": "A daily close under the invalidation level",
        "watch": [{"level": pick("R1"), "direction": "above", "note": "Breakout over resistance"}],
        "changed": "First signal" if not facts.get("previous") else "Little has changed",
        "sentiment": "Neutral",
        "summary": "Demo mode: a made-up plan from the computed facts.",
    }
    return reply, Decimal(0)


def sentiment_detail() -> dict[str, Any]:
    """Made-up Fear & Greed details for demo mode."""
    day = {"value": 42, "label": "Fear", "day": NOW_MS}
    return {
        "now": day,
        "history": {
            "yesterday": {"value": 38, "label": "Fear", "day": NOW_MS - DAY_MS},
            "lastWeek": {"value": 51, "label": "Neutral", "day": NOW_MS - 7 * DAY_MS},
            "lastMonth": {"value": 63, "label": "Greed", "day": NOW_MS - 30 * DAY_MS},
            "lastYear": {"value": 70, "label": "Greed", "day": NOW_MS - 365 * DAY_MS},
        },
        "high": {"value": 84, "label": "Extreme Greed", "day": NOW_MS - 120 * DAY_MS},
        "low": {"value": 11, "label": "Extreme Fear", "day": NOW_MS - 280 * DAY_MS},
        "summary": (
            "The index has moved from Greed a month ago to Fear today: the market is cautious."
        ),
        "chart": [
            {"day": NOW_MS - (89 - i) * DAY_MS, "value": 40 + int(20 * math.sin(i / 9))}
            for i in range(90)
        ],
        "market": {
            "cap": "2268170000000",
            "capChange": "-2.79",
            "volume": "73870000000",
            "btcShare": "57.1",
            "ethShare": "11.2",
        },
    }
