# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | http://127.0.0.1:5180 in Docker (`DESK_PORT`), 5173 with `npm run dev` |
| [`api`](#api) | The `desk` app | Behind the desk at `/api` in Docker; http://127.0.0.1:8000 with `uv run` |

## `desk`

Every page follows [design-system.md](design-system.md) 18 to 22. Features 1 to 52: [features/01-52.md](features/01-52.md); 54 to 72: [features/53-72.md](features/53-72.md); 73 to 94: [features/73-94.md](features/73-94.md); 95 to 99: [features/95-99.md](features/95-99.md); 100 to 106: [features/100-106.md](features/100-106.md).

| # | Feature | Status | PR |
|---|---|---|---|
| 107 | The Monday close-out sees the whole week: every DCA buy counts toward its week whichever button placed it (Weekly DCA, Add funds, a single order); Monday's Telegram message shows bought, open limits and not placed yet, with Keep them open (the default) and Buy the rest at market, which also buys each coin's plan share never placed and names any coin it couldn't; the 3-year ticks show a week bought, part bought or missed (TODO 28, owner, 20 Nov 2026; decision 90) | Done | |
| 108 | Exits Binance won't take yet: a stop or target outside its price band is watched by the desk or placed as the stop alone, then placed in full once in range; the Positions row says Desk-watched stop, Stop only or No stop on Binance (owner, 20 Nov 2026; decision 91) | Done | |
| 109 | Trading account stats by style and setup, with an equity curve in R (owner, 20 Nov 2026) | Done | |
| 110 | Trade page tidy: the positions ladder labels the price now and the distance to the stop, and the watchlist is compact rows with setups first (owner, 20 Nov 2026) | Done | |
| 111 | Keep as a holding: an open trade's coins leave the Trading account unsold, the trade booked at the price now and the amount taken out as POT-OUT; open risk up to 6% (owner, 20 Nov 2026; decision 92) | Done | |
| 112 | No stop wider than Binance holds: every style's stop is at most 18% under entry (position tightens to it, swing skips wider), and a trade whose stop is outside the pair's band is refused with the lowest it takes (owner, 20 Nov 2026; decision 93) | Done | |
| 114 | Hold with no stop: an open trade kept in Positions with no stop or target and no risk counted, until a stop is set from the panel or trading-agent's chat (owner, 20 Nov 2026; decision 94) | Done | |
| 113 | Trade page cards: the market as cards (regime, BTC against its averages, Fear & Greed and dominance, the scan), every tile and card opening its figures, and Scan now showing each style's steps as they run, foldable (owner, 20 Nov 2026) | Done | |
| 115 | DCA made visual: Weekly DCA leads with bought of the week, a bar of bought, open limits and not placed, a countdown to close-out, and coin cards showing the closest limit and how far it is; a coin panel with a taller price strip (gap shaded, each limit with its distance and amount), share against target as a bar, and an Away column; the DCA book with its actions beside the sentence, four figure tiles, a Mix of the book over its targets with the 3-year progress, and positions as cards by default, the table a click away (owner, 20 Nov 2026; mockups dca-week and dca-book) | Done | |
| 116 | Trade page reworked: a sentence with Scan now and New trade beside it; four tiles with Open risk and the month's loss as one Risk budget; the USDC shortfall as a short banner; positions above the market, a held trade on a Bought-to-Now strip with Set a stop; the market as one strip with BTC's averages as bars and Fear & Greed on its scale; Setups with how near each is and trading-agent's word (Take, Wait, Pass; decision 95); details open from the tile clicked; the BTC popup cut to what's new (owner, 20 Nov 2026; mockup trade-page) | Done | |
| 117 | DCA plan as a running total: the plan to date (every week adds its amount) against what's bought and in open limits from any week, the rest "no order yet"; Monday 5pm says what 7pm will do, with Buy everything now and Skip this week; at 6:45pm the close-out buys what has no order yet and limits a week old at market, within free USDC that isn't the Trading account's, the rest waiting for a deposit (owner, 21 Nov 2026; decision 96) | Done | |
| 118 | The scan as a process (owner, 21 Nov 2026; mockup trade-scan): five folding sections on the Trade page: what the scan reads (13 inputs), the market gates (regime with its two tests and what turns it, BTC's 1-hour and 4-hour gates with the price that opens each, the next 14 days of US macro releases, Fear & Greed and BTC dominance), each style's steps from 100 coins to a trade with the coins that passed and fell out, why, and the price that gets each past, what the AI was given, searched and said, and the near misses with trigger, distance, next event and the AI's word; the AI now also reads Fear & Greed, BTC dominance with its 7-day change, the macro calendar (shared with dca-agent), open interest, the week's news tone and, for BTC and ETH swing and position trades, ETF flows (decision 97) | Done | |
| 119 | Ladder trades: New trade's Ladder suggests rungs from support with each one's 7-day fill odds, every price and spend editable, stop and target optional; each rung is its own limit, the ladder one card above Positions with bought against planned, the average and Cancel the rest (owner, 21 Nov 2026; mockup trade-ladder; decision 97) | Done | |
| 120 | Trade page money and layout: Available is the USDC free on Binance (no 1K cap), then the page's own positions and waiting limits; Positions with what was invested; Profit and loss as one tile; position rows with value, invested, P&L and average against now; New trade beside the tabs; the watchlist a sortable table with market cap, its whole head folding it; the DCA book's Plan, Positions and Orders fold too (owner, 21 Nov 2026) | Done | |
| 121 | Take profit and Add funds on both Positions tables (owner, 21 Nov 2026): an open row's Take profit sells 25, 50, 75 or 100% at market or as up to three limit sells the desk suggests just under resistance, each at least $10 and leaving $10 or nothing, a warning past a sell under the average after fees; on the Trade page one Binance sell for the whole position (booked across its buys, its stop and target taken off), on the DCA book trims. Add funds plans buy limits from support for the money added and can re-plan the waiting limits with it. Both pages share the panels and the table cells (PositionCells, TakeProfitPanel, the ladder panel) | Done | |
| 122 | One Positions design on both pages (owner, 21 Nov 2026): Take profit and Add funds open inline in a position's row, shaped like the DCA book's Add funds, each with Strategize with trading-agent or dca-agent (three quick questions or a chat; the agent is given the position, the coin's levels, the fill odds from here and the market, and hands back the whole plan to place); each position's Orders panel holds its orders (filters, edit, cancel); the page-wide Orders, History and Stats went; the DCA plan has start and end dates | Done | |
| 123 | Bots in two tabs, DCA bots and Grid bots (owner, 21 Nov 2026); DCA bots has Weekly buys (the DCA book, buy and hold for years) and Swing bots (short deals for a sideways market); the DCA book's button row went: Buy this week and Edit sit on the Plan panel, adding to or taking from a coin is in its row. Binance reads kept briefly (open orders, balances, trades, pair rules) and paused short of Binance's 6000-a-minute limit | Done | |

## `api`

Features 7 to 25: [features/01-52.md](features/01-52.md); 53: [features/53-72.md](features/53-72.md).

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment. Every feature so far is in [features/01-52.md](features/01-52.md).

Status: Next, Building, Done or Dropped (with the reason).
