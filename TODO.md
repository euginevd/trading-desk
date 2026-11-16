# To do

Your requirements, features and ideas, numbered, in your own words. In `production` the agent confirms with you before starting one; a `prototype`'s agent just starts it. Either way it adds it to [features.md](docs/features.md) and any rule it needs to [spec.md](docs/spec.md), and removes it when done.

1. Trading desk page 1: the current state of my crypto portfolio, fetched from Binance. That's it. *(Built: features 1 and 7. Done once your first live run works.)*
2. Page 2: the ability to smart trade, like 3Commas. Look up what features they offer. *(Built: features 2 to 6 and 9 to 11. Done once your first live trades work.)*
3. Redesign the project to match my brief and mockup (`local/project-brief.md`, `local/trading-desk-mockup.html`): an AI-native crypto trading desk in local Docker. Portfolio tab with Binance and my TAO wallet; Trading tab with a watchlist, an AI signal per coin (price, indicators, news and sentiment in; buy now or not, reason and confidence out), and limit buy and sell orders on Binance spot. Keys encrypted, spot only, withdrawals never on, IP-whitelisted, nothing exposed. *(Built: features 12 to 26, decisions 14 to 19. Done once your first live run with your Binance, Taostats and Anthropic keys works.)*
4. Cheaper on the API key: fewer web searches, lower effort for routine re-runs, prompt caching, and a count of runs this month. *(Built: the subscription switch, feature 53, and the model choice, decision 53.)*

5. Rebuild the Profile as my Investment Policy Statement (`local/updates/claude-code-prompt-profile.md`): typed and versioned, a command bar, a pre-trade check, a scorecard, a what-if, a weekly recap; agents as a team of five; a Dashboard refresh; a clearer Settings. *(Built: features 61 to 64, decisions 58 and 59. Done once your profile.md is in as v1 and the first Sunday recap arrives.)*
6. A trading agent with its own versioned profile (persona, style, brief, steps, models, autonomy), and a complete AI-first redesign of the Trade page: press Analyse and the agent works step by step through my goals, rules, holdings, this month's cash, macro, events, technicals and DCA, then proposes an order. Manual now, automatic later. *(Built: feature 65, decision 60. Done once your first live Analyse runs and you've asked Claude Code to set your agent's trade.md.)*
7. Profile page: everything collapsed and read-only; a Show Profile button that renders my profile.md nicely, like Claude Code shows a .md file. I change the files by asking Claude Code, never by hand. Same for the trading agent, as trade.md. Next: a dashboard on the Profile page, designed by me. *(Built: feature 66, decision 61. The dashboard waits for my design.)*

Later, from the project ideas doc, not started until listed above:

- Bybit and leverage.
- Decentralised exchange (DEX) leverage.
- DeFi.
- The same control plane as travel-claims, once an agent or a bot makes decisions.
- After three months of use: decide on commercialising it (decision 6).
