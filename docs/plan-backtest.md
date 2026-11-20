# Plan: the Backtest page

TODO 26, feature 103, decision 87. Profile: prototype. Mockup: [mockups/backtest.html](mockups/backtest.html).

## Design

A Backtest page in the side panel, after Trade, runs and reads the Freqtrade backtests (features 100 and 101) without the terminal. The pattern follows TradingView's Strategy Tester, FreqUI and QuantConnect: settings, Run, progress, summary tiles, an equity curve, the breakdowns and trades, and saved runs to compare.

1. **Run bar:** style (scalp, day, swing, position), AI filter (FreqAI; not for position), from and to dates with the style's default range filled in, and Run. One run at a time; a run can be cancelled.
2. **Progress:** queued, downloading candles, testing, reading the result, then done or failed, with the time taken and the last lines of Freqtrade's log.
3. **Result:** tiles (trades, won, average and total R, worst run from a high), the equity curve in R, and By setup, By exit and By year as bars. Then every trade: coin, setup, opened, held, entry, stop, target, exit and R.
4. **Runs:** every result in `local/backtest/backtest_results`, including the ones `run.sh` made, newest first. Compare overlays a second run's curve and puts its tiles beside the first.
5. **Phase 2:** each New trade style card gets one line from that style's newest plain run, linking to it.

How it runs, with no Docker socket and no Freqtrade webserver:

- A `backtest-worker` service (the Freqtrade image, always on, no ports) watches `local/backtest/jobs/`. The api writes a validated request there; the worker turns it into the same `download-data` and `backtesting` commands as `run.sh`, from fixed tables, and writes its status beside it.
- The R measure moves from `report.py` into `api/backtest_report.py` (stdlib only), so the api and the CLI report share one copy. The api reads each result zip directly.
- The api never starts processes; the worker never reads keys or the database.

Left alone: `run.sh`, paper trading (later, TODO 25), and the bots' 30-day preview backtest.

## Security risks

- **A job file as a way in:** the worker reads only the style key, AI flag and two dates, checks each against fixed tables and a date pattern, and builds an argument list (never a shell string). Anything else is refused and marked failed. Threat model: a new internal flow, api to worker through `local/backtest/jobs`.
- **A result read as a path:** run ids must match `backtest-result-YYYY-MM-DD_HH-MM-SS`; nothing else is opened.
- **Cost:** none in money (no model calls); CPU only, one run at a time.
- No new keys, ports or outbound services: the worker downloads Binance's public candles, as `run.sh` does.

## Phases

### 1. The page, its runs and the worker

- [ ] `api/backtest_report.py`: R by setup, exit and year, worst run, curve and trades, from a result zip; `report.py` imports it
- [ ] `api/backtest.py` and routes: `GET /backtest` (styles, runs, the job), `GET /backtest/run?id=`, `POST /backtest/jobs`, `POST /backtest/jobs/cancel`
- [ ] `apps/backtest/worker.py` and the `backtest-worker` service
- [ ] The Backtest page: run bar, progress, result, trades, runs and compare; loading, empty and error states
- [ ] Tests: the report on a small zip, request validation, the routes, the worker's command building, the page's main path

### 2. The tested record on New trade's style cards

- [ ] Each style card shows its newest plain run's trades and average R, linking to the run

### 3. Wrap-up

- [ ] One subagent review of the branch; features, TODO, decisions, threat model, screens.md and the README updated

## PR groups

1. Phases 1 to 3: the Backtest page, on branch `backtest-page`, opened when the owner says the batch is ready.

## Ask first

Prototype, so decided and recorded: one new always-on container (`backtest-worker`, the image already pinned for `backtest`); no new packages, AWS services or costs.
