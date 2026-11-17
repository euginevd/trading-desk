"""The odds check (the Time Machine idea from Jakeschincariol/day-trader-skill, MIT): before a
trade, how often its target comes before its stop. Two ways, both in code, no model:

- simulate: a few thousand paths built from the coin's own past candles, each candle drawn
  from the same time of day (intraday) as a move against the close before it;
- past: the style's own rule re-run on past candles, each signal walked forward.

Each is judged against break-even, 1 / (1 + R) after fees: 5 points either side is a coin
flip, 15 or more is strong. A simulation, not a prediction."""

import random
from collections.abc import Iterable
from typing import Any

FEE = 0.001  # Binance spot, each side
DAY_MS = 86_400_000
PATHS = 2000
SEED = 19  # the same paths every run, so a pick's odds don't move on a refresh
JITTER = 2  # a drawn candle may come from up to two slots either side
MIN_PATHS = 50  # decided paths needed to call the simulation
MIN_SIGNALS = 8  # decided past signals needed to call the rule's record

Rows = list[list[Any]]
Bar = tuple[float, float, float]  # high, low and close, each over the close before
Signal = tuple[int, float, float, float]  # the signal candle's index, entry, stop, target


def needed(entry: float, stop: float, target: float) -> float:
    """Break-even: the share of decided trades the target must win, after fees, in %."""
    reward = target * (1 - FEE) - entry * (1 + FEE)
    risk = entry * (1 + FEE) - stop * (1 - FEE)
    return risk / (reward + risk) * 100 if reward > 0 and risk > 0 else 100.0


def lean(target_n: int, stop_n: int, need: float, minimum: int) -> tuple[str, float | None]:
    """The word for how the target's share of decided trades compares with break-even."""
    decided = target_n + stop_n
    if decided < minimum:
        return "unclear", None
    share = target_n / decided * 100
    gap = share - need
    if gap >= 15:  # noqa: PLR2004
        word = "strong yes"
    elif gap >= 5:  # noqa: PLR2004
        word = "leans yes"
    elif gap > -5:  # noqa: PLR2004
        word = "coin flip"
    elif gap > -15:  # noqa: PLR2004
        word = "leans no"
    else:
        word = "strong no"
    return word, round(share, 1)


def walk(
    bars: Iterable[tuple[float, float]], entry: float, stop: float, target: float, *, filled: bool
) -> tuple[str, int]:
    """A limit entry then the race: the stop is checked first in each candle (a candle that
    touches both counts as a loss), and the candle that fills can't also take the target.
    Returns the outcome (target, stop, open or unfilled) and the candles it took."""
    n = 0
    for n, (high, low) in enumerate(bars, 1):
        if not filled:
            if low > entry:
                continue
            filled = True
            if low <= stop:
                return "stop", n
            continue
        if low <= stop:
            return "stop", n
        if high >= target:
            return "target", n
    return ("open" if filled else "unfilled"), n


