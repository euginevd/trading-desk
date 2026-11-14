# To do

Your requirements, features and ideas, numbered, in your own words. In `production` the agent confirms with you before starting one; a `prototype`'s agent just starts it. Either way it adds it to [features.md](docs/features.md) and any rule it needs to [spec.md](docs/spec.md), and removes it when done.

1. Trading desk page 1: the current state of my crypto portfolio, fetched from Binance. That's it. *(Built: features 1 and 7. Done once your first live run works.)*
2. Page 2: the ability to smart trade, like 3Commas. Look up what features they offer. *(Built: features 2 to 6 and 9 to 11. Done once your first live trades work.)*
3. Redesign the project to match my brief and mockup (`local/project-brief.md`, `local/trading-desk-mockup.html`): an AI-native crypto trading desk in local Docker. Portfolio tab with Binance and my TAO wallet; Trading tab with a watchlist, an AI signal per coin (price, indicators, news and sentiment in; buy now or not, reason and confidence out), and limit buy and sell orders on Binance spot. Keys encrypted, spot only, withdrawals never on, IP-whitelisted, nothing exposed. *(Built: features 12 to 26, decisions 14 to 19. Done once your first live run with your Binance, Taostats and Anthropic keys works.)*
4. AI provider switch: "API key (pay per use)" or "Claude subscription (personal use)" through the Claude Agent SDK with `CLAUDE_CODE_OAUTH_TOKEN`, as in my spec (one AI client interface, mode read at call time, the API key stripped from the subscription's environment, the auth source logged and shown, plan-limit messages, an optional fall back to the API key). *On hold before building:* Anthropic's docs say apps built on the Agent SDK should use an API key, and they enforce that without notice (code.claude.com/docs/en/legal-and-compliance, Agent SDK overview); confirm with Anthropic that personal use is allowed first. Meanwhile, cheaper on the API key: pick Opus 5.5, Sonnet 5.5 or Haiku 5.5 per run (the panel says which answered), fewer web searches, lower effort for routine re-runs, prompt caching, and a count of runs this month.

Later, from the project ideas doc, not started until listed above:

- Bybit and leverage.
- Decentralised exchange (DEX) leverage.
- DeFi.
- The same control plane as travel-claims, once an agent or a bot makes decisions.
- After three months of use: decide on commercialising it (decision 6).
