# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | Not deployed yet |
| [`api`](#api) | The `desk` app | Not deployed yet |

## `desk`

The MVP's screens are mocked up in [mockups/mvp.html](mockups/mvp.html).

| # | Feature | Status | PR |
|---|---|---|---|
| 1 | Sign-in with Cognito: one user, multi-factor, no sign-up (spec 9) | Next | |
| 2 | Dashboard: the total value, a card per product linking to its screens, and the state of each exchange connection; products not built yet are shown as later | Next | |
| 3 | Binance portfolio: spot balances with each holding's value and share of the total, open orders and recent trades, with the time of the last update (spec 8) | Next | |
| 4 | Audit log: every exchange call and sign-in, newest first, filtered by kind (spec 10) | Next | |

## `api`

| # | Feature | Status | PR |
|---|---|---|---|
| 5 | Health check, `GET /health` (spec 7) | Done | Starter |
| 6 | Binance read: balances, prices, open orders and trades through a read-only key from Secrets Manager, snapshotted to DynamoDB every five minutes (spec 10) | Next | |
| 7 | Portfolio routes for `desk`, each checking the owner's token and serving the last snapshot (spec 9) | Next | |
| 8 | Audit log: an add-only record of every exchange call, sign-in and settings change, and a route to read it (spec 10) | Next | |

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment.

| # | Feature | Status | PR |
|---|---|---|---|
| 9 | Pipeline: app checks, security scans, and a Terraform plan and apply through the `aws` workflow: a merge to `main` applies to `dev` | Done | Starter |

Status: Next, Building, Done or Dropped (with the reason).
