"""What a backtest run may be, and the Freqtrade commands for it (decision 87). Stdlib only:
the api checks a request with it before queueing, and the worker (apps/backtest/worker.py)
checks it again and builds the commands, as an argument list, never a shell string.

A run is kept simple (owner, 20 Nov 2026): one style, one coin against USDC from the Trade
screener's top 100, at most 3 months to yesterday."""

import calendar
import re
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
COIN = re.compile(r"[A-Z0-9]{1,20}")  # as the screener names coins
CONFIG = "/freqtrade/config"
QUOTE = "USDC"
LONGEST_DAYS = 92  # 3 months


@dataclass(frozen=True)
class Style:
    key: str
    name: str
    candles: str
    strategy: str
    timeframes: tuple[str, ...]
    warmup: int  # days of candles before the test starts, for the indicators
    ai_strategy: str | None = None
    ai_timeframes: tuple[str, ...] = ()
    ai_warmup: int = 0  # FreqAI trains on the days before each stretch it tests


# The same choices as run.sh.
STYLES: dict[str, Style] = {
    s.key: s
    for s in (
        Style("scalp", "Scalp", "5-minute, 1-hour trend",
              "DeskScalp", ("5m", "1h", "1d"), 30,
              "DeskScalpAI", ("5m", "15m", "1h", "1d"), 40),
        Style("day", "Day trade", "15-minute, 4-hour trend",
              "DeskDay", ("15m", "4h", "1d"), 35,
              "DeskDayAI", ("15m", "1h", "4h", "1d"), 75),
        Style("swing", "Swing", "daily",
              "DeskSwing", ("1d",), 405,
              "DeskSwingAI", ("1d",), 1205),
        Style("position", "Position", "weekly",
              "DeskPosition", ("1w", "1d"), 1105),
    )
}  # fmt: skip


class BadRun(ValueError):
    """A run request the desk won't queue."""


@dataclass(frozen=True)
class Run:
    style: Style
    coin: str
    start: date
    end: date
    ai: bool = False

    @property
    def strategy(self) -> str:
        return (self.style.ai_strategy if self.ai else None) or self.style.strategy

    @property
    def pair(self) -> str:
        return f"{self.coin}/{QUOTE}"


def _day(value: object, name: str) -> date:
    if not isinstance(value, str) or not DATE.fullmatch(value):
        raise BadRun(f"{name} must be a date like 2025-01-31.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise BadRun(f"{name} isn't a real date.") from None


def check(
    body: dict[str, Any], coins: Collection[str] | None = None, today: date | None = None
) -> Run:
    """The run asked for, or BadRun saying what to fix. The api passes today's top 100; the
    worker, which can't read it, checks the coin's form."""
    style = STYLES.get(str(body.get("style", "")))
    if style is None:
        raise BadRun("Pick scalp, day trade, swing or position.")
    coin = body.get("coin")
    if not isinstance(coin, str) or not COIN.fullmatch(coin):
        raise BadRun("Pick a coin.")
    if coins is not None and coin not in coins:
        raise BadRun(f"{coin} isn't in today's top 100 USDC coins on Binance.")
    ai = body.get("ai", False)
    if not isinstance(ai, bool):
        raise BadRun("The AI filter is on or off.")
    if ai and style.ai_strategy is None:
        raise BadRun(f"{style.name} has no AI filter: too few candles a coin to learn from.")
    start, end = _day(body.get("from"), "From"), _day(body.get("to"), "To")
    last = (today or datetime.now(UTC).date()) - timedelta(days=1)  # today's candles aren't closed
    if end > last:
        raise BadRun("To can't be later than yesterday: today's candles aren't closed.")
    if start >= end:
        raise BadRun("From must be before To.")
    if (end - start).days > LONGEST_DAYS:
        raise BadRun("A backtest covers 3 months at most.")
    return Run(style, coin, start, end, ai)


def months_before(day: date, months: int) -> date:
    """The same day of the month, months earlier (the month's last day when it's shorter)."""
    year, month = divmod(day.year * 12 + day.month - 1 - months, 12)
    last = calendar.monthrange(year, month + 1)[1]
    return date(year, month + 1, min(day.day, last))


def default(today: date | None = None) -> tuple[str, str]:
    """The usual test (owner, 20 Nov 2026): the last month, ending yesterday."""
    end = (today or datetime.now(UTC).date()) - timedelta(days=1)
    return months_before(end, 1).isoformat(), end.isoformat()


def commands(run: Run) -> list[list[str]]:
    """Download what's missing (newer, then older: known-mistakes 13b), then backtest the one
    pair, with BTC's candles beside it for the market's regime."""
    configs = ["--config", f"{CONFIG}/backtest.json", "--config", f"{CONFIG}/usdc.json"]
    if run.ai:
        configs += ["--config", f"{CONFIG}/ai-{run.style.key}.json"]
    timeframes = run.style.ai_timeframes if run.ai else run.style.timeframes
    warmup = run.style.ai_warmup if run.ai else run.style.warmup
    first = (run.start - timedelta(days=warmup)).strftime("%Y%m%d")
    end = run.end.strftime("%Y%m%d")
    pairs = [run.pair] if run.coin == "BTC" else [run.pair, f"BTC/{QUOTE}"]
    download = [
        "freqtrade", "download-data", *configs, "--pairs", *pairs,
        "--timerange", f"{first}-{end}", "--timeframes", *timeframes,
    ]  # fmt: skip
    return [
        download,
        [*download, "--prepend"],
        [
            "freqtrade", "backtesting", *configs,
            "--strategy", run.strategy, "--pairs", run.pair,
            "--timerange", f"{run.start.strftime('%Y%m%d')}-{end}",
            "--fee", "0.001", "--export", "trades", "--cache", "none",
        ],
    ]  # fmt: skip
