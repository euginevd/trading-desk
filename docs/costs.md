# Costs

What the MVP costs to run on the owner's machine, for one user. Approximate monthly figures in US dollars, from list prices. With no cloud, the check after a deploy (AGENTS.md rule 19) is the Anthropic Console's usage page instead of Cost Explorer.

## Resources

1. Docker on the owner's machine: nothing.
2. Binance API: nothing. Requests stay well inside Binance's weight limits: the portfolio on open and Refresh, prices every few seconds for 10 coins at most.
3. Anthropic API, the AI signal (decision 16): Claude Opus 5.5 at $4 a million tokens in and $20 out, plus web search at $10 a thousand searches. One signal reads about 15,000 tokens (the prompt, indicators and search results), writes about 1,500 and searches up to 3 times: about $0.12. Ten coins, each run twice a day, is about $72 a month; once a day, about $36. The 4-hour cache and the $20 cap (spec 10) keep it in bounds: past the cap, Re-run says so and the last signal stays. Cut it with fewer searches, Claude Sonnet 5.5 at half the price, or a cheaper pass that only re-runs a coin when its price has moved.
4. Taostats API: nothing on its free plan, at one read on open and Refresh.
5. Frankfurter, the Australian dollar rate: nothing.

The MVP: the Anthropic signal only, capped at $20 a month until the owner raises it.

## Budget and alerts

6. Anthropic: the cap in spec 10, checked in code against each response's token count, and a monthly spend limit set by the owner in the Anthropic Console as a backstop.
7. AWS: none while nothing is hosted. The bootstrap's budget alert (`BudgetEmail`, $50) stays in place for when hosting comes back (decision 14).
