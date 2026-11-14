"""Fetches everything the portfolio page needs and hands it to portfolio.build."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx

from api.binance import Binance
from api.portfolio import STABLES, build

FX_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD"
OK = 200


def aud_rate(client: httpx.Client) -> tuple[Decimal, str] | None:
    """US dollars to Australian dollars from the ECB's daily rate; None if it can't be had."""
    try:
        response = client.get(FX_URL)
    except httpx.HTTPError:
        return None
    if response.status_code != OK:
        return None
    body: Any = response.json()
    return Decimal(str(body["rates"]["AUD"])), str(body["date"])


def fetch(binance: Binance, fx: httpx.Client) -> dict[str, Any]:
    balances = binance.balances()
    symbols = binance.symbols()
    coins = [b["asset"] for b in balances if b["asset"] not in STABLES]
    tickers = binance.tickers([f"{c}USDT" for c in coins if f"{c}USDT" in symbols])
    trades: dict[str, list[dict[str, Any]]] = {}
    for coin in coins:
        for quote in STABLES:
            if f"{coin}{quote}" in symbols:
                trades.setdefault(coin, []).extend(binance.trades(f"{coin}{quote}"))
    portfolio = build(balances, tickers, trades, binance.open_orders(), aud_rate(fx))
    portfolio["fetchedAt"] = datetime.now(UTC).isoformat(timespec="seconds")
    return portfolio
