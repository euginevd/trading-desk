"""The desk's measure of a Freqtrade backtest (feature 100): every trade in R, its result over
what it risked, by setup, exit and year, with the curve and the worst run from a high. Stdlib
only, so the backtest container's report.py and worker.py import it too (decision 87)."""

import json
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import IO, Any

from api.backtest_runs import STYLES

FEE = 0.001
EXITS = {
    "roi": "Target",
    "stop_loss": "Stop",
    "trailing_stop_loss": "Stop",  # the per-trade stop, once set, is reported as trailing
    "force_exit": "Still open at end",
}
# Each strategy's style, and whether FreqAI filters it.
STRATEGIES: dict[str, tuple[str, bool]] = {
    **{s.strategy: (s.key, False) for s in STYLES.values()},
    **{s.ai_strategy: (s.key, True) for s in STYLES.values() if s.ai_strategy},
}


def from_zip(source: Path | IO[bytes]) -> dict[str, Any]:
    """A result's JSON from Freqtrade's zip, given its path or a file already open."""
    with zipfile.ZipFile(source) as z:
        name = next(
            n
            for n in z.namelist()
            if n.endswith(".json") and not n.endswith(("_config.json", "_market_change.json"))
        )
        return json.loads(z.read(name))


def load(path: Path) -> dict[str, Any]:
    """A result's JSON, from Freqtrade's zip or a plain file."""
    if path.suffix == ".zip":
        return from_zip(path)
    return json.loads(path.read_text(encoding="utf-8"))


def _tag(trade: dict[str, Any]) -> tuple[str, float, float, float] | None:
    """The strategy's entry tag: setup|entry|stop|target."""
    try:
        setup, entry, stop, target = str(trade["enter_tag"]).split("|")
        return setup, float(entry), float(stop), float(target)
    except ValueError:
        return None


def r_of(trade: dict[str, Any]) -> float | None:
    """The trade's result over what it risked: the fill to the setup's stop, fees included."""
    tag = _tag(trade)
    if tag is None:
        return None
    stop = tag[2]
    rate = float(trade["open_rate"])
    # The amount bought, not what's left at the last exit after a part was sold at the target.
    bought = float(trade.get("max_stake_amount") or 0) / rate if rate > 0 else 0.0
    amount = bought or float(trade["amount"])
    risk = amount * (rate - stop) + amount * (rate + stop) * FEE
    return float(trade["profit_abs"]) / risk if risk > 0 else None


def worst_run(rs: list[float]) -> float:
    """The deepest fall in cumulative R from its high, as a negative number (0 if none)."""
    peak = low = level = 0.0
    for r in rs:
        level += r
        peak = max(peak, level)
        low = min(low, level - peak)
    return low


def _exit(trade: dict[str, Any]) -> str:
    reason = str(trade["exit_reason"])
    return EXITS.get(reason, reason)


def _row(name: str, rs: list[float]) -> dict[str, Any]:
    total = sum(rs)
    return {
        "name": name,
        "trades": len(rs),
        "won": sum(1 for r in rs if r > 0) / len(rs),
        "avg": total / len(rs),
        "total": total,
    }


def _groups(rated: list[tuple[dict[str, Any], float]], key: str) -> list[dict[str, Any]]:
    found: dict[str, list[float]] = defaultdict(list)
    for t, r in rated:
        if key == "setup":
            name = str(t["enter_tag"]).split("|")[0]
        elif key == "exit":
            name = _exit(t)
        else:
            name = str(t["open_date"])[:4]
        found[name].append(r)
    rows = [_row(k, g) for k, g in found.items()]
    if key == "year":
        return sorted(rows, key=lambda row: row["name"])
    return sorted(rows, key=lambda row: -row["trades"])


