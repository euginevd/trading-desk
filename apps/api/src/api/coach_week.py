"""The Dashboard's week rail (decision 63): this calendar week, Monday to Sunday, with the plan's
weekly buy and its extra buy on their days, and what Binance says was bought since the buy day.

The days and amounts come from profile.md v2 (section 5.2: "A$1K every Friday", "Fear & Greed
below 50: extra A$1K a week, 2 days after the weekly buy"). Whether the extra buy applies is the
desk's to say, from today's Fear & Greed; this module only places it.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from api.binance import plain

SYDNEY = ZoneInfo("Australia/Sydney")
DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
WEEK = 7
NEAR_ENOUGH = Decimal("0.95")  # a limit order for A$1K that filled A$970 still counts as bought
ZERO = Decimal(0)


def monday(today: date) -> date:
    return today - timedelta(days=today.weekday())


def start_ms(today: date) -> int:
    """Monday 00:00 in Sydney, as the fills are read from."""
    return int(datetime.combine(monday(today), datetime.min.time(), SYDNEY).timestamp() * 1000)


def _whole(value: Decimal | None) -> str | None:
    return plain(value.quantize(Decimal(1))) if value is not None else None


def _state(day: date, today: date, *, done: bool) -> str:
    if done:
        return "done"
    if day > today:
        return "upcoming"
    return "due" if day == today else "missed"


def week(
    dca: dict[str, Any], buys: list[tuple[date, Decimal]] | None, today: date
) -> dict[str, Any]:
    """The seven days and the plan's buys on them. `buys` is each buy's day and A$ this week,
    or None when Binance couldn't be read: then nothing is marked done or missed."""
    first = monday(today)
    name = dca.get("day") if dca.get("day") in DAYS else None
    buy_day = first + timedelta(days=DAYS.index(name)) if name else None
    after = dca.get("extraAfterDays")
    extra_day = buy_day + timedelta(days=after) if buy_day and after is not None else None
    if extra_day and extra_day - first >= timedelta(days=WEEK):
        extra_day = None  # it falls in next week's rail
    weekly: Decimal | None = dca.get("weekly")
    extra: Decimal | None = dca.get("extra")
    since = sum((aud for day, aud in buys if buy_day and day >= buy_day), ZERO) if buys else ZERO
    known = buys is not None
    buy = None
    if buy_day and weekly is not None:
        bought = known and since >= weekly * NEAR_ENOUGH
        buy = {
            "date": buy_day.isoformat(),
            "aud": _whole(weekly),
            "boughtAud": _whole(since) if known else None,
            "state": _state(buy_day, today, done=bought) if known else "unknown",
        }
    extra_buy = None
    if extra_day and extra is not None and weekly is not None:
        done = known and since >= (weekly + extra) * NEAR_ENOUGH
        extra_buy = {
            "date": extra_day.isoformat(),
            "aud": _whole(extra),
            "fearGreedBelow": dca.get("fearGreedBelow"),
            "state": _state(extra_day, today, done=done) if known else "unknown",
        }
    marks = {buy_day: "buy", extra_day: "extra"}
    return {
        "today": today.isoformat(),
        "days": [
            {
                "date": (d := first + timedelta(days=i)).isoformat(),
                "name": DAYS[i][:3],
                "kind": marks.get(d, ""),
            }
            for i in range(WEEK)
        ],
        "buy": buy,
        "extra": extra_buy,
        "boughtAud": _whole(sum((aud for _, aud in buys), ZERO)) if buys is not None else None,
        "maxWeekAud": _whole(dca.get("maxWeek")),
        "maxMonthAud": _whole(dca.get("maxMonth")),
    }
