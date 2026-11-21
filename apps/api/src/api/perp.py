"""A coin Binance lists only as a USDT perpetual, not on spot (SPX6900, owner, 21 Nov 2026):
its price, day's change and daily candles from Binance's public futures data, no key. For the
Trading account's watchlist, watch only: the desk trades Binance spot, so nothing is placed."""

from typing import Any, cast

import httpx

from api.advisor import FUTURES_URL

OK = 200
TIMEOUT = 10


def _get(path: str, params: dict[str, Any]) -> Any:
    try:
        with httpx.Client(timeout=TIMEOUT) as http:
            response = http.get(f"{FUTURES_URL}{path}", params=params)
    except httpx.HTTPError:
        return None
    if response.status_code != OK:
        return None
    try:
        return response.json()
    except ValueError:
        return None


def listed(coin: str) -> bool:
    """Whether Binance has a USDT perpetual for the coin."""
    return _get("/fapi/v1/ticker/price", {"symbol": f"{coin}USDT"}) is not None


def ticker(coin: str) -> dict[str, Any] | None:
    """The perpetual's 24-hour ticker: lastPrice and priceChangePercent, as spot's reads."""
    found = _get("/fapi/v1/ticker/24hr", {"symbol": f"{coin}USDT"})
    return cast(dict[str, Any], found) if isinstance(found, dict) else None


def klines(coin: str, days: int) -> list[list[Any]]:
    """Daily candles, in the same shape as spot's."""
    found = _get("/fapi/v1/klines", {"symbol": f"{coin}USDT", "interval": "1d", "limit": days})
    return cast(list[list[Any]], found) if isinstance(found, list) else []
