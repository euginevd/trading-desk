# trading-desk

An AI-native crypto trading desk for one owner. It reads what's held on a spot exchange and in a self-custody wallet, runs a long-term DCA book and a small trading account with AI agents that propose and the owner approves, and keeps every order inside rules the owner sets.

Built from [sdlc-template](https://github.com/euginevd/sdlc-template): a coding agent works to the numbered rules in [AGENTS.md](AGENTS.md), and a pipeline checks and scans every change. It's a prototype for its owner's own use, not financial advice and not a service.

## Roadmap

Runs locally in Docker, against your own accounts or on demo data. Nothing is hosted (decision 14). The numbers are rows in [TODO.md](TODO.md) and [docs/features.md](docs/features.md).

### Built, on `main`

| Page | What it does |
|---|---|
| Dashboard | The morning view: a coach with the day's mood and key points, the DCA book's week, deposits against the monthly cap; a morning summary on Telegram |
| Portfolio | Holdings on Binance and in the TAO wallet, targets and drift, tax lots with the 12-month CGT discount countdown |
| Journal | Every trade with tags and notes |
| Trade | The Trading account, run by trading-agent: 1% risk a trade, New trade by style from a screener over the top 100 USDC coins, an odds check, Scan now, add, reduce or move the stop, P&L |
| Risk | risk-agent's board of limits, the biggest risks to your holdings, a daily check and a weekly review |
| Bots | Accumulation (the DCA book, run by dca-agent, with a Monday close-out on Telegram), Opportunities and Grid bots |
| Profile | Your Investment Policy Statement, versioned, with a command bar, a pre-trade check and My agents: each agent a versioned profile file, woken by a scheduler |
| Settings | Keys, the AI provider, Telegram and a switch per page. The kill switch is in the side panel |
| Backtest | A style, one top-100 coin and up to 3 months, run by Freqtrade in the `backtest-worker`, reported in R; more from the terminal in `apps/backtest` |

### In progress

Nothing on a branch right now.

### Planned

- Each style's backtest result on its Scan now card (TODO 27).
- Chat with dca-agent on Telegram: ask for revised orders and approve each with a tap (TODO 29).
- Each style's exits after the fill on live trades: half at target, trailing, time stops, the close stop (TODO 24). Drop or rework the setups that lose in backtests.
- Trading account fixes left from the 20 Nov audit: dust from part-fills, open risk after a reduce, proposal expiry, the daily limit (TODO 25).
- dca-agent run by the desk: proposing the week, fill odds, the events calendar, approvals by Telegram (TODO 10, 11).
- The Opportunities budget, and a budget per agent enforced in code (TODO 13, 16).
- One readable tag on every order the desk places, and Check against Binance for all of them (TODO 12).
- Risk: Ledger addresses, then risk-agent's file (TODO 23).
- Practice money, bot backtests, trade replays, typed bot rules, why each coin moved, a tax report, the desk from your phone (TODO 15 to 22).
- A rebalancing bot, paused for now (TODO 9).

### Later

Not started until moved up into [TODO.md](TODO.md): Bybit and leverage, DEX leverage, DeFi, and after three months of use a decision on commercialising it (decision 6), which would mean a move to `production`.

## Security

The limits every stage keeps ([spec](docs/spec.md) 10):

1. One exchange key per purpose, never with withdrawal permission, working only from your IP address. Spot only.
2. Keys live in `.env` on your machine, passed to the api container only: never in code, logs, the browser or a prompt. The coding agent never reads one.
3. Every order comes from you or a bot or agent action you approved, sits within limits you set, and a kill switch refuses every new order.
4. The AI agents see computed figures and your rules, never keys, wallet addresses or account ids, and every order they propose waits for your approval.
5. Only the desk is published, on `127.0.0.1`; the api answers the desk's own page alone.
6. Every exchange call, AI call, order and settings change goes in an add-only audit log.

The risks and their controls: [docs/threat-model.md](docs/threat-model.md). The risks accepted for speed: [guides/03-security-trade-offs.md](guides/03-security-trade-offs.md).

## What's inside

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | The rules every coding agent reads |
| [docs/](docs/) | The spec, features, decisions, threat model, costs, design system, known mistakes and the current plans |
| [TODO.md](TODO.md) | The owner's numbered requests: what's next |
| [apps/api/](apps/api/) | The api in Python: the exchange and wallet, the books, the agents, the scheduler and orders |
| [apps/desk/](apps/desk/) | The desk: React pages served by nginx, which passes `/api` to the api |
| [apps/backtest/](apps/backtest/README.md) | Freqtrade backtests and paper trading of the desk's styles, calling the api's own screener |
| [docker-compose.yml](docker-compose.yml) | The api, the desk and the `backtest-worker` on your machine; `backtest` and `paper` on demand |
| [.github/workflows/](.github/workflows/) | App checks, security and image scans; the Terraform workflow idles until hosting comes back |
| [infra/aws/bootstrap/](infra/aws/bootstrap/) | One stack per AWS account, deployed by the owner: GitHub sign-in, the deploy roles, the state bucket and a budget alert |
| [scripts/](scripts/) | Setup for a fresh clone, repo protection and PR findings |
| [guides/](guides/) | The template's guides to the workflow, the files and the guardrails |

## Run it

You need Docker. Copy `.env.example` to `.env` and fill it in; each setting is explained there.

- `DEMO=1` runs everything on made-up figures, with no keys.
- The exchange: a key that can read and trade spot only, with withdrawals off, restricted to your IP address.
- The wallet: its public address and the explorer's API key.
- The AI agents: an Anthropic API key and a monthly cap. Set a spend limit in the Anthropic Console too.

Then:

```bash
docker compose up --build
```

Open http://127.0.0.1:5180 (or the `DESK_PORT` you set). Set your limits before it will trade. Every outside call, order and settings change is logged in `local/audit.jsonl`; the books, watchlists and settings are kept in `local/desk.sqlite`. Your agents' profiles live in `local/agents/`. The Backtest page runs Freqtrade on years of Binance candles through the `backtest-worker` container, which starts with the rest; results are kept in `local/backtest/` ([apps/backtest](apps/backtest/README.md)).

The Backtest page runs through the `backtest-worker`, which starts with the rest. Backtests use no keys and never place an order; from the terminal, `bash apps/backtest/run.sh swing` (or `scalp`, `day`, `position`, `swing-ai`, `all`). Results go to `local/backtest/`; paper trading and the rest are in [apps/backtest](apps/backtest/README.md).

To work on the code instead, once per clone `bash scripts/setup.sh` and `cd apps/desk && npm ci`, then in two terminals from the repo root `uv run python -m api.local` and `cd apps/desk && npm run dev`.

Report a vulnerability through [SECURITY.md](SECURITY.md). [MIT licence](LICENSE).
