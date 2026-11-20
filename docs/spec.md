# Spec

`trading-desk`: an AI-native crypto trading desk. One place shows what the owner holds on Binance and in their TAO wallet, gives an AI buy signal for each coin they watch, and places spot orders on Binance. The agent keeps it current ([AGENTS.md](../AGENTS.md) rule 23). Requirements start in [TODO.md](../TODO.md); what each feature does is its row in [features.md](features.md).

## Business

Unnumbered; the same for every project of this business.

- Business: ArcVault AI, an Australian AI and security consultancy. This is one of its portfolio projects, and its owner's own trading tool.
- Size: one person, the owner, developer and only user. A few trades a day; plain Australian English, figures first.
- Regulators and laws: none while it trades only its owner's money. Trading for others would need an Australian financial services licence and AUSTRAC registration, so commercialising starts with legal advice (decision 6). An AI signal shown to others could count as financial advice too.
- Data: no customer data. The owner's data and keys stay on their own machine. The AI features send Anthropic computed figures, the owner's position, Profile, agent profile and a coin's tax lots, never keys, wallet addresses or ids (decisions 46, 58 and 60).
- Risk appetite: none for losing funds through the software (no key can withdraw; no order the owner didn't confirm or switch on); low for showing balances to others.
- Systems: Binance is the system of record for balances, orders and trades; Taostats for the TAO wallet; this keeps an audit log. The AI plan comes from Claude, by API key or the owner's subscription (decision 48). The AUD rate is CoinGecko's live USDT price, the ECB's daily rate (Frankfurter) its fallback (decision 29). No payments.
- People: the owner sets the trading rules and limits, and approves any new exchange, key permission or data flow.

## Project

Profile: `prototype`, plus two limits (decisions 1 and 2): the agent never reads a key, and orders come only as spec 10 allows.

Repo: `personal`, public (decision 5).

1. Name: `trading-desk`
2. Problem: the owner's holdings sit on Binance and in a TAO wallet; deciding when to buy means reading charts, indicators and news apart.
3. Goal: one screen shows everything held, one shows a reasoned call for each coin watched, and an order goes from there, inside the same controls.
4. Users: the owner, alone, for now. Later, friends trying it for free, then an open-source release, each a new decision first (decision 6).
5. Where it runs: the owner's machine, in Docker, on `127.0.0.1` only, until hosting is decided (decision 14).

## Stack

Template defaults: GitHub Actions, the pre-push scan and the PR security checks. No cloud resources for now.

6. Two apps in one `docker compose` (decisions 4 and 14):
   - `api`: Python. It reads Binance and Taostats, asks Claude, places orders and runs the bots and agents, keeping SQLite and the audit log in `local/`; only it holds a key.
   - `desk`: React, Vite and TypeScript: Dashboard, Portfolio, Journal, Trading account (Trade), Risk, Bots (Accumulation, Opportunities, Grid bots), Profile (with My agents) and Settings. Settings › Pages switches each page and feature on or off (decision 85): off hides it and skips loading it, and never stops an order, bot, check or agent; Dashboard and Settings are always on; features added later arrive off.
   - Keys come from `.env`, put there by the owner (decision 2).

## Done when

7. `GET /health` returns `{"status": "ok"}`.
8. The MVP: after `docker compose up`, the owner sees their Binance spot and TAO balances, values, total and open orders, no older than five minutes; keeps watchlists of up to 10 coins, each with an AI plan; places and cancels spot limit orders within their limits; and finds every exchange call, plan and order in the audit log. Orders are tested live, within the owner's limits (decision 12); then three months' use before anything else (decision 6).

## Rules

9. `/health` returns nothing from the request. Only the desk is published, on `127.0.0.1`, unreachable from other machines; sign-in comes with hosting (decision 10).
10. The limits that hold whatever else changes:
    - Keys: one per service and purpose, least privilege; Binance's trades spot only (no withdrawal, margin or futures), from the owner's IP address. The TAO wallet is read by its public address. A key lives only in `.env`, never in code, a log, a PR or a prompt; only Claude's pass the browser, inbound once (decision 51).
    - Money: spot limit orders; market orders only for DCA book orders (the Monday close-out's buy, or the owner's) and trade closes (decisions 72 and 73). Orders come only from the owner's order form, after a confirm; a DCA or grid bot the owner switched on, after confirming the orders it may place (decisions 37 and 38); or a one-use Telegram button from the owner's linked chat, rerunning the desk's checks (decision 74). Every order stays within the owner's per-order and daily limits (zero until set; bot buys count), checked in code, and only while the kill switch is on; off, it stops every bot, cancels their open buys and refuses every new order. A buy breaking a set Profile rule needs the owner's second confirm, logged; a bot's waits (decision 58).
    - AI: the plan advises and never acts. Its output is checked against a per-call schema and held to the owner's risk rules in code; it can't place, change or cancel an order (its buttons only fill the form), and sees the owner's position in the coin but never keys, account ids or order ids (decisions 16 and 46).
    - Audit log: every exchange call, AI plan, order, bot action and settings change, with its time, who asked and the result; append-only.
    - Monthly spend: $20 of Anthropic API, checked in code. Security baseline: OWASP ASVS 5.0 Level 1, with the limits above on top.

## Not for now

11. Hosting, sign-in and other users; Bybit and leverage, decentralised exchange (DEX) leverage and DeFi, waiting in [TODO.md](../TODO.md); an AI agent that builds, backtests or runs strategies; other wallets and exchanges; billing, tax reports, alerts off the desk beyond Telegram (decisions 57 and 74), and a phone app.
