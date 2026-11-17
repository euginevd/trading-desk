# trading-desk

An AI-native crypto trading desk for one owner. It reads what's held on a spot exchange and in a self-custody wallet, runs a long-term DCA book and a small trading account with AI agents that propose and the owner approves, and keeps every order inside rules the owner sets.

Built from [sdlc-template](https://github.com/euginevd/sdlc-template): a coding agent works to the numbered rules in [AGENTS.md](AGENTS.md), and a pipeline checks and scans every change. It's a prototype for its owner's own use, not financial advice and not a service.

## Status

Runs locally in Docker, against your own accounts or on demo data. Nothing is hosted (decision 14).

| Area | What it does | Status |
|---|---|---|
| Dashboard and Portfolio | Holdings on the exchange and in the wallet, deposits, targets and drift | Built |
| Bots: Accumulation | A long-term DCA book: a weekly plan, positions for life, every order with an ID, run by dca-agent | Built, in use |
| Bots: Opportunities and Grid | Short-term DCA bots on a budget of their own, and grid bots | Built; the Opportunities budget is still to come |
| Trade: Trading account | A ring-fenced account run by trading-agent: 1% risk a trade, proposals, Analyse that sets the whole trade, a watchlist with insights | Built, being tested |
| Risk | risk-agent's board of limits, a daily check and a weekly review | Built |
| My agents | Each agent a versioned profile file, woken by a scheduler, with approvals by message | Built |
| Later | Leverage, DeFi, AI agents that build and test strategies | Not started |

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
| [docs/](docs/) | The spec, features, decisions, threat model, costs and design system |
| [apps/api/](apps/api/) | The api in Python: the exchange and wallet, the books, the agents, the scheduler and orders |
| [apps/desk/](apps/desk/) | The desk: React pages served by nginx, which passes `/api` to the api |
| [docker-compose.yml](docker-compose.yml) | Both apps on your machine |
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

Open http://127.0.0.1:5180 (or the `DESK_PORT` you set). Set your limits before it will trade. Every outside call, order and settings change is logged in `local/audit.jsonl`; the books, watchlists and settings are kept in `local/desk.sqlite`. Your agents' profiles live in `local/agents/`.

To work on the code instead, once per clone `bash scripts/setup.sh` and `cd apps/desk && npm ci`, then in two terminals from the repo root `uv run python -m api.local` and `cd apps/desk && npm run dev`.

Report a vulnerability through [SECURITY.md](SECURITY.md). [MIT licence](LICENSE).
