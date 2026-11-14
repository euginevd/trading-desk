# trading-desk

An AI-native crypto trading desk for one owner. The Portfolio page shows what's held on Binance and in a TAO wallet; the Trade page keeps a watchlist with an AI buy signal for each coin and places spot limit orders on Binance, every one confirmed by the owner and inside their limits.

Built from [sdlc-template](https://github.com/euginevd/sdlc-template): a coding agent works to the numbered rules in [AGENTS.md](AGENTS.md), and a pipeline checks and scans every change. It's a prototype for its owner's own use, not financial advice and not a service. The AI signal advises; it never trades.

## Status

Runs locally in Docker, against your accounts or on demo data. Nothing is hosted (decision 14).

| Stage | What it adds | Status |
|---|---|---|
| 1 | Portfolio (Binance and the TAO wallet), watchlist with AI signals, chart, spot limit orders with optional take-profit and stop-loss, limits, a kill switch and an audit log | Built, being tested |
| 2 | Dollar Cost Averaging (DCA) bots | Later |
| 3 | Grid bots | Later |
| 4 | Bybit and leverage | Later |
| 5 | Decentralised exchange (DEX) leverage | Later |
| 6 | DeFi, and AI agents that build and test strategies | Later |

The plan is to use the first stage for three months before deciding what comes next.

## Security

The limits every stage keeps ([spec](docs/spec.md) 10):

1. One key per exchange and per purpose, never with withdrawal permission.
2. Every key works only from its allowed IP address. The MVP's reads and trades spot only.
3. Keys live in `.env` on your machine, passed to the api container only: never in code, logs, the browser or a prompt. The coding agent never reads one.
4. Every order is confirmed by you, sits within limits you set, and a kill switch refuses every new order.
5. The AI signal sees a coin's prices, indicators and news, never your balances, orders or keys, and can't place an order.
6. Only the desk is published, on `127.0.0.1`; the api answers the desk's own page alone.
7. Every exchange call, AI signal, order and settings change goes in an add-only audit log.

The risks and their controls: [docs/threat-model.md](docs/threat-model.md). The risks accepted for speed: [guides/03-security-trade-offs.md](guides/03-security-trade-offs.md).

## What's inside

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | The rules every coding agent reads |
| [docs/](docs/) | The spec, features, decisions, threat model, costs and design system |
| [apps/api/](apps/api/) | The api: Binance, the TAO wallet, AI signals and orders, in Python |
| [apps/desk/](apps/desk/) | The desk: React pages served by nginx, which passes `/api` to the api |
| [docker-compose.yml](docker-compose.yml) | Both apps on your machine |
| [.github/workflows/](.github/workflows/) | App checks, security and image scans; the Terraform workflow idles until hosting comes back |
| [infra/aws/bootstrap/](infra/aws/bootstrap/) | One stack per AWS account, deployed by the owner: GitHub sign-in, the deploy roles, the state bucket and a budget alert |
| [scripts/](scripts/) | Setup for a fresh clone, repo protection and PR findings |
| [guides/](guides/) | The template's guides to the workflow, the files and the guardrails |

## Run it

You need Docker. Copy `.env.example` to `.env` and fill it in:

- `DEMO=1` runs everything on made-up figures, with no keys.
- Binance: a key that can read and trade spot only, with withdrawals off, restricted to your IP address.
- TAO wallet: your coldkey's public address and a Taostats API key.
- AI signals: an Anthropic API key, and `AI_MONTHLY_CAP_USD` (20 unless you change it). Set a spend limit in the Anthropic Console too.

Then:

```bash
docker compose up --build
```

Open http://127.0.0.1:5180 (or the `DESK_PORT` you set). Set your per-order and daily limits on the Trade page before it will trade. Every call to Binance, Taostats and Claude, every order and every settings change is logged in `local/audit.jsonl`; the watchlist, signals, limits and smart trades are kept in `local/desk.sqlite`.

To work on the code instead, once per clone `bash scripts/setup.sh` and `cd apps/desk && npm ci`, then in two terminals from the repo root `uv run python -m api.local` and `cd apps/desk && npm run dev`.

Report a vulnerability through [SECURITY.md](SECURITY.md). [MIT licence](LICENSE).
