"""A pair's candles, 24-hour figures and indicators: the chart's data and the signal's input."""

import os
from decimal import Decimal
from typing import Any

from api.binance import Binance, BinanceError, plain
from api.indicators import Candle, summary
from api.plan import levels
from api.portfolio import pair

INTERVALS = ("15m", "1h", "4h", "1d")
CANDLES = 120
QUOTES = ("USDT", "USDC", "FDUSD")
# The stablecoin every pair on the Trade page is quoted in (decision 21): USDT unless set.
_ASKED = os.environ.get("DESK_QUOTE", "USDT").strip().upper()
QUOTE = _ASKED if _ASKED in QUOTES else "USDT"


class MarketError(ValueError):
    """A coin or interval the desk can't chart; the message says why."""


def coin_symbol(coin: object) -> str:
    """A coin as the owner types it (`sol`, `SOL`, `SOLUSDC`) to its pair in the desk's quote,
    or refused."""
    text = str(coin or "").strip().upper()
    for quote in QUOTES:
        if text.endswith(quote) and len(text) > len(quote):
            text = text.removesuffix(quote)
            break
    if not text.isalnum() or not 1 <= len(text) <= 12:  # noqa: PLR2004
        raise MarketError("Type a coin's symbol, such as SOL.")
    return f"{text}{QUOTE}"


def candles(rows: list[list[Any]]) -> list[Candle]:
    return [
        Candle(
            time=int(r[0]),
            open=Decimal(str(r[1])),
            high=Decimal(str(r[2])),
            low=Decimal(str(r[3])),
            close=Decimal(str(r[4])),
            volume=Decimal(str(r[7])),  # quote volume, in the quote stablecoin
        )
        for r in rows
    ]


def _plain(value: object) -> object:
    return plain(value) if isinstance(value, Decimal) else value


def key_levels(binance: Binance, symbol: str) -> list[dict[str, str]]:
    """The levels traders watch (decision 28): this month's, week's and day's opens, and the
    previous day's and week's highs and lows, from Binance's own candles. None if Binance can't
    say: the chart still shows."""
    try:
        month = candles(binance.klines(symbol, "1M", 1))
        week = candles(binance.klines(symbol, "1w", 2))
        day = candles(binance.klines(symbol, "1d", 2))
    except BinanceError:
        return []
    found: list[tuple[str, Decimal]] = []
    if month:
        found.append(("Month open", month[-1].open))
    if week:
        found.append(("Week open", week[-1].open))
    if day:
        found.append(("Day open", day[-1].open))
    if len(week) > 1:
        found += [("Prev week high", week[-2].high), ("Prev week low", week[-2].low)]
    if len(day) > 1:
        found += [("Prev day high", day[-2].high), ("Prev day low", day[-2].low)]
    return [{"name": name, "price": plain(value)} for name, value in found]


def market(binance: Binance, symbol: str, interval: str) -> dict[str, Any]:
    if interval not in INTERVALS:
        raise MarketError("Pick 15m, 1h, 4h or 1D.")
    ticker = binance.tickers([symbol])[symbol]
    bars = candles(binance.klines(symbol, interval, CANDLES))
    figures = summary(bars)
    # Support and resistance from daily and weekly swing lows and highs (decision 46), not the
    # last few candles' extremes.
    price = Decimal(ticker["lastPrice"])
    daily = candles(binance.klines(symbol, "1d", 250))
    weekly = candles(binance.klines(symbol, "1w", 150))
    swings = levels(daily, weekly, price)
    s1 = next((lv["price"] for lv in swings if lv["id"] == "S1"), None)
    r1 = next((lv["price"] for lv in swings if lv["id"] == "R1"), None)
    figures = {**figures, "support": s1, "resistance": r1}
    return {
        "symbol": symbol,
        "coin": symbol.removesuffix(QUOTE),
        "pair": pair(symbol),
        "quote": QUOTE,
        "interval": interval,
        "price": ticker["lastPrice"],
        "change24h": ticker["priceChangePercent"],
        "high24h": ticker.get("highPrice"),
        "low24h": ticker.get("lowPrice"),
        "volume24h": ticker.get("quoteVolume"),
        "candles": [
            {
                "t": c.time,
                "o": plain(c.open),
                "h": plain(c.high),
                "l": plain(c.low),
                "c": plain(c.close),
                "v": plain(c.volume),
            }
            for c in bars
        ],
        "indicators": {k: _plain(v) for k, v in figures.items()},
        "levels": key_levels(binance, symbol),
    }
