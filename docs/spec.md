# Spec

`trading-desk`: an AI-native crypto trading desk. One place shows what the owner holds on Binance and in their TAO wallet, gives an AI buy signal for each coin they watch, and places spot limit orders on Binance. A `prototype`'s agent changes this file itself and says so ([AGENTS.md](../AGENTS.md) rules 12 and 23). New requirements start in [TODO.md](../TODO.md); the agent adds each to [features.md](features.md) and any rule, limit or done-when it needs here. What each feature does is its row in `features.md`, not a line here.

## Business

Who the business is, unnumbered so the spec's numbers stay put. The same for every project for this business: change it only when the business changes, and copy it into the next project's spec.

- Business: ArcVault AI, an Australian AI and security consultancy. This is one of its portfolio projects, and its owner's own trading tool.
- Size: one person, who is the owner, the developer and the only user. A few trades a day at most.
- Regulators and laws: none while it trades only its owner's money. Trading for anyone else would need an Australian financial services licence and AUSTRAC registration, so commercialising starts with legal advice (decision 6). An AI signal shown to anyone else could count as financial advice, so the same advice comes first.
- Data: no customer data. The owner's balances, trades, watchlist and keys stay on the owner's own machine. The AI plan sends Anthropic a coin's computed figures and the owner's position in it (amount, average cost, PnL, share, cash, open orders' prices), never keys, account ids or order ids (decision 46).
- Risk appetite: none for losing funds through the software: no key can withdraw (spec 10), and nothing places an order the owner didn't confirm, or a bot the owner didn't switch on. Low for showing balances to anyone else. Changes run locally only (decision 14).
- Systems: Binance is the system of record for balances, orders and trades; Taostats for the TAO wallet; this keeps an audit log. The AI signal comes from Claude through the Anthropic API. The Australian dollar rate comes from the European Central Bank's daily rates (Frankfurter). No payments.
- People: the owner owns the trading rules and limits, and approves any new exchange, key permission or data flow.
- Tone: plain Australian English, figures first, no trading hype.

## Project

Profile: `prototype`, with two limits of its own on top (decisions 1 and 2): the agent never reads a key, and orders are placed only by the owner, after a confirm step, or by a DCA or grid bot the owner switched on, within their limits (decisions 8, 18, 37 and 38).

Repo: `personal`, public (decision 5).

1. Name: `trading-desk`
2. Problem: the owner's holdings sit on Binance and in a TAO wallet, each with its own screens, and deciding when to buy means reading charts, indicators and news in several places.
3. Goal: one screen shows everything held, one screen shows a reasoned buy signal for each coin watched, and an order goes from the same screen, inside the same controls.
4. Users: the owner, alone, for now. Later, friends trying it for free, then an open-source release, each a new decision first (decision 6).
5. Where it runs: the owner's machine, in Docker, on `127.0.0.1` only. Hosting is decided later (decision 14).

## Stack

Template defaults: GitHub Actions, the pre-push scan and the PR security checks. No cloud resources for now; the AWS bootstrap stays for when hosting comes back.

6. Two apps in one `docker compose` (decisions 4 and 14):
   - `api`: Python. It reads Binance and Taostats, works out indicators, asks Claude for signals, places the owner's orders, and keeps the watchlist, limits, kill switch and smart trades in SQLite and the audit log in a file, both in `local/`. It's the only thing that holds a key.
   - `desk`: React, Vite and TypeScript, served by the `desk` container. Two pages: Portfolio and Trade (decision 19).
   - Keys come from `.env`, put there by the owner (decision 2).

## Done when

7. `GET /health` returns `{"status": "ok"}`.
8. The MVP: `docker compose up`, then the owner opens the desk and sees their Binance spot balances and TAO free and staked balance, each holding's value and the total, and open orders, no older than five minutes; keeps a watchlist of up to 10 coins, each with an AI signal (Buy now, Wait or Avoid, a confidence and the reasons); places and cancels spot limit buys and sells within their limits; and finds every exchange call, signal and order in the audit log. Orders are tested live, within the owner's limits (decision 12). The owner then uses it for three months before deciding on anything else (decision 6).

## Rules

9. `/health` returns nothing from the request. Both containers publish on `127.0.0.1` only, and nothing is reachable from another machine; sign-in comes with hosting (decision 10).
10. The limits that hold whatever else changes:
    - Keys: one per service and per purpose, with only the permissions it needs. Binance's reads and trades spot only, never withdrawal, margin or futures, and is limited to the owner's IP address. The TAO wallet is read by its public address only. A key lives only in `.env`, put there by the owner: never in code, a log, a PR, the browser or a prompt.
    - Money: spot limit orders only. An order goes only from the owner's order form, after a confirm step, or from a DCA or grid bot the owner switched on, after a confirm stating the orders it may place (decisions 37 and 38). Every order stays within limits the owner sets (per order and per day, zero until set; bot buys count towards the day), checked in code, and only while the kill switch is on; turning it off stops every bot, cancels their open buys and refuses every new order.
    - AI: the plan advises and never acts. Its output is checked against a schema built for each call and held to the owner's risk rules in code; it can't place, change or cancel an order (its buttons only fill the form), and sees the owner's position in the coin but never keys, account ids or order ids (decisions 16 and 46).
    - Audit log: every exchange call, AI signal, order, bot action and settings change is recorded with its time, who or what asked, and the result. Entries are added, never edited or deleted.
    - Monthly spend: $20 of Anthropic API, checked in code; no cloud spend. Security baseline: OWASP ASVS 5.0 Level 1, with the limits above on top.

## Not for now

11. Hosting, sign-in and other users; Bybit and leverage, decentralised exchange (DEX) leverage and DeFi, waiting in [TODO.md](../TODO.md); an AI agent that builds, backtests or runs strategies (the brief's later direction); market orders on the Trade page; other wallets and exchanges; billing, tax reports, price alerts and a phone app.
