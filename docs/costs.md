# Costs

What the MVP costs to run on the owner's machine, for one user. Approximate monthly figures in US dollars, from list prices. With no cloud, the check after a deploy (AGENTS.md rule 19) is the Anthropic Console's usage page instead of Cost Explorer.

## Resources

1. Docker on the owner's machine: nothing.
2. Binance API: nothing. Requests stay well inside Binance's weight limits: the portfolio on open and Refresh, prices every few seconds for up to 30 coins, the Trading account's watchlist (feature 91).
3. Anthropic API, the AI signal (decision 16): Claude Opus 5.5 at $4 a million tokens in and $20 out, plus web search at $10 a thousand searches. One signal reads about 15,000 tokens (the prompt, indicators and search results), writes about 1,500 and searches up to 3 times: about $0.12. Ten coins, each run twice a day, is about $72 a month; once a day, about $36. The 4-hour cache and the $20 cap (spec 10) keep it in bounds: past the cap, Re-run says so and the last signal stays. Cut it with fewer searches, Claude Sonnet 5.5 at half the price, or a cheaper pass that only re-runs a coin when its price has moved.
3a. The trading agent's Analyse (decision 60) replaces the signal: four Haiku 5.5 steps (about 5,000 tokens in and 700 out each, plus up to 3 searches) and an Opus 5.5 decision (about 12,000 in, 2,500 out) is about $0.13 a run, most of it the decision and the searches; bull against bear on Sonnet adds about $0.02. The page shows each run's own cost and an estimate on the agent profile; Analyse all is one Haiku call, under a cent.
3b. The agents (features 79 to 85), each call one Opus 5.5 run with no web search, about 10,000 tokens in and 1,500 out: about $0.07. trading-agent's daily scan (decision 74), about $2 a month; risk-agent's weekly review (its daily check is plain code), about $0.30; each message in the DCA book's or the Trading account's chat, each DCA analysis and each Analyse in New trade, about $0.07, so 30 a month is about $2. Scan now judges all four styles in turn (decision 88): four such calls, about $0.28 a press; a press a day adds about $8 a month, inside the AI cap.
4. Taostats API: nothing on its free plan, at one read on open and Refresh.
5. Market data, free with no key: Frankfurter (the ECB's daily rate), CoinGecko (the live USDT→AUD rate, logos, market size) and alternative.me (Fear & Greed).

The MVP: the Anthropic signal only, capped at $20 a month until the owner raises it.

## Budget and alerts

6. Anthropic: the cap in spec 10, checked in code against each response's token count, and a monthly spend limit set by the owner in the Anthropic Console as a backstop.
7. AWS: none while nothing is hosted. The bootstrap's budget alert (`BudgetEmail`, $50) stays in place for when hosting comes back (decision 14).
