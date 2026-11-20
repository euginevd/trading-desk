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

## `api`

Features 7 to 25: [features/01-52.md](features/01-52.md); 53: [features/53-72.md](features/53-72.md).

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment. Every feature so far is in [features/01-52.md](features/01-52.md).

Status: Next, Building, Done or Dropped (with the reason).
