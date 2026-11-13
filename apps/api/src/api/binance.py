"""A small Binance spot client: signed reads only, each call written to the audit log."""

import hashlib
import hmac
import json
import time
from collections.abc import Callable
from typing import Any, cast
from urllib.parse import urlencode

import httpx

from api.audit import Audit

TRADES_PAGE = 1000
RECV_WINDOW_MS = 5000
OK = 200


class BinanceError(Exception):
    """Binance refused a call; the message is Binance's own, safe to show the owner."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


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

    def _get(self, path: str, query: str, label: str) -> Any:
        started = time.monotonic()
        try:
            response = self._client.get(
                f"{path}?{query}" if query else path, headers=self._headers()
            )
        except httpx.HTTPError as error:
            self._audit.record("exchange", f"Binance: {label}", f"Failed: {type(error).__name__}")
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
                "exchange", f"Binance: {label}", f"Refused {response.status_code}: {message}"
            )
            raise BinanceError(response.status_code, str(message or response.reason_phrase))
        self._audit.record("exchange", f"Binance: {label}", f"OK, {ms} ms")
        return body

    def _headers(self) -> dict[str, str]:
        return {"X-MBX-APIKEY": self._key}

    def _signed(self, path: str, params: dict[str, str], label: str) -> Any:
        params = {
            **params,
            "recvWindow": str(RECV_WINDOW_MS),
            "timestamp": str(int(self._clock() * 1000)),
        }
        query = urlencode(params)
        signature = hmac.new(self._secret.encode(), query.encode(), hashlib.sha256).hexdigest()
        return self._get(path, f"{query}&signature={signature}", label)

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