def _pools(rows: Rows, slot_ms: int | None) -> tuple[list[list[Bar]], list[Bar]]:
    moves: list[tuple[int, Bar]] = []
    for prev, r in zip(rows, rows[1:], strict=False):
        c0 = float(prev[4])
        if c0 > 0:
            moves.append((int(r[0]), (float(r[2]) / c0, float(r[3]) / c0, float(r[4]) / c0)))
    every = [b for _, b in moves]
    if not slot_ms:
        return [every], every
    pools: list[list[Bar]] = [[] for _ in range(DAY_MS // slot_ms)]
    for t, b in moves:
        pools[(t % DAY_MS) // slot_ms].append(b)
    return pools, every


def simulate(  # noqa: PLR0913 - the plan and how to draw it
    rows: Rows,
    entry: float,
    stop: float,
    target: float,
    *,
    steps: int,
    slot_ms: int | None,
    paths: int = PATHS,
) -> dict[str, Any] | None:
    """Paths from the last close, each candle drawn from the coin's own past candles at the
    same time of day (any candle for daily and weekly)."""
    if len(rows) < 30:  # noqa: PLR2004 - too little to draw from
        return None
    pools, every = _pools(rows, slot_ms)
    rng = random.Random(SEED)  # noqa: S311 - a seeded simulation, not security
    start = float(rows[-1][4])
    first = int(rows[-1][0]) + (slot_ms or 0)
    filled = entry >= start * 0.9995
    counts = {"target": 0, "stop": 0, "open": 0, "unfilled": 0}

    def path() -> Iterable[tuple[float, float]]:
        p = start
        for i in range(steps):
            pool = every
            if slot_ms:
                slot = ((first + i * slot_ms) % DAY_MS) // slot_ms + rng.randint(-JITTER, JITTER)
                pool = pools[slot % len(pools)] or every
            h, lo, c = rng.choice(pool)
            yield p * h, p * lo
            p *= c

    for _ in range(paths):
        counts[walk(path(), entry, stop, target, filled=filled)[0]] += 1
    word, share = lean(counts["target"], counts["stop"], needed(entry, stop, target), MIN_PATHS)
    pct = {k: round(v / paths * 100, 1) for k, v in counts.items()}
    return {"paths": paths, **pct, "share": share, "lean": word}


def past(rows: Rows, signals: list[Signal], steps: int) -> dict[str, int]:
    """Each past signal walked forward over the candles after it; one trade at a time, so a
    setup that fires on several candles in a row counts once."""
    counts = {"signals": 0, "target": 0, "stop": 0, "open": 0, "unfilled": 0}
    busy_until = -1
    for i, entry, stop, target in signals:
        if i <= busy_until or i + 1 >= len(rows):
            continue
        bars = [(float(r[2]), float(r[3])) for r in rows[i + 1 : i + 1 + steps]]
        outcome, took = walk(bars, entry, stop, target, filled=entry >= float(rows[i][4]))
        if outcome == "unfilled":
            counts["unfilled"] += 1
            continue
        counts["signals"] += 1
        counts[outcome] += 1
        busy_until = i + took
    return counts


def span(rows: Rows, start: int) -> str:
    days = (int(rows[-1][0]) - int(rows[min(start, len(rows) - 1)][0])) / DAY_MS
    if days < 2:  # noqa: PLR2004
        return f"the last {round(days * 24)} hours"
    if days < 60:  # noqa: PLR2004
        return f"the last {round(days)} days"
    return f"the last {round(days / 30.4)} months"


def summary(
    sim: dict[str, Any] | None,
    record: dict[str, Any] | None,
    need: float,
    horizon: str,
) -> dict[str, Any]:
    """The odds a pick carries: the rule's record decides when it has enough signals, the
    simulation otherwise, and a short line for the card."""
    out: dict[str, Any] = {"needed": round(need, 1), "horizon": horizon, "sim": sim, "past": record}
    parts: list[str] = []
    overall = "unclear"
    decided = record["target"] + record["stop"] if record else 0
    if record and record["signals"] and not decided:
        n = record["signals"]
        parts.append(
            f"Rule over {record['span']}: {n} past {'signal' if n == 1 else 'signals'}, "
            "none hit either"
        )
    elif record and record["signals"]:
        parts.append(
            f"Rule over {record['span']}: target first {record['target']} of {decided}"
            + (f" ({record['share']:.0f}%)" if record["share"] is not None else "")
        )
        if record["lean"] != "unclear":
            overall = record["lean"]
    elif record:
        parts.append(f"Rule over {record['span']}: no past signals")
    if sim:
        parts.append(
            f"simulated {horizon}: {sim['target']:.0f}% target, {sim['stop']:.0f}% stop, "
            f"{sim['open'] + sim['unfilled']:.0f}% neither"
        )
        if overall == "unclear":
            overall = sim["lean"]
    out["lean"] = overall
    out["line"] = "; ".join(parts) + f". Needs {need:.0f}% to break even."
    return out
