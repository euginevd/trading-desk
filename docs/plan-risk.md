# Plan: the Risk page rethink

TODO 23, feature 94, decision 79. Profile: prototype. Mockup: [mockups/risk.html](mockups/risk.html).

## Design

The Risk page leads with the four risks that can actually end the plan, ranked, each with its figure, its rule and the one thing to do; today's board of pot and DCA limits folds below as "Everyday limits".

1. **Money on Binance:** everything on the exchange (coins and USDC: DCA book, Trading account, float) against A$10K. Replaces the per-coin A$5K rule. Over it, the desk works out the month's move to the Ledger, largest coin first, keeping the week's DCA and the Trading account, sized to meet this rule and rule 2 together. The desk never withdraws; "Mark as moved" waits for the Ledger's balance to confirm it.
2. **2026 coins on the Ledger:** BTC, ETH, SOL, ZEC and HYPE, 70% or more by value on the Ledger, warn under 75%. TAO is measured apart, so its bag can't hide coins left on the exchange.
3. **TAO's share of crypto:** a target share and date (60% by Dec 2027), reached with new money only; the glide path in weeks of DCA at today's prices; value, cost and unrealised P&L; a what-if trim showing the loss realised (carried forward against capital gains, never income), the share after and weeks saved, with the wash-sale caution. The desk never proposes the sale (Profile 6.3). A quarterly review asks whether the thesis holds (Profile open item 1).
4. **Ledger backup:** four yes-or-no checks with dates (seed backed up away from the device, backup checked in place, PIN and passphrase known only to the owner, inheritance plan). Due every 6 months. Never a seed word, passphrase or location, anywhere.

Data:

- **Ledger balances:** watch-only public addresses kept in the local database (several per coin, since Ledger Live rotates BTC addresses): BTC from mempool.space, ETH and SOL from public RPC endpoints, no keys. ZEC and HYPE balances typed in with their date. Read every 15 minutes, cached; a failed read shows the last figure and its age.
- **TAO's cost:** typed once in Settings (no exchange holds it).
- **Backup checks:** dates in the settings table.
- **Profile:** 6.7 becomes "Binance holds at most A$10K; 70%+ of the 2026 coins on the Ledger, moved monthly"; 7.1 gains the glide path target; 7.6 the six-monthly check. Proposed through the command bar's diff, for the owner to Accept.

risk-agent's file and weekly review lead with the four; alerts stay on a state change only. Left alone: the pot and DCA limits and their checks.

## Security risks

- Public addresses sent to mempool.space and public RPCs link those addresses to the owner's IP: read through the api only, never the browser; addresses only in the local database, never in the repo, a log line or Telegram (threat model: a new outbound flow, added in phase 2).
- A seed typed somewhere by mistake: no field accepts free text on the backup checks; the page says plainly the desk never asks.
- No key that can sign or withdraw is added (spec: Binance stays spot-only, no withdrawal).

## Phases

### 1. The four risks on today's data

- [x] Money on Binance against A$10K with the month's move; TAO share, glide path, what-if and thesis prompt; backup checks on the Risk page itself (not Settings: one place); the old rows under Everyday limits
- [x] Ledger figures from the TAO wallet only, so rule 2 shows "not set up" until phase 2
- [ ] Profile 6.7, 7.1 and 7.6: the owner pastes the change into the command bar and Accepts
- [x] Tests: the cap and the move, the glide path weeks, the what-if, a backup check falling due

### 2. Ledger balances

- [ ] Public addresses for BTC, ETH and SOL in Settings, read and cached; ZEC and HYPE typed with a date
- [ ] The Portfolio shows Ledger as a source beside Binance and the TAO wallet
- [ ] Threat model and spec updated; tests with the lookups stubbed

### 3. risk-agent

- [ ] Its file and the weekly review lead with the four; the quarterly TAO question
- [ ] Checks pass and the branch review is clean

## PR groups

1. Phases 1–3: the Risk page rethink, on this session's branch.

## Ask first

Prototype, decided and recorded in decision 79: three free public lookups (mempool.space, an Ethereum and a Solana public RPC), no packages, no cost.