def _trade(t: dict[str, Any], r: float) -> dict[str, Any]:
    tag = _tag(t)
    assert tag is not None  # noqa: S101 - only rated trades come here
    return {
        "pair": str(t["pair"]),
        "coin": str(t["pair"]).split("/")[0],
        "setup": tag[0],
        "opened": int(t["open_timestamp"]),
        "closed": int(t["close_timestamp"]),
        "entry": float(t["open_rate"]),
        "exit": float(t["close_rate"]),
        "stop": tag[2],
        "target": tag[3],
        "exitReason": _exit(t),
        "r": r,
    }


def strategy_of(data: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    """The result's first strategy (run.sh and the worker test one per run)."""
    strategies: dict[str, dict[str, Any]] = data.get("strategy") or {}
    for name, result in strategies.items():
        return name, result
    return None


def summary(data: dict[str, Any]) -> dict[str, Any] | None:
    """Everything the Backtest page shows of a run: totals, the curve, groups and trades."""
    found = strategy_of(data)
    if found is None:
        return None
    name, result = found
    style, ai = STRATEGIES.get(name, (name, False))
    trades = sorted(result.get("trades", []), key=lambda t: t["open_timestamp"])
    rated = [(t, r) for t in trades if (r := r_of(t)) is not None]
    rs = [r for _, r in rated]
    # The curve and its worst run both follow the order trades closed in.
    closed = sorted(rated, key=lambda tr: tr[0]["close_timestamp"])
    curve: list[list[float]] = []
    level = 0.0
    for t, r in closed:
        level += r
        curve.append([int(t["close_timestamp"]), round(level, 3)])
    return {
        "strategy": name,
        "style": style,
        "ai": ai,
        "from": int(result.get("backtest_start_ts", 0)),
        "to": int(result.get("backtest_end_ts", 0)),
        "pairs": len(result.get("pairlist", [])),
        # A one-coin run names its coin.
        "coin": str(result["pairlist"][0]).split("/")[0]
        if len(result.get("pairlist", [])) == 1
        else None,
        "all": _row("All", rs) if rs else None,
        "worstRun": worst_run([r for _, r in closed]),
        "curve": curve,
        "bySetup": _groups(rated, "setup"),
        "byExit": _groups(rated, "exit"),
        "byYear": _groups(rated, "year"),
        "trades": [_trade(t, r) for t, r in reversed(rated)],
    }


def _line(row: dict[str, Any]) -> str:
    return (
        f"  {row['name']:<34} {row['trades']:>5}  {row['won'] * 100:>5.0f}%  "
        f"{row['avg']:>+7.2f}R  {row['total']:>+8.1f}R"
    )


def text(data: dict[str, Any]) -> str:
    """The report as run.sh prints it."""
    found = summary(data)
    if found is None:
        return "No strategy in this result."
    raw = strategy_of(data)
    assert raw is not None  # noqa: S101 - summary found one
    result = raw[1]
    lines = [
        f"\n{found['strategy']}: {len(result.get('trades', []))} trades, "
        f"{str(result.get('backtest_start', ''))[:10]} to "
        f"{str(result.get('backtest_end', ''))[:10]}, pairs {found['pairs']}"
    ]
    if found["all"] is None and result.get("trades"):
        lines.append(
            "  Not a desk strategy: its trades carry no setup stop, so no R. Compare its total"
            " profit %, drawdown and the market change (buy and hold) in Freqtrade's tables above."
        )
        return "\n".join(lines)
    if found["all"] is None:
        lines.append("  No trades: the rule found no setups it could fill in this period.")
        return "\n".join(lines)
    lines.append(f"  {'':<34} {'trades':>5}  {'won':>6}  {'avg':>8}  {'total':>9}")
    lines.append(_line(found["all"]))
    lines.append(f"  Worst run from a high: {found['worstRun']:+.1f}R")
    for label, key in (("By setup", "bySetup"), ("By exit", "byExit"), ("By year", "byYear")):
        lines.append(f"  {label}:")
        lines.extend(_line(row) for row in found[key])
    return "\n".join(lines)
