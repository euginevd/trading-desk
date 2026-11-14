# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | http://127.0.0.1:5173, locally |
| [`api`](#api) | The `desk` app | http://127.0.0.1:8000, locally |

## `desk`

Both pages are mocked up in [mockups/mvp.html](mockups/mvp.html).

| # | Feature | Status | PR |
|---|---|---|---|
| 1 | Portfolio page (TODO 1): the spot wallet's holdings, each with its amount, price, value, share of the total, 24-hour change, average cost and unrealised profit or loss; the total in US and Australian dollars; open orders; recent trades; the time it was fetched, and Refresh (decision 9); `DEMO=1` shows made-up figures | Done | |
| 2 | Navigation (TODO 2): a top bar linking Dashboard and Trade terminal, with the kill switch always in view (spec 10) | Done | |
| 3 | Trade terminal (TODO 2): the pair's price and 24-hour change, the balances it needs, and the limits left today | Done | |
| 4 | Smart trade (TODO 2): a market or limit buy with an optional take-profit and stop-loss, shown in words with its risk and reward on a confirm step before it's sent (decision 12) | Done | |
| 5 | Smart trades list (TODO 2): each trade's entry, exits, status and profit or loss, with Cancel before it fills and Close at market after | Done | |
| 6 | Limits and kill switch (TODO 2): the owner sets the per-order and daily limits, zero until set, and turns trading on or off (spec 10) | Done | |

## `api`

| # | Feature | Status | PR |
|---|---|---|---|
| 7 | Portfolio route (TODO 1): fetches balances, 24-hour prices, open orders and trades from Binance through the owner's key, works out value and profit or loss, and logs each exchange call to the add-only audit log (spec 10) | Done | |
| 8 | Health check, `GET /health` (spec 7) | Done | Starter |
| 9 | Smart trade route (TODO 2): places the buy, then the exits as one OCO order once it fills; refuses in code when over a limit, trading is off, or the same request comes twice; logs each step (spec 10, decision 12) | Done | |
| 10 | Trade watcher (TODO 2): while the api runs, checks open smart trades every 30 seconds, places exits for filled buys and records how each trade ended | Done | |
| 11 | Limits and kill switch store (TODO 2): kept in `local/desk.sqlite`, with every change in the audit log (decision 13) | Done | |

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment.

| # | Feature | Status | PR |
|---|---|---|---|
| 12 | Pipeline: app checks, security scans, and a Terraform plan and apply through the `aws` workflow: a merge to `main` applies to `dev` | Done | Starter |

Status: Next, Building, Done or Dropped (with the reason).
