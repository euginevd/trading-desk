"""The desk's measure of a Freqtrade backtest, printed: every trade in R by setup, exit and
year, with the worst run of losses (api/backtest_report.py, shared with the Backtest page).
Reads the newest result, or the file named. Run inside the backtest container:
python /freqtrade/report.py [file]."""

import json
import sys
from pathlib import Path

from api.backtest_report import load, text

RESULTS = Path("/freqtrade/user_data/backtest_results")


def newest() -> Path:
    last = RESULTS / ".last_result.json"
    if last.exists():
        return RESULTS / json.loads(last.read_text())["latest_backtest"]
    return max(RESULTS.glob("backtest-result-*.zip"), key=lambda p: p.stat().st_mtime)


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else newest()
    print(f"Result: {path.name}")
    print(text(load(path)))
