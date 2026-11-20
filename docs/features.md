# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | http://127.0.0.1:5180 in Docker (`DESK_PORT`), 5173 with `npm run dev` |
| [`api`](#api) | The `desk` app | Behind the desk at `/api` in Docker; http://127.0.0.1:8000 with `uv run` |

## `desk`

Every page follows [design-system.md](design-system.md) 18 to 22. Features 1 to 52: [features/01-52.md](features/01-52.md); 54 to 72: [features/53-72.md](features/53-72.md); 73 to 94: [features/73-94.md](features/73-94.md); 95 to 99: [features/95-99.md](features/95-99.md).

| # | Feature | Status | PR |
|---|---|---|---|
| 100 | Backtest and paper trading with Freqtrade (apps/backtest): each style's own screener rule on years of Binance candles, sized, stopped and targeted as the desk does, reported in R by setup, exit and year; and one style paper-traded on live USDC prices. No keys, never places an order (owner, 17 Nov 2026) | Done | |
| 101 | The AI parts of the backtest: FreqAI (LightGBM, retrained as the test walks forward) filters each style's own setups by its chance of a win; and the paper bot asks trading-agent before every entry (POST /pot/judge-one, New trade's prompt and the desk's facts), trading only a take and keeping every verdict (owner, 17 Nov 2026) | Done | |
| 102 | Feature flags in Settings: one list of the desk's pages and features, each with a switch; off hides it from the side panel and the Dashboard, skips loading its code, and a link to it opens the Dashboard with a note; Dashboard and Settings always on; hiding never stops orders, bots, checks or agents (owner, 20 Nov 2026; add one with a line in apps/desk/src/features.tsx) | Done | |
| 103 | The Backtest page: pick a type (scalp, day trade, swing, position), one coin from today's top 100 USDC coins (the Trade screener's) and 1 or 3 months (or dates up to 3 months), and Run; the backtest worker runs Freqtrade and the page shows its steps, then the result in R (tiles, the equity curve, by setup, exit and year, every trade), the runs started from the page to open or compare, and each New trade style card's newest record; Trades and Runs fold (TODO 26, owner, 20 Nov 2026; decision 87) | Done | |
| 104 | Trading account money in P&L: Unrealized (open trades in $ and % of what they cost) and Realized (closed trades in $ and % of what went in, with this month under it) replace This month; a position row shows how far the coin has moved from its fill in %, not R (owner, 20 Nov 2026) | Done | |
| 105 | Scan now runs all four styles (scalp, day, swing, position) and leaves a card for each under the scan line: a take with its grade and reward to risk and a Review button, else the coin closest to a setup and what it is missing, else why nothing is near or the style is off; the daily scan stays swing, plus position on Mondays (owner, 20 Nov 2026; decision 88) | Done | Each card's backtest result follows once the Backtest page merges |
| 106 | Backtest exits and a benchmark: each style's Not built yet exits (the partial at the target, break-even, close stops, trails, time stops, the day close) as `run.sh <style>-exits` beside the plain style; NostalgiaForInfinity X8 as a public benchmark (`run.sh nfi`, downloaded at a pinned release); any run on BTC/USDT alone (`btc`) (owner, 20 Nov 2026; decision 89) | Done | |
| 107 | The Monday close-out sees the whole week: every DCA buy counts toward its week whichever button placed it (Weekly DCA, Add funds, a single order); Monday's Telegram message shows bought, open limits and not placed yet, with Keep them open (the default) and Buy the rest at market, which also buys each coin's plan share never placed and names any coin it couldn't; the 3-year ticks show a week bought, part bought or missed (TODO 28, owner, 20 Nov 2026; decision 90) | Done | |
| 108 | Exits Binance won't take yet: a stop or target outside its price band is watched by the desk or placed as the stop alone, then placed in full once in range; the Positions row says Desk-watched stop, Stop only or No stop on Binance (owner, 20 Nov 2026; decision 91) | Done | |
| 109 | Trading account stats by style and setup, with an equity curve in R (owner, 20 Nov 2026) | Done | |
| 110 | Trade page tidy: scan cards say Nearest, the scan line is a count, the positions ladder labels the price now and the distance to the stop, and the watchlist is compact rows with setups first (owner, 20 Nov 2026) | Done | |

## `api`

Features 7 to 25: [features/01-52.md](features/01-52.md); 53: [features/53-72.md](features/53-72.md).

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment. Every feature so far is in [features/01-52.md](features/01-52.md).

Status: Next, Building, Done or Dropped (with the reason).
