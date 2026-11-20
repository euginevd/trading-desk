# Backtest and paper trading (Freqtrade)

Tests the desk's four styles on years of Binance candles, and paper-trades one live, with
[Freqtrade](https://www.freqtrade.io) 2026.10 (the latest release, with FreqAI) in its own container. It never places an order
and needs no keys: Binance's public candles only.

## Run it

From the desk: the **Backtest** page (http://127.0.0.1:5180/#/backtest) picks a type, one coin
from the Trade screener's top 100 USDC coins and up to 3 months, runs it through the
`backtest-worker` container (`worker.py`, which starts with `docker compose up`) and lists only
the runs started there (decision 87). The terminal runs below don't show on the page.

From the terminal:

```bash
bash apps/backtest/run.sh swing      # or scalp, day, position, all
TIMERANGE=20240101-20250101 bash apps/backtest/run.sh swing   # your own dates
```

Each run downloads what's missing into `local/backtest/data`, backtests the style, prints
Freqtrade's report, then the desk's own: every trade in **R** by setup, exit and year, with
the worst run of losses from a high.

| Style | Candles | Tested over | A run takes |
|---|---|---|---|
| Swing | daily | the last 3 years | under a minute |
| Position | weekly | the last 3 years (after 2 years of weekly history) | under a minute |
| Day trade | 15-minute, 4-hour trend | the last year | several minutes |
| Scalp | 5-minute, 1-hour trend | the last 5 months | several minutes |

Any run on BTC/USDT alone: add `btc`, as in `bash apps/backtest/run.sh swing btc`.

With the exits each style lists as Not built yet in trading-agent.md, `bash apps/backtest/run.sh
swing-exits` (or `scalp-exits`, `day-exits`, `position-exits`): see **The exits** below.
Compare its report with the plain style's.

NostalgiaForInfinity X8, the best-known public Freqtrade strategy, as a benchmark:
`bash apps/backtest/run.sh nfi` (the last year of 5-minute candles on the 20 coins; slow). It
makes no trades on BTC alone: its entries are built for altcoin dips. `run.sh`
downloads it at a pinned release into `local/backtest/nfi` and checks its hash; it's GPL-3.0
and never committed. Its trades have no setup stop, so there's no R: compare its total profit,
drawdown and market change (buy and hold) in Freqtrade's tables.

With FreqAI on top, `bash apps/backtest/run.sh swing-ai` (or `day-ai`, `scalp-ai`):
see **The AI parts** below. Compare its report with the plain style's.

Paper trading, one style at a time, on USDC pairs at live prices. Every entry asks
trading-agent first, through the desk (which must be running), and only a take goes ahead:

```bash
PAPER_STRATEGY=DeskSwing docker compose --profile paper up -d paper
PAPER_STRATEGY=DeskSwingAI PAPER_AI=ai-swing.json docker compose --profile paper up -d paper  # with FreqAI too
docker compose logs -f paper
docker compose --profile backtest run --rm backtest show-trades --db-url sqlite:////freqtrade/user_data/paper.sqlite
```

## What it tests

The setups aren't copied: each candle's signal comes from the desk's own screener
(`api.screener.signals`, mounted read-only), the same code New trade and the odds check use.
A test (`test_a_signal_never_reads_a_later_candle`) proves a signal reads only candles closed
by then. After the signal it mirrors the desk:

- a limit buy at the setup's entry, cancelled if unfilled after the style's wait (scalp 1
  hour, day 12 hours, swing 3 days, position 2 weeks);
- the setup's stop, checked against each candle's low, and its target, against the high; a
  candle touching both counts as the stop;
- 1% of the pot at risk a trade, at most 10 USDC, the position at most 25% of a 1,000 pot;
  at most 3 trades open, one per coin; 0.1% fees each side; no new trades in a Bear regime.

## The exits

`DeskScalpExits`, `DeskDayExits`, `DeskSwingExits` and `DeskPositionExits` (backtests only)
take the same setups with the exits trading-agent.md lists as Not built yet, through
Freqtrade's own callbacks. Each reads closed candles only and exits at the next candle's open.
They run on smaller candles inside each one (`--timeframe-detail`: 1-minute for scalp,
5-minute for day, hourly for swing, daily for position), so a stop and a target hit in one
candle come in their real order. The partial is a limit resting at the setup's target, not
offered on a candle the trade is leaving anyway; the stop moves to break-even from the candle
after it fills. Time stops count closes from the entry's fill and act on that close only. Day
trades take no entry from 23:45 UTC.

| Style | Exits |
|---|---|
| Scalp | Not at the target after 30 minutes, sell; an unfilled entry goes after 10 minutes |
| Day trade | Half at the target, the stop to break-even, the rest out on a close under the last hour's lows; under +0.5R after 4 hours, sell; out by 23:45 UTC |
| Swing | A close under the stop exits, with a hard stop 1 ATR lower (sized from it); half at the target, the stop to break-even, the rest out on a close 3 ATR under the highest close; the 10th daily close under entry + 1R exits |
| Position | A weekly close under the stop exits, with a hard stop 0.5 weekly ATR lower; a third at the target, then a weekly close under the 10-week SMA; under +1R after 8 weekly closes, exit |

R stays measured to the setup's stop, so a close stop's loss can pass 1R. Left out: swing's
entry in two halves (one entry), and day's 15-minute swing lows (the last hour's lowest low
stands in).

## The AI parts

- **FreqAI** (`DeskScalpAI`, `DeskDayAI`, `DeskSwingAI`; backtests and paper). A LightGBM
  model per coin learns from its past candles (RSI, MFI, ADX, rate of change, ATR, distance
  from the average and relative volume, over 10, 20 and 50 candles, on the style's
  timeframes) how often a trade of the style's shape won: bought at the close, the stop 1 to 2
  ATRs under it, the target at the style's reward to risk, within its hold. The desk's rule
  still finds the setups; a setup goes ahead only when the model gives it a chance of winning
  5 points over break-even and the candle looks like what it trained on. As the backtest walks
  forward it retrains on the days before each stretch (swing: 2 years before each month; day:
  60 days before each fortnight; scalp: 30 days before each week), so it never trains on what
  it then tests. Position has too few weekly candles a coin to learn from.
- **trading-agent** (paper only). Before each entry the paper bot asks the desk's
  trading-agent (POST /pot/judge-one) with New trade's prompt, rules, model and web search,
  and the desk's own facts and odds for the coin when its screen finds it too. Only a take
  goes ahead. Each verdict, with its reason, is kept in `local/backtest/agent_verdicts.jsonl`;
  a setup is asked about once. It can't be backtested: on past dates the model already knows
  what happened. Each question costs one trading-agent call (Opus for swing and position).

## What it doesn't

- **The screener's universe filters.** It tests a fixed list of 20 large coins against USDT
  (USDC pairs are too young for years of history), not each day's top 100 by volume. Coins
  that died aren't in it, so results flatter a little (survivorship).
- **trading-agent in backtests** (see above): paper trading only.
- The desk's monthly loss stop, its two-alts limit, and the scalp spread check.
- In the plain styles, exits the desk hasn't built: half at the target, trailing stops, time
  stops. A trade stays open until its stop or target, as on the desk. The `-exits` runs add
  them (above).

## Files

- `strategies/desk_styles.py`: the four strategies (`DeskScalp`, `DeskDay`, `DeskSwing`,
  `DeskPosition`), each with its `AI` and `Exits` versions. Type-checked in Freqtrade's image, not the desk's (pyproject excludes it).
- `config/backtest.json`: the pairs, the pot and the rules; `config/paper.json` adds USDC;
  `config/btc.json`: BTC/USDT only; `config/nfi.json`: NostalgiaForInfinity's own settings;
  `config/ai-*.json`: FreqAI for each style.
- `report.py`: the desk's report in R from Freqtrade's result.
- `run.sh`: download, backtest, report.
