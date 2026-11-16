# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | http://127.0.0.1:5180 in Docker (`DESK_PORT`), 5173 with `npm run dev` |
| [`api`](#api) | The `desk` app | Behind the desk at `/api` in Docker; http://127.0.0.1:8000 with `uv run` |

## `desk`

Both pages follow [design-system.md](design-system.md) 18 to 22. Features 1 to 52: [features/01-52.md](features/01-52.md).

| # | Feature | Status | PR |
|---|---|---|---|
| 54 | Settings page: the AI section switches between the API key and the Claude subscription, with the fallback; Sign in with Claude and a pasted key, saved to `.env` (decisions 50, 51) | Done | |
| 55 | Coach Dashboard (decision 52): greeting and mood with a short message, deposit coach against the monthly cap, today's key points, seven agents with placeholder replies; today's widgets moved to a Portfolio page | Done | |
| 56 | Profile page (decision 52; was Plan): replaced by feature 61 | Dropped: rebuilt as feature 61 | |
| 57 | Tax tab on Portfolio (decision 54): lots by coin with the 12-month countdown, this year's realised gains and losses, holdings under water before 30 June; a warning on the sell form | Done | |
| 58 | Drift card on Portfolio (decision 55): each target against now, and a link that prefills an order back toward target | Done | |
| 59 | Journal (decision 56): every filled order, its source and result, rule checks, setup and mistake tags, a 30-day score | Done | |
| 60 | Telegram morning summary from Settings (decision 57) | Done | |
| 61 | Profile as an Investment Policy Statement (decision 58): ten typed cards with "Not set", a top strip, versions with history, compare and restore, Markdown import and export, locks, live rule checks and a scorecard, the command bar's diff to accept, edit or reject, a what-if simulator and Riley's allocation review | Done | |
| 62 | Pre-trade check (decision 58): a buy or smart trade breaking a set Profile rule shows a red banner and needs "Place anyway (logged)" | Done | |
| 63 | Dashboard: a refresh button, the five-person agent team (decision 59), the weekly recap with past recaps, and Out of date marks | Done | |
| 64 | Settings shows the provider and model in use, providers as cards with their own status; Portfolio's allocation legend as coin icons | Done | |
| 65 | Trading agent (decision 60): a versioned agent profile on the Profile page (persona, style, brief, steps and models, floor, autonomy, compare, restore, trade.md); Analyse runs one coin step by step (brief, macro and events, technicals, plan fit and tax, bull against bear, risk, decision) and proposes an order to use, edit or dismiss; the Trade page rebuilt around it, with follow-up questions, Analyse all, a compact chart, guardrails and price alerts | Done | |
| 66 | Read-only Profile and Trading agent (decision 61): Show Profile and Show the agent's profile open profile.md and trade.md in a full-page reader; edits to either file become versions, a broken edit is named and the last good version stays | Done | |
| 67 | Profile v2 (decision 62): profile.md v2 as the source; summary card, Road to US$1M, Stack to 1 BTC and Cash floor from the file and live TAO and Binance; History with diff and restore; the command bar changes a figure through a diff and Accept; Quotes removed | Done | |
| 69 | Dashboard redesign (decision 63): the day in a sentence, a week rail with the plan's weekly and extra buys marked due, done or missed (hover or focus a day to read it), what to watch with deposits against the cap, Ask the desk, last week's recap in a line; rounded figures that roll, one-minute refresh, responsive to phone width | Done | |
| 70 | Portfolio redesign (decision 64): what you hold in a sentence, a strip of the holdings by coin with your targets under it (hover, focus or tap a slice to read it), targets and money in side by side, the holdings table with a value-against-cost bar; Fear & Greed in the top bar; quieter side panel with a kill switch that looks like one | Done | |
| 71 | Settings redesign and dedupe (decision 65): what the desk runs on in a sentence, hairline sections, the name only from the Profile; each fact on one page; BTC dominance's 24h move and BTC in whole dollars in the top bar | Done | |
| 72 | Journal redesign (decision 66): rules kept in a sentence, the last 30 days as a strip of trades (hover, focus or pick a dot), the ledger filtered to all, broke a rule or kept; responsive to phone width | Done | |
| 68 | Portfolio refresh: the Portfolio page reads balances again every minute while in view, and when its tab comes back | Done | |

## `api`

Features 7 to 25: [features/01-52.md](features/01-52.md).

| # | Feature | Status | PR |
|---|---|---|---|
| 53 | AI provider switch (decision 48): `AI_AUTH_MODE` picks the API key or the owner's Claude subscription (Claude Agent SDK) at each run; the panel and audit log name the source; optional fall back to the key | Done | |

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment. Every feature so far is in [features/01-52.md](features/01-52.md).

Status: Next, Building, Done or Dropped (with the reason).
