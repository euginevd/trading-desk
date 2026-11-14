# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | http://127.0.0.1:5180 in Docker (`DESK_PORT`), 5173 with `npm run dev` |
| [`api`](#api) | The `desk` app | Behind the desk at `/api` in Docker; http://127.0.0.1:8000 with `uv run` |

## `desk`

Both pages follow [design-system.md](design-system.md) 18 to 22.

| # | Feature | Status | PR |
|---|---|---|---|
| 1 | Portfolio page (TODO 1), now within 15: the spot wallet's holdings, each with its amount, price, value, share of the total, 24-hour change, average cost and unrealised profit or loss; the total in US and Australian dollars; open orders; recent trades; the time it was fetched, and Refresh (decision 9); `DEMO=1` shows made-up figures | Done | |
| 2 | Navigation (TODO 2): a top bar linking Dashboard and Trade terminal, with the kill switch always in view (spec 10) | Dropped: replaced by 14 | |
| 3 | Trade terminal (TODO 2): the pair's price and 24-hour change, the balances it needs, and the limits left today | Dropped: replaced by 16, 17 and 19 | |
| 4 | Smart trade (TODO 2): a market or limit buy with an optional take-profit and stop-loss, shown in words with its risk and reward on a confirm step before it's sent (decision 12) | Done | |
| 5 | Smart trades list (TODO 2): each trade's entry, exits, status and profit or loss, with Cancel before it fills and Close at market after | Done | |
| 6 | Limits and kill switch (TODO 2): the owner sets the per-order and daily limits, zero until set, and turns trading on or off (spec 10) | Done | |
| 13 | New look (TODO 3): the dark theme, teal accent and Inter of the owner's mockup across both pages (decision 15) | Done | |
| 14 | Shell (TODO 3): Portfolio and Trade in the top bar, with BTC, ETH and TAO tickers, a pill for each connection, and the kill switch (decision 19) | Done | |
| 15 | Portfolio redesign (TODO 3): total value with its 24-hour change and Australian dollar figure; Binance and TAO wallet values, with TAO free and staked; allocation bar; 30-day account value line; Balances and Open orders tabs, with Cancel on an order; holdings from both sources in one table | Done | |
| 16 | Watchlist (TODO 3): add a coin by its symbol, remove it, up to 10, each row with its price, 24-hour change and signal tag; kept between runs | Done | |
| 17 | Chart (TODO 3): the selected pair's candles and volume at 15m, 1h, 4h or 1D, with the price and the suggested buy level marked; price, 24-hour change, high, low and volume above it | Done | |
| 18 | AI signal panel (TODO 3): Buy now, Wait or Avoid, its confidence, when it ran and Re-run; sentiment, trend, RSI, and support and resistance; a one-line summary and three reasons (decision 16) | Done | |
| 19 | Order form (TODO 3): limit buy or limit sell, price prefilled from the signal, amount with 25, 50, 75% and Max, order value, what's available and the fee, then a confirm step; an optional take-profit and stop-loss on a buy; open orders below (decision 18) | Done | |
| 27 | TradingView chart: TradingView's Advanced Chart for the selected pair, with its indicators, drawing tools and details panel, and a Reset chart button (decision 22) | Done | |
| 28 | Watchlists: several named lists, each with its coin count, made and deleted from the Trade page; Portfolio first (decision 23) | Done | |
| 29 | Dust: holdings under $5 or with no price always hidden; amounts of holdings under $10 rounded to 2 places (decision 23) | Done | |
| 30 | Quote stablecoin: the Trade page trades USDC pairs, set by `DESK_QUOTE` (decision 21) | Done | |
| 31 | Side panel like 3Commas: Dashboard (the portfolio, renamed), Trade, and a Bots section; folds to icons; a drawer on phones; the total in Australian dollars first (decision 24) | Done | |
| 32 | DCA Bot and Grid Bot: placeholder pages saying what each will do; the bots come later (decision 24) | Planned | |
| 33 | Coin logos on the Dashboard and the watchlist, each coin's own from CoinGecko, kept locally; letters when there's none (decision 25) | Done | |
| 34 | Dashboard filter by source (All, Binance, Wallet) for the total, allocation, profit and balances; sleek rounding in the table (decision 26) | Done | |
| 35 | TAO wallet live through Taostats: staked and free TAO on the Dashboard (decision 17) | Done | |
| 36 | Dashboard PnL card: unrealised total and per account (Binance, Wallet) in AUD, USD and %; allocation lists every coin held, or by wallet | Done | |
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
| 41 | Eight compact Dashboard widgets: total, accounts, PnL, Fear & Greed, allocation, deposits, top movers, AI signals; Invested column and totals row in balances (decision 36) | Done | |
| 40 | USDC deposits into Binance for the financial year, a bar a month in AUD: paid where recorded, estimated at the day's rate otherwise (decision 31); Dashboard refresh is an icon, and the connect buttons are gone | Done | |
| 39 | Key levels over the chart: month, week and day opens, previous week and day highs and lows, support and resistance (decision 28) | Done | |
| 38 | Enter your own average cost for a holding with no trades, such as the TAO wallet (decision 27) | Done | |
| 37 | Trade page: resizable watchlist; order form, limits and orders under the chart | Done | |

## `api`

| # | Feature | Status | PR |
|---|---|---|---|
| 7 | Portfolio route (TODO 1): fetches balances, 24-hour prices, open orders and trades from Binance through the owner's key, works out value and profit or loss, and logs each exchange call to the add-only audit log (spec 10) | Done | |
| 8 | Health check, `GET /health` (spec 7) | Done | Starter |
| 9 | Smart trade route (TODO 2): places the buy, then the exits as one OCO order once it fills; refuses in code when over a limit, trading is off, or the same request comes twice; logs each step (spec 10, decision 12) | Done | |
| 10 | Trade watcher (TODO 2): while the api runs, checks open smart trades every 30 seconds, places exits for filled buys and records how each trade ended | Done | |
| 11 | Limits and kill switch store (TODO 2): kept in `local/desk.sqlite`, with every change in the audit log (decision 13) | Done | |
| 20 | TAO wallet (TODO 3): free, staked and total TAO for the owner's coldkey from Taostats, valued at Binance's TAO price, joined into the portfolio (decision 17) | Done | |
| 21 | Watchlist store and routes (TODO 3): add, list and remove coins, checked against Binance's USDT pairs, up to 10, in SQLite | Done | |
| 22 | Candles and indicators (TODO 3): Binance candles for a pair and interval; RSI 14, 20 and 50 period averages, and support and resistance worked out in code | Done | |
| 23 | AI signal (TODO 3): asks Claude, with web search for news, for a fixed-shape verdict, confidence, summary, reasons and suggested buy level; kept 4 hours; refuses past the monthly cap; logged (decision 16, spec 10) | Done | |
| 24 | Limit orders (TODO 3): place a spot limit buy or sell and cancel an open one, through the same limits, kill switch, idempotency key and audit log as smart trades (decision 18) | Done | |
| 25 | Account value history (TODO 3): the total recorded once a day in SQLite, for the 30-day line | Done | |

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment.

| # | Feature | Status | PR |
|---|---|---|---|
| 12 | Pipeline: app checks, security scans and image scans on every PR. `infra/aws/api` is removed and the `aws` workflow idles until hosting comes back (decision 14) | Done | Starter |
| 26 | Docker (TODO 3): one `docker compose up` runs `api` and `desk` on `127.0.0.1`, with `.env` passed to `api` and `local/` mounted for SQLite and the audit log; images scanned in CI (decision 14) | Done | |

Status: Next, Building, Done or Dropped (with the reason).
