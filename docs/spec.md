# Spec

`trading-desk`: a personal trading desk, one dashboard that links out to each trading product, starting with a dashboard and spot trade terminal for a Binance account. A `prototype`'s agent changes this file itself and says so ([AGENTS.md](../AGENTS.md) rules 12 and 23). New requirements start in [TODO.md](../TODO.md); the agent adds each to [features.md](features.md) and any rule, limit or done-when it needs here. What each feature does is its row in `features.md`, not a line here.

## Business

Who the business is, unnumbered so the spec's numbers stay put. The same for every project for this business: change it only when the business changes, and copy it into the next project's spec.

- Business: ArcVault AI, an Australian AI and security consultancy. This is one of its portfolio projects, and its owner's own trading tool.
- Size: one person, who is the owner, the developer and the only user. A few trades a day at most.
- Regulators and laws: none while it trades only its owner's money. Trading for anyone else would need an Australian financial services licence and AUSTRAC registration, so commercialising starts with legal advice (decision 6).
- Data: no customer data. The owner's balances, trades and exchange keys stay in AWS in Sydney.
- Risk appetite: none for losing funds through the software: no key can withdraw (spec 10), and nothing places an order the owner didn't ask for or set up. Low for showing balances to anyone else. Changes ship to `dev`, the only environment (decision 1).
- Systems: the exchange is the system of record for balances, orders and trades; this keeps an audit log. The Australian dollar rate comes from the European Central Bank's daily rates (Frankfurter). Sign-in is Amazon Cognito on AWS. No payments.
- People: the owner owns the trading rules and limits, and approves any new exchange, key permission or data flow.
- Tone: plain Australian English, figures first, no trading hype.

## Project

Profile: `prototype`, with two limits of its own on top (decisions 1 and 2): the agent never reads an exchange key, and orders are placed only by the owner from the trade terminal, within their limits (decision 8).

Repo: `personal`, public (decision 5).

1. Name: `trading-desk`
2. Problem: the owner's holdings, orders and bots sit in separate exchange apps, each with its own screens and its own idea of profit, so there's no single view of what's held, what it's worth and what's running.
3. Goal: one sign-in shows everything held and everything running, and each later stage adds a way to act on it from the same place, with the same controls.
4. Users: the owner, alone. They sign in, read the portfolio, and place and cancel spot orders; in later stages they run bots and stop them.
5. Where it runs: locally first, until the owner is happy with it; then AWS, one account, `ap-southeast-2`, `dev` only, deployed by the pipeline on merge (decision 7).

## Stack

Template defaults: GitHub Actions, Terraform on AWS, the pre-push scan and the PR security checks.

6. Two apps (decisions 3 and 4):
   - `api`: Python on Lambda behind an HTTP API. It reads the exchange, places the owner's orders, keeps the audit log in DynamoDB, and is the only thing that holds an exchange key.
   - `desk`: React, Vite and TypeScript on S3 and CloudFront, with Cognito sign-in. Two pages so far: Dashboard (TODO 1) and Trade terminal (TODO 2).
   - Locally, one command each, the `api` on `127.0.0.1` with the key from `.env` and no sign-in (decision 10); stand-ins for Cognito, DynamoDB and Secrets Manager come when a feature needs them.

## Done when

7. `GET /health` returns `{"status": "ok"}`.
8. The MVP: the owner signs in, locally and then on `dev`, and sees their Binance spot balances, each holding's value and the total, open orders and recent trades, no older than five minutes; places and cancels spot market and limit orders within their limits; and finds every exchange call and order in the audit log. Orders are tested live, within the owner's limits (decision 12). The owner then uses it for three months before deciding on anything commercial.

## Rules

9. `/health` is public and returns nothing from the request. Every other route needs the owner's sign-in once it's on AWS (decision 10).
10. The limits that hold whatever else changes:
    - Exchange keys: one per exchange and per purpose, with only the permissions it needs (the MVP's: read and spot trading), never withdrawal, margin or futures, and limited to the IP address it calls from. A key lives only in Secrets Manager, or locally in `.env`, put there by the owner: never in code, Terraform, state, a log, a PR or the browser.
    - Money: spot only. An order goes only from the owner's trade terminal, after a confirm step, within limits the owner sets (per order and per day, zero until set), checked in code, and only while the kill switch is on; turning it off stops every bot and refuses every new order.
    - Audit log: every exchange call, order, bot action, sign-in and settings change is recorded with its time, who or what asked, and the result. Entries are added, never edited or deleted.
    - Monthly spend: $50 of AWS. Security baseline: OWASP ASVS 5.0 Level 1, with the limits above on top.

## Not for now

11. Everything past the spot terminal: Dollar Cost Averaging (DCA) bots, grid bots, Bybit and leverage, decentralised exchange (DEX) leverage and DeFi, waiting in [TODO.md](../TODO.md) in that order. Also other users, sign-up, billing, tax reports, price alerts, a phone app, and any AI agent that decides trades.
