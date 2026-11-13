# Spec

`trading-desk`: a personal trading desk, one dashboard that links out to each trading product, starting with a read-only view of a Binance account. A `prototype`'s agent changes this file itself and says so ([AGENTS.md](../AGENTS.md) rules 12 and 23). New requirements start in [TODO.md](../TODO.md); the agent adds each to [features.md](features.md) and any rule, limit or done-when it needs here. What each feature does is its row in `features.md`, not a line here.

## Business

Who the business is, unnumbered so the spec's numbers stay put. The same for every project for this business: change it only when the business changes, and copy it into the next project's spec.

- Business: ArcVault AI, an Australian AI and security consultancy. This is one of its portfolio projects, and its owner's own trading tool.
- Size: one person, who is the owner, the developer and the only user. A few trades a day at most.
- Regulators and laws: none while it trades only its owner's money. Trading for anyone else would need an Australian financial services licence and AUSTRAC registration, so commercialising starts with legal advice (decision 6).
- Data: no customer data. The owner's balances, trades and exchange keys stay in AWS in Sydney.
- Risk appetite: none for losing funds through the software: no key can withdraw (spec 10), and nothing places an order the owner didn't ask for or set up. Low for showing balances to anyone else. Changes ship to `dev`, the only environment (decision 1).
- Systems: the exchange is the system of record for balances, orders and trades; this keeps a copy and an audit log. Sign-in is Amazon Cognito. No payments.
- People: the owner owns the trading rules and limits, and approves any new exchange, key permission or data flow.
- Tone: plain Australian English, figures first, no trading hype.

## Project

Profile: `prototype`, with two limits of its own on top (decisions 1 and 2): the agent never reads an exchange key, and nothing places a real order until a new decision says so.

1. Name: `trading-desk`
2. Problem: the owner's holdings, orders and bots sit in separate exchange apps, each with its own screens and its own idea of profit, so there's no single view of what's held, what it's worth and what's running.
3. Goal: one sign-in shows everything held and everything running, and each later stage adds a way to act on it from the same place, with the same controls.
4. Users: the owner, alone. They sign in, read the portfolio and, in later stages, place trades, run bots and stop them.
5. AWS: one account, `ap-southeast-2`, `dev` only. The pipeline deploys `dev` on merge.

## Stack

Template defaults: GitHub Actions, Terraform on AWS, the pre-push scan and the PR security checks.

6. Two apps (decisions 3 and 4):
   - `api`: Python on Lambda behind an HTTP API. It reads the exchange, keeps the snapshots and the audit log in DynamoDB, and is the only thing that holds an exchange key.
   - `desk`: React, Vite and TypeScript on S3 and CloudFront, with Cognito sign-in. The dashboard and each product's screens.

## Done when

7. `GET /health` returns `{"status": "ok"}`.
8. The MVP: the owner signs in on `dev` and sees their Binance spot balances, each holding's value and the total, open orders and recent trades, no older than five minutes, and every read of the exchange is in the audit log. The owner then uses it for three months before deciding on anything commercial.

## Rules

9. `/health` is public and returns nothing from the request. Every other route needs the owner's sign-in.
10. The limits that hold whatever else changes:
    - Exchange keys: one per exchange and per purpose, never with withdrawal permission, and limited to this project's fixed IP address before one can trade. A key lives only in Secrets Manager, put there by the owner: never in code, Terraform, state, a log, a PR or the browser.
    - Money: the MVP's key is read-only, so it can't trade. A later stage trades only within limits the owner sets (per order and per day), checked in code, and only while the kill switch is on; turning it off stops every bot and refuses every new order.
    - Audit log: every exchange call, order, bot action, sign-in and settings change is recorded with its time, who or what asked, and the result. Entries are added, never edited or deleted.
    - Monthly spend: $50 of AWS. Security baseline: OWASP ASVS 5.0 Level 1, with the limits above on top.

## Not for now

11. Everything past Binance visibility: manual trades, Dollar Cost Averaging (DCA) bots, grid bots, Bybit and leverage, decentralised exchange (DEX) leverage and DeFi, waiting in [TODO.md](../TODO.md) in that order. Also other users, sign-up, billing, tax reports, price alerts, a phone app, and any AI agent that decides trades.
