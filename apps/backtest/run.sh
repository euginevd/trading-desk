#!/usr/bin/env bash
# Backtest the desk's styles with Freqtrade on Binance's public candles, then report in R.
#   bash apps/backtest/run.sh swing            one style (scalp, day, swing, position)
#   bash apps/backtest/run.sh all              every style
#   TIMERANGE=20240101- bash apps/backtest/run.sh day   your own dates
# Candles are kept in local/backtest/data, so a second run downloads only what's new.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows would rewrite the container's paths
cd "$(dirname "$0")/../.."

style="${1:-swing}"
run() { docker compose --profile backtest run --rm "$@"; }

one() {
  local name="$1" strategy tfs from range
  case "$name" in
    scalp) strategy=DeskScalp tfs="5m 1h 1d" from=180 range=150 ;;
    day) strategy=DeskDay tfs="15m 4h 1d" from=400 range=365 ;;
    swing) strategy=DeskSwing tfs="1d" from=1500 range=1095 ;;
    position) strategy=DeskPosition tfs="1w 1d" from=2200 range=1095 ;;
    *) echo "Pick scalp, day, swing, position or all." >&2 && exit 1 ;;
  esac
  local start
  start="$(date -u -d "-${range} days" +%Y%m%d 2>/dev/null || date -u -v-"${range}"d +%Y%m%d)"
  echo "== $name: candles for the last $from days =="
  # shellcheck disable=SC2086 # the timeframes are separate words on purpose
  run backtest download-data --config /freqtrade/config/backtest.json \
    --days "$from" --timeframes $tfs
  echo "== $name: backtest from $start =="
  run backtest backtesting --config /freqtrade/config/backtest.json \
    --strategy "$strategy" --timerange "${TIMERANGE:-$start-}" --fee 0.001 \
    --export trades --cache none
  run --entrypoint python backtest /freqtrade/report.py
}

mkdir -p local/backtest
if [ "$style" = all ]; then
  for s in swing position day scalp; do one "$s"; done
else
  one "$style"
fi
