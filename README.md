# trading-desk

A personal trading desk: one dashboard that links out to each trading product, with the same controls behind all of them. It starts as a dashboard and spot trade terminal for a Binance account and grows a stage at a time.

Built from [sdlc-template](https://github.com/euginevd/sdlc-template): a coding agent works to the numbered rules in [AGENTS.md](AGENTS.md), and a pipeline scans, plans and deploys to AWS. It's a prototype for its owner's own use, not financial advice and not a service.

## Status

Two pages run locally, against Binance or on demo data: the Dashboard and the Trade terminal. Nothing is deployed yet.

| Stage | What it adds | Status |
|---|---|---|
| 1 | Binance dashboard and spot trade terminal: balances, value, orders, trades, smart trades with a take-profit and stop-loss, limits, a kill switch and an audit log | Built, being tested |
| 2 | Dollar Cost Averaging (DCA) bots | Later |
| 3 | Grid bots | Later |
| 4 | Bybit and leverage | Later |
| 5 | Decentralised exchange (DEX) leverage | Later |
| 6 | DeFi | Later |

The plan is to use the first stage for three months before deciding what comes next.

## Security

The limits every stage keeps ([spec](docs/spec.md) 10):

1. One key per exchange and per purpose, never with withdrawal permission.
2. Every key works only from its allowed IP address. The MVP's reads and trades spot only.
3. Keys live in AWS Secrets Manager, or locally in `.env`: never in code, Terraform, logs or the browser. The coding agent never reads one.
4. Every order sits within limits you set, and a kill switch stops every bot and refuses every new order.
5. Every exchange call, order and sign-in goes in an add-only audit log.

The risks and their controls: [docs/threat-model.md](docs/threat-model.md). The risks accepted for speed: [guides/03-security-trade-offs.md](guides/03-security-trade-offs.md).

## What's inside

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | The rules every coding agent reads |
| [docs/](docs/) | The spec, features, decisions, threat model, costs and design system, with the first stage's [mockup](docs/mockups/mvp.html) |
| [apps/api/](apps/api/), [infra/aws/api/](infra/aws/api/) | The API on Lambda and its Terraform |
| [.github/workflows/](.github/workflows/) | App checks, security scans, and the Terraform plan and apply |
| [infra/aws/bootstrap/](infra/aws/bootstrap/) | One stack per AWS account, deployed by the owner: GitHub sign-in, the deploy roles, the state bucket and a budget alert |
| [scripts/](scripts/) | Setup for a fresh clone, repo protection and PR findings |
| [guides/](guides/) | The template's guides to the workflow, the files and the guardrails |

## Run it

Locally, on `127.0.0.1` only. Once per clone:

```bash
bash scripts/setup.sh
```

```bash
cd apps/desk && npm ci && cd ../..
```

Copy `.env.example` to `.env`. For made-up figures and a pretend exchange, set `DEMO=1`; for your account, add a Binance key that can read and trade spot only, with no withdrawal, restricted to your IP address.

Then, in two terminals from the repo root:

```bash
uv run python -m api.local
```

```bash
cd apps/desk && npm run dev
```

Open http://127.0.0.1:5173. Set your per-order and daily limits on the Trade terminal before it will trade. Every call to Binance, every order and every settings change is logged in `local/audit.jsonl`; smart trades and limits are kept in `local/desk.sqlite`. Deploys come later, through the pipeline, once it works locally and the AWS account is bootstrapped ([guides/01-using-the-template.md](guides/01-using-the-template.md), section 2).

Report a vulnerability through [SECURITY.md](SECURITY.md). [MIT licence](LICENSE).
