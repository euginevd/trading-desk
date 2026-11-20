#!/usr/bin/env bash
# Backtest the desk's styles with Freqtrade on Binance's public candles, then report in R.
#   bash apps/backtest/run.sh swing            one style: scalp, day, swing, position
#   bash apps/backtest/run.sh swing-ai         the same, filtered by FreqAI: scalp-ai, day-ai, swing-ai
#   bash apps/backtest/run.sh swing-exits      the same, with the exits not built on the desk yet
#   bash apps/backtest/run.sh nfi              NostalgiaForInfinity X8, a public benchmark (no R)
#   bash apps/backtest/run.sh all              every style, then each with FreqAI
#   bash apps/backtest/run.sh swing btc        BTC/USDT only (any of the above)
#   TIMERANGE=20240101- bash apps/backtest/run.sh day   your own dates
# Candles are kept in local/backtest/data, so a second run downloads only what's new.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows would rewrite the container's paths
cd "$(dirname "$0")/../.."

style="${1:-swing}"
only="${2:-}"
[ -z "$only" ] || [ "$only" = btc ] || { echo "The second word can only be btc." >&2 && exit 1; }
run() { docker compose --profile backtest run --rm "$@"; }

# NostalgiaForInfinity (GPL-3.0) is downloaded, never committed: a release over 7 days old,
# checked against its hash. To move to a newer release, change both lines.
NFI_TAG=v18.0.116
NFI_SHA=70cf0c06cebae0cb2929b081a030ee2e532bbf1590d8cb735bdfe85920e3854c
NFI_FILE=local/backtest/nfi/NostalgiaForInfinityX8.py

nfi() {
  if [ ! -f "$NFI_FILE" ] || ! echo "$NFI_SHA  $NFI_FILE" | sha256sum -c --status; then
    mkdir -p "$(dirname "$NFI_FILE")"
    curl -sSfL -o "$NFI_FILE" \
      "https://raw.githubusercontent.com/iterativv/NostalgiaForInfinity/$NFI_TAG/NostalgiaForInfinityX8.py"
    echo "$NFI_SHA  $NFI_FILE" | sha256sum -c --status ||
      { rm -f "$NFI_FILE" && echo "NostalgiaForInfinity's file doesn't match its hash." >&2 && exit 1; }
  fi
}

one() {
  local name="$1" strategy tfs from range ai="" detail="" extra=() configs=(--config /freqtrade/config/backtest.json)
  case "$name" in
    scalp) strategy=DeskScalp tfs="5m 1h 1d" from=180 range=150 ;;
    day) strategy=DeskDay tfs="15m 4h 1d" from=400 range=365 ;;
    swing) strategy=DeskSwing tfs="1d" from=1500 range=1095 ;;
    position) strategy=DeskPosition tfs="1w 1d" from=2200 range=1095 ;;
    # The exits run on smaller candles inside each one, so a stop and a target in one candle
    # come in their real order.
    scalp-exits) strategy=DeskScalpExits tfs="1m 5m 1h 1d" from=180 range=150 detail=1m ;;
    day-exits) strategy=DeskDayExits tfs="5m 15m 4h 1d" from=400 range=365 detail=5m ;;
    swing-exits) strategy=DeskSwingExits tfs="1h 1d" from=1500 range=1095 detail=1h ;;
    position-exits) strategy=DeskPositionExits tfs="1w 1d" from=2200 range=1095 detail=1d ;;
    # FreqAI trains on the days before each stretch it tests, so these need more history.
    scalp-ai) strategy=DeskScalpAI tfs="5m 15m 1h 1d" from=190 range=150 ai=ai-scalp.json ;;
    day-ai) strategy=DeskDayAI tfs="15m 1h 4h 1d" from=440 range=365 ai=ai-day.json ;;
    swing-ai) strategy=DeskSwingAI tfs="1d" from=2300 range=1095 ai=ai-swing.json ;;
    # 5-minute candles, with daily ones reaching back far enough for its daily indicators.
    nfi) nfi && strategy=NostalgiaForInfinityX8 tfs="5m 15m 1h 4h 1d" from=700 range=365 ai=nfi.json \
      extra=(--strategy-path /freqtrade/user_data/nfi) ;;
    *) echo "Pick scalp, day, swing, position (add -ai to the first three, -exits to any), nfi or all." >&2 && exit 1 ;;
  esac
  local start end
  [ -n "$ai" ] && configs+=(--config "/freqtrade/config/$ai")
  [ "$only" = btc ] && configs+=(--config /freqtrade/config/btc.json)
  [ -n "$detail" ] && extra+=(--timeframe-detail "$detail")
  start="$(date -u -d "-${range} days" +%Y%m%d 2>/dev/null || date -u -v-"${range}"d +%Y%m%d)"
  end="$(date -u +%Y%m%d)" # FreqAI refuses an open-ended range; today's candles aren't closed
  echo "== $name${only:+ ($only)}: candles for the last $from days =="
  # shellcheck disable=SC2086 # the timeframes are separate words on purpose
  run backtest download-data "${configs[@]}" --days "$from" --timeframes $tfs
  # and anything older than what's already kept (a new download only adds what's newer)
  # shellcheck disable=SC2086
  run backtest download-data "${configs[@]}" --days "$from" --timeframes $tfs --prepend
  echo "== $name${only:+ ($only)}: backtest from $start =="
  run backtest backtesting "${configs[@]}" ${extra[@]+"${extra[@]}"} \
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
