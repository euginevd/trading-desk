#!/usr/bin/env bash
# Backtest the desk's styles with Freqtrade on Binance's public candles, then report in R.
#   bash apps/backtest/run.sh swing            one style: scalp, day, swing, position
#   bash apps/backtest/run.sh swing-ai         the same, filtered by FreqAI: scalp-ai, day-ai, swing-ai
#   bash apps/backtest/run.sh all              every style, then each with FreqAI
#   TIMERANGE=20240101- bash apps/backtest/run.sh day   your own dates
# Candles are kept in local/backtest/data, so a second run downloads only what's new.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows would rewrite the container's paths
cd "$(dirname "$0")/../.."

style="${1:-swing}"
run() { docker compose --profile backtest run --rm "$@"; }

one() {
  local name="$1" strategy tfs from range ai=""
  case "$name" in
    scalp) strategy=DeskScalp tfs="5m 1h 1d" from=180 range=150 ;;
    day) strategy=DeskDay tfs="15m 4h 1d" from=400 range=365 ;;
    swing) strategy=DeskSwing tfs="1d" from=1500 range=1095 ;;
    position) strategy=DeskPosition tfs="1w 1d" from=2200 range=1095 ;;
    # FreqAI trains on the days before each stretch it tests, so these need more history.
    scalp-ai) strategy=DeskScalpAI tfs="5m 15m 1h 1d" from=190 range=150 ai=ai-scalp.json ;;
    day-ai) strategy=DeskDayAI tfs="15m 1h 4h 1d" from=440 range=365 ai=ai-day.json ;;
    swing-ai) strategy=DeskSwingAI tfs="1d" from=2300 range=1095 ai=ai-swing.json ;;
    *) echo "Pick scalp, day, swing, position (add -ai to the first three) or all." >&2 && exit 1 ;;
  esac
  local start end configs=(--config /freqtrade/config/backtest.json)
  [ -n "$ai" ] && configs+=(--config "/freqtrade/config/$ai")
  start="$(date -u -d "-${range} days" +%Y%m%d 2>/dev/null || date -u -v-"${range}"d +%Y%m%d)"
  end="$(date -u +%Y%m%d)" # FreqAI refuses an open-ended range; today's candles aren't closed
  echo "== $name: candles for the last $from days =="
  # shellcheck disable=SC2086 # the timeframes are separate words on purpose
  run backtest download-data "${configs[0]}" "${configs[1]}" --days "$from" --timeframes $tfs
  # and anything older than what's already kept (a new download only adds what's newer)
  # shellcheck disable=SC2086
  run backtest download-data "${configs[0]}" "${configs[1]}" --days "$from" --timeframes $tfs --prepend
  echo "== $name: backtest from $start =="
  run backtest backtesting "${configs[@]}" \
    --strategy "$strategy" --timerange "${TIMERANGE:-$start-$end}" --fee 0.001 \
    --export trades --cache none
  run --entrypoint python backtest /freqtrade/report.py
}

mkdir -p local/backtest
if [ "$style" = all ]; then
  for s in swing position day scalp swing-ai day-ai scalp-ai; do one "$s"; done
else
  one "$style"
fi
