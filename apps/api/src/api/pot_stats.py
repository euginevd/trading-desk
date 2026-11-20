"""The Trading account's statistics, from its closed trades: the overall figures, the same by style
and by setup, and the equity curve. Pure sums: no store, no exchange."""

from collections.abc import Callable, Iterable
from decimal import Decimal
from typing import Any, NamedTuple

ZERO = Decimal(0)
HUNDRED = Decimal(100)
CENT = Decimal("0.01")
OTHER = "Other"  # a trade whose setup names no style


class Closed(NamedTuple):
    """A closed trade, as the statistics need it: `result` after fees, in the quote coin."""

    closed: int
    setup: str
    style: str | None
    result: Decimal
    r: Decimal


def _plain(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _mean(xs: list[Decimal]) -> str | None:
    return _plain((sum(xs, ZERO) / len(xs)).quantize(CENT)) if xs else None


def _win_rate(wins: int, trades: int) -> str | None:
    return _plain(Decimal(wins * 100 // trades)) if trades else None


def in_order(trades: Iterable[Closed]) -> list[Closed]:
    return sorted(trades, key=lambda t: t.closed)


def drawdown_pct(trades: list[Closed], put_in: Decimal) -> Decimal:
    """The deepest fall from a peak, as a percent of that peak, starting from the money put in."""
    peak = level = put_in
    deepest = ZERO
    for t in trades:
        level += t.result
        peak = max(peak, level)
        if peak > 0:
            deepest = max(deepest, (peak - level) / peak * HUNDRED)
    return deepest


def grouped(trades: list[Closed], name_of: Callable[[Closed], str]) -> list[dict[str, Any]]:
    """A row per group, the most traded first; a break-even trade counts as not won."""
    groups: dict[str, list[Closed]] = {}
    for t in trades:
        groups.setdefault(name_of(t), []).append(t)
    rows: list[dict[str, Any]] = []
    for name, found in groups.items():
        rs = [t.r for t in found]
        wins = sum(1 for x in rs if x > 0)
        rows.append(
            {
                "name": name,
                "trades": len(found),
                "wins": wins,
                "winRate": _win_rate(wins, len(found)),
                "expectancyR": _mean(rs),
                "totalR": _plain(sum(rs, ZERO)),
                "result": str(sum((t.result for t in found), ZERO).quantize(CENT)),
            }
        )
    return sorted(rows, key=lambda row: -row["trades"])


def curve(trades: list[Closed]) -> list[dict[str, Any]]:
    """The equity curve, trade by trade in close order: running totals in R and the quote coin."""
    points: list[dict[str, Any]] = []
    cum_r = cum_result = ZERO
    for t in trades:
        cum_r += t.r
        cum_result += t.result
        points.append(
            {
                "closed": t.closed,
                "r": _plain(t.r),
                "cumR": _plain(cum_r),
                "cumResult": str(cum_result.quantize(CENT)),
            }
        )
    return points


def stats(trades: Iterable[Closed], put_in: Decimal, judge_after: int) -> dict[str, Any]:
    closed = in_order(trades)
    rs = [t.r for t in closed]
    wins, losses = [x for x in rs if x > 0], [x for x in rs if x <= 0]
    return {
        "trades": len(closed),
        "wins": len(wins),
        "losses": len(losses),
        "winRate": _win_rate(len(wins), len(closed)),
        "avgWinR": _mean(wins),
        "avgLossR": _mean(losses),
        "expectancyR": _mean(rs),
        "drawdownPct": _plain(drawdown_pct(closed, put_in).quantize(Decimal("0.1"))),
        "judgeAfter": judge_after,
        "byStyle": grouped(closed, lambda t: t.style or OTHER),
        "bySetup": grouped(closed, lambda t: t.setup),
        "curve": curve(closed),
    }
