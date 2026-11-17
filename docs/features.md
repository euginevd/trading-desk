# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | http://127.0.0.1:5180 in Docker (`DESK_PORT`), 5173 with `npm run dev` |
| [`api`](#api) | The `desk` app | Behind the desk at `/api` in Docker; http://127.0.0.1:8000 with `uv run` |

## `desk`

Every page follows [design-system.md](design-system.md) 18 to 22. Features 1 to 52: [features/01-52.md](features/01-52.md); 54 to 72: [features/53-72.md](features/53-72.md).

| # | Feature | Status | PR |
|---|---|---|---|
| 73 | Trade fixes (decision 67): the call first, the steps folded, the levels as a ladder, whole prices from 1,000 | Done | |
| 74 | Bots page (decision 68): DCA and grid bots on one page, chips by type; the old links open it filtered | Done; its chips by type replaced by 92 | |
| 75 | Trade, actionable only (decision 69): the verdict, what to do, the order and its buttons; reasons folded | Done | |
| 76 | My agents (decision 70): one versioned file per agent in local/agents/, on a week rota on the Profile | Done | |
| 77 | trading-agent (decision 71): the trading pot's agent, with swing, position and grid playbooks | Done | |
| 78 | The DCA book (TODO 11, decision 72): lifelong positions, the week's limits from fill odds, references, average cost, P&L, CSV export | Done | |
| 79 | Add and Remove funds on the DCA book (decision 72): dca-agent proposes a limit per coin; the desk checks the plan | Done | |
| 80 | DCA book around dca-agent (decision 72): a chat that proposes checked actions, positions against targets, live P&L | Done | |
| 81 | The trading pot (decision 73, [plan-trade.md](plan-trade.md) phase 1): POT- ledger, TRD- references, scan and chat proposals sized and checked by the desk | Done | |
| 82 | New trade by hand (decision 73): entry, stop and target sized live (POST /pot/preview), rule breaks named, a ladder and the numbers | Done | |
| 83 | The scheduler (decision 74): wakes each agent at its time and brings proposals to Telegram with one-use buttons; My agents shows jobs | Done | |
| 84 | trading-agent's analysis in New trade (decision 73): a verdict and the levels it fills in, sized and checked by the desk (POST /pot/analyse) | Done | |
| 85 | Risk page, run by risk-agent: every Profile limit as a gauge by book, a daily check to Telegram, a weekly review; risk per trade 1% with a dollar cap | Done | |
| 86 | Trade page becomes the Trading account (decision 75): money first, coins as cards (GET /pot/coins), trades in tabs, a soft ring-fence | Done | |
| 87 | DCA book open orders like an exchange's: View, Modify (cancel and replace, linked) and Cancel; Dedupe of same-price orders (owner, 17 Nov 2026) | Done | |
| 88 | One Orders section on the DCA book: filters, grouping, 24-hour odds, bulk cancel or move, an order panel with chart and history (owner, 17 Nov 2026) | Done | |
| 89 | Trading account Watchlist: coin cards with a one-word call, a panel with the daily chart and trading-agent's read (owner, 17 Nov 2026) | Done | |
| 90 | Analyse in New trade sets the whole trade, sized by the 1% rule, marked as the agent's until changed and checked again (owner, 17 Nov 2026) | Done | |
| 91 | The Trading account's watchlist holds up to 30 coins; the Trade page's lists stay at 10 (owner, 17 Nov 2026) | Done | |
| 92 | Bots page in three tabs: Accumulation (the DCA book), Opportunities and Grid bots; rebalancing dropped for now, TODO 9 (owner, 17 Nov 2026) | Done | |
| 93 | The teal floating console: rounded frame, layered panels, pill tabs with icons, icon row actions, one type scale with nothing under 12px to read; reading screens larger, trading screens dense (TODO 14, owner, 17 Nov 2026; [mockup](mockups/console.html)) | Next | |

## `api`

Features 7 to 25: [features/01-52.md](features/01-52.md); 53: [features/53-72.md](features/53-72.md).

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment. Every feature so far is in [features/01-52.md](features/01-52.md).

Status: Next, Building, Done or Dropped (with the reason).
