"""Technical indicators from candles, worked out in code (decision 16). Pure: easy to test."""

from dataclasses import dataclass
from decimal import Decimal

ZERO = Decimal(0)
HUNDRED = Decimal(100)
RSI_PERIOD = 14
SHORT = 20
LONG = 50
LEVELS = 30  # support and resistance from the last 30 candles
EXTENDED = Decimal("0.04")  # 4% from the 20-period average counts as stretched


@dataclass(frozen=True)
class Candle:
    time: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal


def sma(values: list[Decimal], period: int) -> Decimal | None:
    if period <= 0 or len(values) < period:
        return None
    return sum(values[-period:], ZERO) / period


def rsi(closes: list[Decimal], period: int = RSI_PERIOD) -> Decimal | None:
    """Wilder's relative strength index: 0 to 100, above 70 overbought, below 30 oversold."""
    if len(closes) <= period:
        return None
    changes = [b - a for a, b in zip(closes, closes[1:], strict=False)]
    gain = sum((c for c in changes[:period] if c > 0), ZERO) / period
    loss = sum((-c for c in changes[:period] if c < 0), ZERO) / period
    for change in changes[period:]:
        gain = (gain * (period - 1) + max(change, ZERO)) / period
        loss = (loss * (period - 1) + max(-change, ZERO)) / period
    if loss == 0:
        return HUNDRED if gain > 0 else Decimal(50)
    return HUNDRED - HUNDRED / (1 + gain / loss)


def trend(price: Decimal, short: Decimal | None, long: Decimal | None) -> str:
    """Up, Down or Sideways from where the price sits against its averages."""
    if short is None or long is None:
        return "Not enough data"
    if price > short > long:
        word = "Up"
    elif price < short < long:
        word = "Down"
    else:
        return "Sideways"
    if abs(price - short) / short > EXTENDED:
        return f"{word}, extended"
    return word


def summary(candles: list[Candle]) -> dict[str, Decimal | str | None]:
    """The figures the signal and the chart need, from candles oldest first."""
    if not candles:
        return {
            "rsi": None,
            "sma20": None,
            "sma50": None,
            "support": None,
            "resistance": None,
            "trend": "Not enough data",
        }
    closes = [c.close for c in candles]
    recent = candles[-LEVELS:]
    short, long = sma(closes, SHORT), sma(closes, LONG)
    return {
        "rsi": rsi(closes),
        "sma20": short,
        "sma50": long,
        "support": min(c.low for c in recent),
        "resistance": max(c.high for c in recent),
        "trend": trend(closes[-1], short, long),
    }


BB_LENGTH = 20
BB_DEVIATION = Decimal(2)


def bollinger(
    closes: list[Decimal], length: int = BB_LENGTH, deviation: Decimal = BB_DEVIATION
) -> tuple[Decimal, Decimal, Decimal] | None:
    """Bollinger Bands on the last `length` closes: (lower, middle, upper). The spread is the
    population standard deviation, as TradingView and Binance draw it."""
    if length <= 1 or len(closes) < length:
        return None
    window = closes[-length:]
    middle = sum(window, ZERO) / length
    spread = (sum(((c - middle) ** 2 for c in window), ZERO) / length).sqrt()
    return middle - deviation * spread, middle, middle + deviation * spread
