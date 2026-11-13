# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | Not built yet |
| [`api`](#api) | The `desk` app | Not built yet |

## `desk`

The portfolio page is mocked up in [mockups/mvp.html](mockups/mvp.html) (Portfolio).

| # | Feature | Status | PR |
|---|---|---|---|
| 1 | Portfolio page (TODO 1): the spot wallet's holdings, each with its amount, price, value, share of the total, 24-hour change, average cost and unrealised profit or loss; the total in US and Australian dollars; open orders; recent trades; the time it was fetched, and Refresh (decision 9) | Building | |

## `api`

| # | Feature | Status | PR |
|---|---|---|---|
| 2 | Portfolio route (TODO 1): fetches balances, 24-hour prices, open orders and trades from Binance through the owner's key, works out value and profit or loss, and logs each exchange call to the add-only audit log (spec 10) | Building | |
| 3 | Health check, `GET /health` (spec 7) | Done | Starter |

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment.

| # | Feature | Status | PR |
|---|---|---|---|
| 4 | Pipeline: app checks, security scans, and a Terraform plan and apply through the `aws` workflow: a merge to `main` applies to `dev` | Done | Starter |

Status: Next, Building, Done or Dropped (with the reason).
