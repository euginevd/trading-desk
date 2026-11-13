# trading-desk

A personal trading desk: one dashboard that links out to each trading product, with the same controls behind all of them. It starts as a read-only view of a Binance account and grows a stage at a time.

Built from [sdlc-template](https://github.com/euginevd/sdlc-template): a coding agent works to the numbered rules in [AGENTS.md](AGENTS.md), and a pipeline scans, plans and deploys to AWS. It's a prototype for its owner's own use, not financial advice and not a service.

## Status

Kickoff is done and nothing is deployed yet. The repo holds the template's starter, a Lambda with a `/health` route and its Terraform, and the docs for the first stage.

| Stage | What it adds | Status |
|---|---|---|
| 1 | Binance visibility: balances, value, open orders, recent trades and an audit log | Next |
| 2 | Manual trades | Later |
| 3 | Dollar Cost Averaging (DCA) bots | Later |
| 4 | Grid bots | Later |
| 5 | Bybit and leverage | Later |
| 6 | Decentralised exchange (DEX) leverage | Later |
| 7 | DeFi | Later |

The plan is to use the first stage for three months before deciding what comes next.

## Security

The limits every stage keeps ([spec](docs/spec.md) 10):

1. One key per exchange and per purpose, never with withdrawal permission.
2. A key that can trade works only from this project's fixed IP address.
3. Keys live in AWS Secrets Manager and nowhere else: not in code, Terraform, logs or the browser. The coding agent never reads one.
4. A kill switch stops every bot and refuses every new order.
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

```bash
bash scripts/setup.sh
```

```bash
uv run pytest
```

`setup.sh` installs the scanners, uv, Terraform and the push hook. It runs locally first. Deploys go through the pipeline only, once it works locally and the AWS account is bootstrapped ([guides/01-using-the-template.md](guides/01-using-the-template.md), section 2).

Report a vulnerability through [SECURITY.md](SECURITY.md). [MIT licence](LICENSE).
