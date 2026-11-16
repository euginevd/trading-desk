# Plan: the trading pot and trading-agent

Spec items: TODO 12 (readable tags, TRD- and POT-), the trading-agent profile (`local/agents/trading-agent.md`). Mockup: [mockups/trade.html](mockups/trade.html).

## Design

The trading pot becomes its own book, as the DCA book is (decision 72), and trading-agent runs it the way dca-agent runs the DCA book: it proposes, the owner approves, the desk places and tracks.

- **The pot is a ledger.** Binance has one spot wallet, so the pot is the desk's own record: money put in (`POT-IN-n`), each trade's result after fees, and its cash. The desk never lets a trade spend more than the pot's cash, and never touches DCA money or DCA holdings. "Put in" and "trading result" are separate lines; the loss limits are measured net of money put in.
- **Every trade has a lifelong ID**, `TRD-{COIN}-{yy}W{ww}-{n}`, and each of its Binance orders carries it as the client order ID: `-E` the entry, `-X` the exit. Two permanent, append-only tables (add columns only, never drop or rename): `pot_trades` (setup, regime, entry, stop, target, size, risk, result in A$ and R, fees, rules kept) and `pot_orders` (every order sent), plus `pot_moves` (money in and out).
- **A trade's life:** trading-agent proposes (Scan now, or the chat) → the desk checks the risk rules (1% of the pot, half in Neutral; 25% largest position; 3% open risk; 2 : 1 after fees; the month's 6% loss limit; Bear: no longs) → the owner reviews → a limit entry → once filled, a Binance OCO sell holding the stop and the target together, so they work with the desk off → the stop or target fills, the trade closes and books its R. The stop only ever moves toward profit (the desk cancels and replaces the OCO).
- **The sync** runs in the watch loop beside the DCA book's: fills, OCO legs, cancellations, fees in BNB valued in USDC.
- **The Trade page is replaced** by the mockup: a sentence and totals, the market strip with Scan now, proposals waiting for the owner, open trades as a stop–entry–target ladder that opens a panel (chart, orders, move the stop, close at market), Show more for every trade, the numbers (win rate, expectancy, drawdown, 1 of 30) and the ledger with Check against Binance. trading-agent's chat folds away on the right. Hand trades go through the chat, so every trade is in the book.
- Left alone: the DCA book, bots and grids. The old Trade page's per-coin Analyse moves into the trade panel later, not in this plan.

## Security risks

- Orders with real money: every order needs the owner's approval in a review dialog; the desk's pre-trade checks (per-order and daily limits, the pot's cash, the risk rules) run on the api, not in the page. Threat model: pre-trade checks.
- The agent's output is untrusted: the api validates every proposed field (coin in the list, prices positive, stop under entry, target above), and drops anything that breaks a rule, as it does for dca-agent.
- No new endpoints outside the local api; no new services or packages.

## Phases

### 1. The pot book and the page

- [ ] `pot_trades`, `pot_orders`, `pot_moves`; Put in, refs and Binance tags; Check against Binance
- [ ] Entry, OCO exit, stop moves, close at market, cancel an unfilled entry; the sync books R and fees
- [ ] trading-agent: Scan now and the chat, proposals as cards, the desk's rule checks
- [ ] The new Trade page as the mockup, with loading, empty and error states
- [ ] Tests: refs and tags, sizing from the stop, each rule refusing, OCO after the fill, R after fees, the ledger
- [ ] Checks pass and one subagent review of the branch

### 2. Later

- [ ] The daily 11:15am scan, approve from Telegram, the Sunday review, a pot strip on the Dashboard

## Ask first

Decided by the owner on 17 Nov 2026: replace the Trade page; stops as Binance OCO orders; approve on the desk first. Start with 100 USDC. No new packages or services.
