"""What a backtest run may be, and the Freqtrade commands for it (decision 85). Stdlib only:
the api checks a request with it before queueing, and the worker (apps/backtest/worker.py)
checks it again and builds the commands, as an argument list, never a shell string."""

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

FIRST_DAY = date(2017, 8, 17)  # Binance's first candles
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
CONFIG = "/freqtrade/config"


@dataclass(frozen=True)
class Style:
    key: str
    name: str
    candles: str
    days: int  # the default test, ending yesterday
    takes: str
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
        Style("scalp", "Scalp", "5-minute, 1-hour trend", 150, "several minutes",
              "DeskScalp", ("5m", "1h", "1d"), 30,
              "DeskScalpAI", ("5m", "15m", "1h", "1d"), 40),
        Style("day", "Day trade", "15-minute, 4-hour trend", 365, "several minutes",
              "DeskDay", ("15m", "4h", "1d"), 35,
              "DeskDayAI", ("15m", "1h", "4h", "1d"), 75),
        Style("swing", "Swing", "daily", 1095, "under a minute",
              "DeskSwing", ("1d",), 405,
              "DeskSwingAI", ("1d",), 1205),
        Style("position", "Position", "weekly", 1095, "under a minute",
              "DeskPosition", ("1w", "1d"), 1105),
    )
}  # fmt: skip


class BadRun(ValueError):
    """A run request the desk won't queue."""


@dataclass(frozen=True)
class Run:
    style: Style
    ai: bool
    start: date
    end: date

    @property
    def strategy(self) -> str:
        return (self.style.ai_strategy if self.ai else None) or self.style.strategy


def _day(value: object, name: str) -> date:
    if not isinstance(value, str) or not DATE.fullmatch(value):
        raise BadRun(f"{name} must be a date like 2025-01-31.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise BadRun(f"{name} isn't a real date.") from None


def check(body: dict[str, Any], today: date | None = None) -> Run:
    """The run asked for, or BadRun saying what to fix."""
    style = STYLES.get(str(body.get("style", "")))
    if style is None:
        raise BadRun("Pick scalp, day, swing or position.")
    ai = body.get("ai", False)
    if not isinstance(ai, bool):
        raise BadRun("The AI filter is on or off.")
    if ai and style.ai_strategy is None:
        raise BadRun(f"{style.name} has no AI filter: too few candles a coin to learn from.")
    start, end = _day(body.get("from"), "From"), _day(body.get("to"), "To")
    last = (today or datetime.now(UTC).date()) - timedelta(days=1)  # today's candles aren't closed
    if start < FIRST_DAY:
        raise BadRun("From can't be before 17 Aug 2017, Binance's first candles.")
    if end > last:
        raise BadRun("To can't be later than yesterday: today's candles aren't closed.")
    if start >= end:
        raise BadRun("From must be before To.")
    return Run(style, ai, start, end)


def default(style: Style, today: date | None = None) -> tuple[str, str]:
    """The style's usual test: its days, ending yesterday."""
    end = (today or datetime.now(UTC).date()) - timedelta(days=1)
    return (end - timedelta(days=style.days)).isoformat(), end.isoformat()


def commands(run: Run) -> list[list[str]]:
    """Download what's missing (newer, then older: known-mistakes 13b), then backtest."""
    configs = ["--config", f"{CONFIG}/backtest.json"]
    if run.ai:
        configs += ["--config", f"{CONFIG}/ai-{run.style.key}.json"]
    timeframes = run.style.ai_timeframes if run.ai else run.style.timeframes
    warmup = run.style.ai_warmup if run.ai else run.style.warmup
    first = (run.start - timedelta(days=warmup)).strftime("%Y%m%d")
    end = run.end.strftime("%Y%m%d")
    download = [
        "freqtrade", "download-data", *configs,
        "--timerange", f"{first}-{end}", "--timeframes", *timeframes,
    ]  # fmt: skip
    return [
        download,
        [*download, "--prepend"],
        [
            "freqtrade", "backtesting", *configs,
            "--strategy", run.strategy,
            "--timerange", f"{run.start.strftime('%Y%m%d')}-{end}",
            "--fee", "0.001", "--export", "trades", "--cache", "none",
        ],
    ]  # fmt: skip
