# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | http://127.0.0.1:5180 in Docker (`DESK_PORT`), 5173 with `npm run dev` |
| [`api`](#api) | The `desk` app | Behind the desk at `/api` in Docker; http://127.0.0.1:8000 with `uv run` |

## `desk`

Every page follows [design-system.md](design-system.md) 18 to 22. Features 1 to 52: [features/01-52.md](features/01-52.md); 54 to 72: [features/53-72.md](features/53-72.md); 73 to 94: [features/73-94.md](features/73-94.md); 95 to 99: [features/95-99.md](features/95-99.md); 100 to 106: [features/100-106.md](features/100-106.md); 107 to 117: [features/107-117.md](features/107-117.md).

| # | Feature | Status | PR |
|---|---|---|---|
| 118 | The scan as a process (owner, 21 Nov 2026; mockup trade-scan): five folding sections on the Trade page: what the scan reads (13 inputs), the market gates (regime with its two tests and what turns it, BTC's 1-hour and 4-hour gates with the price that opens each, the next 14 days of US macro releases, Fear & Greed and BTC dominance), each style's steps from 100 coins to a trade with the coins that passed and fell out, why, and the price that gets each past, what the AI was given, searched and said, and the near misses with trigger, distance, next event and the AI's word; the AI now also reads Fear & Greed, BTC dominance with its 7-day change, the macro calendar (shared with dca-agent), open interest, the week's news tone and, for BTC and ETH swing and position trades, ETF flows (decision 97) | Done | |
| 119 | Ladder trades: New trade's Ladder suggests rungs from support with each one's 7-day fill odds, every price and spend editable, stop and target optional; each rung is its own limit, the ladder one card above Positions with bought against planned, the average and Cancel the rest (owner, 21 Nov 2026; mockup trade-ladder; decision 97) | Done | |
| 120 | Trade page money and layout: Available is the USDC free on Binance (no 1K cap), then the page's own positions and waiting limits; Positions with what was invested; Profit and loss as one tile; position rows with value, invested, P&L and average against now; New trade beside the tabs; the watchlist a sortable table with market cap, its whole head folding it; the DCA book's Plan, Positions and Orders fold too (owner, 21 Nov 2026) | Done | |
| 121 | Take profit and Add funds on both Positions tables (owner, 21 Nov 2026): an open row's Take profit sells 25, 50, 75 or 100% at market or as up to three limit sells the desk suggests just under resistance, each at least $10 and leaving $10 or nothing, a warning past a sell under the average after fees; on the Trade page one Binance sell for the whole position (booked across its buys, its stop and target taken off), on the DCA book trims. Add funds plans buy limits from support for the money added and can re-plan the waiting limits with it. Both pages share the panels and the table cells (PositionCells, TakeProfitPanel, the ladder panel) | Done | |
| 122 | One Positions design on both pages (owner, 21 Nov 2026): Take profit and Add funds open inline in a position's row, shaped like the DCA book's Add funds, each with Strategize with trading-agent or dca-agent (three quick questions or a chat; the agent is given the position, the coin's levels, the fill odds from here and the market, and hands back the whole plan to place); each position's Orders panel holds its orders (filters, edit, cancel); the page-wide Orders, History and Stats went; the DCA plan has start and end dates | Done | |
| 123 | Bots in two tabs, DCA bots and Grid bots (owner, 21 Nov 2026); DCA bots has Weekly buys (the DCA book, buy and hold for years) and Swing bots (short deals for a sideways market); the DCA book's button row went: Buy this week and Edit sit on the Plan panel, adding to or taking from a coin is in its row. Binance reads kept briefly (open orders, balances, trades, pair rules) and paused short of Binance's 6000-a-minute limit | Done | |
| 124 | Trading limits in Settings: the per-order and daily limits shown with what is left today, set there, and a raise confirmed once more; until set, nothing buys (audit 15, 21 Nov 2026; feature 6, its old screen gone with decision 95) | Done | |
| 125 | The Ledger as a source (owner, 22 Nov 2026; decision 99): "TAO wallet" becomes Ledger; each coin read by public address beside TAO (Solana, Ethereum and HyperEVM with counted tokens, Sui, NEAR, Bitcoin by xpub); moved coins keep their Binance cost; Settings lists the addresses; Risk counts the 2026 coins on the Ledger | Done | |
| 126 | The Tax page (owner, 22 Nov 2026; decision 100): this FY's net gain in a sentence, the gains, lots and 12-month countdown and the under-water list moved from the Portfolio's Tax tab, and staking income, each claim the owner records valued in AUD when entered; every source counts, Binance and the Ledger | Done | |
| 127 | The Portfolio as three tabs (owner, 22 Nov 2026; decision 101): All, Binance and Ledger each with four widgets of their own, an Allocation donut with targets and rebalance links in its legend, Fiat (money in) on Binance; a failed or stale Ledger read named; orders in the chosen currency | Done | |

## `api`

Features 7 to 25: [features/01-52.md](features/01-52.md); 53: [features/53-72.md](features/53-72.md).

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment. Every feature so far is in [features/01-52.md](features/01-52.md).

Status: Next, Building, Done or Dropped (with the reason).
