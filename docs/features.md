# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | http://127.0.0.1:5180 in Docker (`DESK_PORT`), 5173 with `npm run dev` |
| [`api`](#api) | The `desk` app | Behind the desk at `/api` in Docker; http://127.0.0.1:8000 with `uv run` |

## `desk`

Every page follows [design-system.md](design-system.md) 18 to 22. Features 1 to 52: [features/01-52.md](features/01-52.md); 54 to 72: [features/53-72.md](features/53-72.md); 73 to 94: [features/73-94.md](features/73-94.md).

| # | Feature | Status | PR |
|---|---|---|---|
| 95 | New trade by style: pick scalp, day, swing or position; the desk's screener reads the 100 most-traded USDC coins on Binance by that style's rules (no AI; CoinGecko's top 250 only to keep tokenized stocks and fiat out), trading-agent checks the shortlist's confluence and catalysts online, and each pick shows its grade, entry, take profit, stop, reward to risk and size, then Okay, review and Approve places it (TODO 24, owner, 17 Nov 2026; decision 80) | Built: on test | |
| 96 | trading-agent.md is the one record of the strategy: shared rules, then each style's Built and Not built yet; trading-agent follows it, the desk keeps every version in local/agents/history/, and the daily scan runs swing (position on Mondays) through the screener (owner, 17 Nov 2026; decision 81) | Done | |
| 97 | Managing a Trading account trade: enter at market or by limit, enter a waiting limit now, add (only in profit, within 1%), reduce 25 to 75%, move the stop or target, and a log of every event with its numbers beside your own notes (owner, 17 Nov 2026) | Done | |
| 98 | Trading account page leads with money: four tiles, the status and risk rules as chips, the market and last scan in one line, messages as a toast that fades; an empty scan names the three coins closest to a setup and what's missing (owner, 17 Nov 2026) | Done | |
| 99 | The odds check on each New trade pick (the Time Machine idea from day-trader-skill, MIT): the style's rule re-run on the coin's past candles and the plan simulated 2,000 times from them, each against break-even after fees; a tag (strong, leans yes, coin flip, leans no, poor) and one line on the card and in the review, a warning not a block (owner, 17 Nov 2026) | Done | |
| 100 | Backtest and paper trading with Freqtrade (apps/backtest): each style's own screener rule on years of Binance candles, sized, stopped and targeted as the desk does, reported in R by setup, exit and year; and one style paper-traded on live USDC prices. No keys, never places an order (owner, 17 Nov 2026) | Done | |
| 101 | The AI parts of the backtest: FreqAI (LightGBM, retrained as the test walks forward) filters each style's own setups by its chance of a win; and the paper bot asks trading-agent before every entry (POST /pot/judge-one, New trade's prompt and the desk's facts), trading only a take and keeping every verdict (owner, 17 Nov 2026) | Done | |
| 102 | Feature flags in Settings: one list of the desk's pages and features, each with a switch; off hides it from the side panel and the Dashboard, skips loading its code, and a link to it opens the Dashboard with a note; Dashboard and Settings always on; hiding never stops orders, bots, checks or agents (owner, 20 Nov 2026; add one with a line in apps/desk/src/features.tsx) | Done | |

## `api`

Features 7 to 25: [features/01-52.md](features/01-52.md); 53: [features/53-72.md](features/53-72.md).

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment. Every feature so far is in [features/01-52.md](features/01-52.md).

Status: Next, Building, Done or Dropped (with the reason).
| 104 | Trading account money in P&L: Unrealized (open trades in $ and % of what they cost) and Realized (closed trades in $ and % of what went in, with this month under it) replace This month; a position row shows how far the coin has moved from its fill in %, not R (owner, 20 Nov 2026) | Done | |
| 105 | Scan now runs all four styles (scalp, day, swing, position) and leaves a card for each under the scan line: a take with its grade and reward to risk and a Review button, else the coin closest to a setup and what it is missing, else why nothing is near or the style is off; the daily scan stays swing, plus position on Mondays (owner, 20 Nov 2026; decision 88) | Done | Each card's backtest result follows once the Backtest page merges |
