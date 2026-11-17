# Backtest and paper trading (Freqtrade)

Tests the desk's four styles on years of Binance candles, and paper-trades one live, with
[Freqtrade](https://www.freqtrade.io) 2026.10 in its own container. It never places an order
and needs no keys: Binance's public candles only.

## Run it

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

Paper trading, one style at a time, on USDC pairs at live prices:

```bash
PAPER_STRATEGY=DeskSwing docker compose --profile paper up -d paper
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

## What it doesn't

- **The screener's universe filters.** It tests a fixed list of 20 large coins against USDT
  (USDC pairs are too young for years of history), not each day's top 100 by volume. Coins
  that died aren't in it, so results flatter a little (survivorship).
- **trading-agent's take, wait or pass.** The model can't be replayed on the past; this is the
  rule alone, before the model's judgement.
- The desk's monthly loss stop, its two-alts limit, and the scalp spread check.
- Exits the desk hasn't built: half at the target, trailing stops, time stops. A trade stays
  open until its stop or target, as on the desk.

## Files

- `strategies/desk_styles.py`: the four strategies (`DeskScalp`, `DeskDay`, `DeskSwing`,
  `DeskPosition`). Type-checked in Freqtrade's image, not the desk's (pyproject excludes it).
- `config/backtest.json`: the pairs, the pot and the rules; `config/paper.json` adds USDC.
- `report.py`: the desk's report in R from Freqtrade's result.
- `run.sh`: download, backtest, report.
