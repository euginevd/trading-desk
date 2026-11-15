# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | http://127.0.0.1:5180 in Docker (`DESK_PORT`), 5173 with `npm run dev` |
| [`api`](#api) | The `desk` app | Behind the desk at `/api` in Docker; http://127.0.0.1:8000 with `uv run` |

## `desk`

Both pages follow [design-system.md](design-system.md) 18 to 22. Features 1 to 41: [features/01-41.md](features/01-41.md).

| # | Feature | Status | PR |
|---|---|---|---|
| 42 | DCA bots (decision 37): a four-step wizard (pair; Bollinger Band entry on 15m, 1h or 4h; base order, DCA order, deviation %, max DCA orders, DCA size and deviation multipliers, presets; take profit % and what follows it) beside the ladder, a chart of the band and ladder, the limit checks and a backtest. Limit orders only; created off, switched on after a confirm; the kill switch stops them | Done | |
| 43 | Grid bots (decision 38): a three-step wizard (pair; range from the last 14 days, grids, geometric or arithmetic; investment, buy first, stop below) beside profit per grid, the opening buys, the limit checks, a week's chart with the lines and a backtest against holding. Limit orders only; created off, switched on after a confirm; the kill switch cancels their buys | Done | |
| 44 | Ladder buys on the order form (decision 39): 2 to 20 limit buys from a top to a bottom price, sized equally or more at lower prices, each a smart trade with the same exits, checked whole and confirmed once; Hide chart on the Trade page | Done | |
| 45 | Bots like a consumer app (decision 40): Create bot from watchlist coins, 30-day presets with a reason per setting (DCA, grid, ladder), Lightweight Charts with the levels, simultaneous DCA deals, references (DCA-1, D-12, GRID-2, ST-7), bot tables with Active and Stopped, Copy, and a page per bot with Live and History | Done | |
| 46 | A sleeker watchlist: the list name opens a menu (switch, edit, new, delete); add and remove only while editing; Analyse all runs a fresh AI signal for each coin in turn, inside the monthly AI cap | Done | |
| 47 | Smart trade as a one-off DCA deal (decision 41): New trade in four steps (entry, DCA orders, take profit, stop loss) with reasons, the levels on a chart, reward to risk, Active and History with TR references, Close at market; a plain Sell; key levels cut to the nearest ceiling and floor and the week and day opens | Done | |
| 48 | Header with Portfolio prices, the total in the chosen currency and BTC, and the currency toggle; every Dashboard widget opens a details panel, Fear & Greed with gauge, history, the year's range and the market (decision 42); coin logos in the allocation legend | Done | |
| 49 | Open orders on their chart with how far they are from filling, and Edit in one step (decision 43); details open in place; page titles hidden; header prices show only whole coins | Done | |
| 50 | Cancelling an open order asks first (Keep order is the default; the cancel is red and set apart); deposits details list the newest 20, scroll, and show more; the Dashboard's filter and Fetched share one row; Top movers shows the biggest gains or losses, biggest first, by a Gained / Lost toggle | Done | |
| 51 | Header: BTC, BTC dominance and market cap with 24h change (decision 44); times in am and pm; Top movers panel by Gained or Lost | Done | |
| 52 | AI panel as a plan for the owner's position (decision 46): position strip, action and horizons, zones with Prefill, what-if, why, context, watch-for alerts, track record, editable risk rules; swing support and resistance; level chips in words; draggable detail panels; smart trade spends in USDC or coins with Place now | Done | |
| 54 | Settings page: the AI section switches between the API key and the Claude subscription, with the fallback; Sign in with Claude and a pasted key, saved to `.env` (decisions 50, 51) | Done | |
| 55 | Coach Dashboard (decision 52): greeting and mood with a short message, deposit coach against the monthly cap, today's key points, seven agents with placeholder replies; today's widgets moved to a Portfolio page | Done | |
| 56 | Plan page (decision 52): goals, strategy, rules with history, lessons and quotes; the rules edited only here; every agent reads it | Done | |

## `api`

Features 7 to 25: [features/01-41.md](features/01-41.md).

| # | Feature | Status | PR |
|---|---|---|---|
| 53 | AI provider switch (decision 48): `AI_AUTH_MODE` picks the API key or the owner's Claude subscription (Claude Agent SDK) at each run; the panel and audit log name the source; optional fall back to the key | Done | |

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment. Every feature so far is in [features/01-41.md](features/01-41.md).

Status: Next, Building, Done or Dropped (with the reason).
