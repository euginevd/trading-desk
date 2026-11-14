"""A small Binance spot client: signed reads and spot orders, each call written to the audit log."""

import hashlib
import hmac
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, cast
from urllib.parse import urlencode

import httpx

from api.audit import Audit

TRADES_PAGE = 1000
RECV_WINDOW_MS = 5000
OK = 200


def plain(value: Decimal) -> str:
    """A decimal as Binance wants it: no exponent, no trailing zeros."""
    text = format(value.normalize(), "f")
    return text


class BinanceError(Exception):
    """Binance refused a call; the message is Binance's own, safe to show the owner."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class Filters:
    """A pair's trading rules: amount step, price step and the smallest order in quote."""

    step: Decimal
    tick: Decimal
    min_notional: Decimal

    def amount(self, qty: Decimal) -> Decimal:
        return (qty // self.step) * self.step

    def price(self, price: Decimal) -> Decimal:
        return (price // self.tick) * self.tick


class Binance:
    def __init__(
        self,
        client: httpx.Client,
        credentials: tuple[str, str],
        audit: Audit,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._client = client
        self._key, self._secret = credentials
        self._audit = audit
        self._clock = clock
        self._filters: dict[str, Filters] = {}

    def _call(self, method: str, path: str, query: str, label: str) -> Any:
        kind = "exchange" if method == "GET" else "order"
        started = time.monotonic()
        try:
            response = self._client.request(
                method, f"{path}?{query}" if query else path, headers=self._headers()
            )
        except httpx.HTTPError as error:
            self._audit.record(kind, f"Binance: {label}", f"Failed: {type(error).__name__}")
            raise BinanceError(
                0, "Binance didn't answer. Check the connection and try again."
            ) from error
        ms = round((time.monotonic() - started) * 1000)
        body: Any = response.json() if response.content else None
        if response.status_code != OK:
            message = (
                str(cast(dict[str, Any], body).get("msg", "")) if isinstance(body, dict) else ""
            )
            self._audit.record(
                kind, f"Binance: {label}", f"Refused {response.status_code}: {message}"
            )
            raise BinanceError(response.status_code, str(message or response.reason_phrase))
        self._audit.record(kind, f"Binance: {label}", f"OK, {ms} ms")
        return body

    def _get(self, path: str, query: str, label: str) -> Any:
        return self._call("GET", path, query, label)

    def _headers(self) -> dict[str, str]:
        return {"X-MBX-APIKEY": self._key}

    def _signed(self, path: str, params: dict[str, str], label: str, method: str = "GET") -> Any:
        params = {
            **params,
            "recvWindow": str(RECV_WINDOW_MS),
            "timestamp": str(int(self._clock() * 1000)),
        }
        query = urlencode(params)
        signature = hmac.new(self._secret.encode(), query.encode(), hashlib.sha256).hexdigest()
        return self._call(method, path, f"{query}&signature={signature}", label)

    def balances(self) -> list[dict[str, str]]:
        account = self._signed("/api/v3/account", {"omitZeroBalances": "true"}, "balances")
        return list(account["balances"])

    def symbols(self) -> set[str]:
        prices = self._get("/api/v3/ticker/price", "", "symbols")
        return {str(row["symbol"]) for row in prices}

    def tickers(self, symbols: list[str]) -> dict[str, dict[str, str]]:
        if not symbols:
            return {}
        query = urlencode({"symbols": json.dumps(symbols, separators=(",", ":"))})
        rows = self._get("/api/v3/ticker/24hr", query, "24-hour prices")
        return {str(row["symbol"]): row for row in rows}

    def open_orders(self) -> list[dict[str, Any]]:
        return list(self._signed("/api/v3/openOrders", {}, "open orders"))

    def trades(self, symbol: str) -> list[dict[str, Any]]:
        """Every trade on one pair, oldest first, a page at a time."""
        found: list[dict[str, Any]] = []
        from_id = 0
        while True:
            params = {"symbol": symbol, "fromId": str(from_id), "limit": str(TRADES_PAGE)}
            page = list(self._signed("/api/v3/myTrades", params, f"trades {symbol}"))
            found.extend(page)
            if len(page) < TRADES_PAGE:
                return found
            from_id = int(page[-1]["id"]) + 1

    def order_fills(self, symbol: str, order_id: int) -> list[dict[str, Any]]:
        params = {"symbol": symbol, "orderId": str(order_id)}
        return list(self._signed("/api/v3/myTrades", params, f"fills {symbol} {order_id}"))

    def filters(self, symbol: str) -> Filters:
        if symbol not in self._filters:
            info = self._get("/api/v3/exchangeInfo", urlencode({"symbol": symbol}), "pair rules")
            rules = {f["filterType"]: f for f in info["symbols"][0]["filters"]}
            notional: dict[str, Any] = rules.get("NOTIONAL") or rules.get("MIN_NOTIONAL") or {}
            self._filters[symbol] = Filters(
                step=Decimal(rules["LOT_SIZE"]["stepSize"]),
                tick=Decimal(rules["PRICE_FILTER"]["tickSize"]),
                min_notional=Decimal(str(notional.get("minNotional", "0"))),
            )
        return self._filters[symbol]

    def _order(self, params: dict[str, str], label: str) -> dict[str, Any]:
        return dict(
            self._signed("/api/v3/order", {**params, "newOrderRespType": "FULL"}, label, "POST")
        )

    def buy_market(self, symbol: str, spend: Decimal, client_id: str) -> dict[str, Any]:
        params = {"symbol": symbol, "side": "BUY", "type": "MARKET"}
        params |= {"quoteOrderQty": plain(spend), "newClientOrderId": client_id}
        return self._order(params, f"market buy {symbol} for {plain(spend)}")

    def buy_limit(
        self, symbol: str, qty: Decimal, price: Decimal, client_id: str
    ) -> dict[str, Any]:
        params = {"symbol": symbol, "side": "BUY", "type": "LIMIT", "timeInForce": "GTC"}
        params |= {"quantity": plain(qty), "price": plain(price), "newClientOrderId": client_id}
        return self._order(params, f"limit buy {plain(qty)} {symbol} at {plain(price)}")

    def sell_market(self, symbol: str, qty: Decimal) -> dict[str, Any]:
        params = {"symbol": symbol, "side": "SELL", "type": "MARKET", "quantity": plain(qty)}
        return self._order(params, f"market sell {plain(qty)} {symbol}")

    def sell_limit(self, symbol: str, qty: Decimal, price: Decimal) -> dict[str, Any]:
        params = {"symbol": symbol, "side": "SELL", "type": "LIMIT", "timeInForce": "GTC"}
        params |= {"quantity": plain(qty), "price": plain(price)}
        return self._order(params, f"take-profit sell {plain(qty)} {symbol} at {plain(price)}")

    def sell_stop(self, symbol: str, qty: Decimal, stop: Decimal) -> dict[str, Any]:
        params = {"symbol": symbol, "side": "SELL", "type": "STOP_LOSS"}
        params |= {"quantity": plain(qty), "stopPrice": plain(stop)}
        return self._order(params, f"stop-loss sell {plain(qty)} {symbol} at {plain(stop)}")

    def sell_oco(self, symbol: str, qty: Decimal, take: Decimal, stop: Decimal) -> dict[str, Any]:
        """Take-profit above as a limit maker, stop-loss below as a stop: whichever fills first."""
        params = {"symbol": symbol, "side": "SELL", "quantity": plain(qty)}
        params |= {"aboveType": "LIMIT_MAKER", "abovePrice": plain(take)}
        params |= {"belowType": "STOP_LOSS", "belowStopPrice": plain(stop)}
        label = f"exits for {plain(qty)} {symbol}: {plain(take)} or {plain(stop)}"
        return dict(self._signed("/api/v3/orderList/oco", params, label, "POST"))

    def order(self, symbol: str, order_id: int) -> dict[str, Any]:
        params = {"symbol": symbol, "orderId": str(order_id)}
        return dict(self._signed("/api/v3/order", params, f"order {symbol} {order_id}"))

    def cancel(self, symbol: str, order_id: int) -> dict[str, Any]:
        params = {"symbol": symbol, "orderId": str(order_id)}
        return dict(self._signed("/api/v3/order", params, f"cancel {symbol} {order_id}", "DELETE"))

    def order_list(self, list_id: int) -> dict[str, Any]:
        params = {"orderListId": str(list_id)}
        return dict(self._signed("/api/v3/orderList", params, f"exits {list_id}"))

    def cancel_list(self, symbol: str, list_id: int) -> dict[str, Any]:
        params = {"symbol": symbol, "orderListId": str(list_id)}
        label = f"cancel exits {symbol} {list_id}"
        return dict(self._signed("/api/v3/orderList", params, label, "DELETE"))
