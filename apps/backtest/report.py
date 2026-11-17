"""The desk's measure of a Freqtrade backtest: every trade in R (its result over the 1% it
risked), by setup, exit and year, with the worst run of losses. Reads the newest result, or
the file named. Run inside the backtest container: python /freqtrade/report.py [file]."""

import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

RESULTS = Path("/freqtrade/user_data/backtest_results")
FEE = 0.001


def _load(path: Path) -> dict[str, Any]:
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            name = next(
                n
                for n in z.namelist()
                if n.endswith(".json") and not n.endswith(("_config.json", "_market_change.json"))
            )
            return json.loads(z.read(name))
    return json.loads(path.read_text())


def newest() -> Path:
    last = RESULTS / ".last_result.json"
    if last.exists():
        return RESULTS / json.loads(last.read_text())["latest_backtest"]
    return max(RESULTS.glob("backtest-result-*"), key=lambda p: p.stat().st_mtime)


def r_of(trade: dict[str, Any]) -> float | None:
    """The trade's result over what it risked: the fill to the setup's stop, fees included."""
    try:
        _, _, stop, _ = str(trade["enter_tag"]).split("|")
        stop_f = float(stop)
    except ValueError:
        return None
    rate, amount = float(trade["open_rate"]), float(trade["amount"])
    risk = amount * (rate - stop_f) + amount * (rate + stop_f) * FEE
    return float(trade["profit_abs"]) / risk if risk > 0 else None


def _line(name: str, rs: list[float]) -> str:
    wins = sum(1 for r in rs if r > 0)
    total = sum(rs)
    return (
        f"  {name:<34} {len(rs):>5}  {wins / len(rs) * 100:>5.0f}%  "
        f"{total / len(rs):>+7.2f}R  {total:>+8.1f}R"
    )


def worst_run(rs: list[float]) -> float:
    peak = low = level = 0.0
    for r in rs:
        level += r
        peak = max(peak, level)
        low = min(low, level - peak)
    return low


EXITS = {
    "roi": "target",
    "stop_loss": "stop",
    "trailing_stop_loss": "stop",  # the per-trade stop, once set, is reported as trailing
    "force_exit": "still open at end",
}


def _group(trade: dict[str, Any], key: str) -> str:
    if key == "setup":
        return str(trade["enter_tag"]).split("|")[0]
    if key == "exit":
        reason = str(trade["exit_reason"])
        return EXITS.get(reason, reason)
    return str(trade["open_date"])[:4]


def report(data: dict[str, Any]) -> None:
    for name, result in data.get("strategy", {}).items():
        trades = sorted(result.get("trades", []), key=lambda t: t["open_date"])
        rated = [(t, r) for t in trades if (r := r_of(t)) is not None]
        print(
            f"\n{name}: {len(trades)} trades, {result.get('backtest_start', '')[:10]} to "
            f"{result.get('backtest_end', '')[:10]}, pairs {len(result.get('pairlist', []))}"
        )
        if not rated:
            print("  No trades: the rule found no setups it could fill in this period.")
            continue
        rs = [r for _, r in rated]
        print(f"  {'':<34} {'trades':>5}  {'won':>6}  {'avg':>8}  {'total':>9}")
        print(_line("All", rs))
        print(f"  Worst run from a high: {worst_run(rs):+.1f}R")
        for label, key in (("By setup", "setup"), ("By exit", "exit"), ("By year", "year")):
            groups: dict[str, list[float]] = defaultdict(list)
            for t, r in rated:
                groups[_group(t, key)].append(r)
            print(f"  {label}:")
            for k, g in sorted(groups.items(), key=lambda kv: -len(kv[1])):
                print(_line(k, g))


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else newest()
    print(f"Result: {path.name}")
    report(_load(path))
