# Known mistakes: Binance

Part of [known-mistakes.md](../known-mistakes.md); the numbers stay as cited.

29. Binance refuses the agent's cloud container (HTTP 451): test against recorded replies; the owner makes the first live run.
29a. A timed-out order call was treated as not placed: keep the row "placing", look it up by client id, and record a market sale before sending (decision 47).
29b. Binance order ids are unique per pair only: key them `PAIR:id`.
29c. Bot names are public: link a Telegram chat only by a one-time code.
29d. The pre-trade check first missed smart trades: list every route that sends a buy before adding a check.
29e. Changing an order cancelled it before checking the replacement: check the new order first, then cancel. Every route that buys, the Monday close-out included, goes through the kill switch and limits.
29f. Real plan and account figures went into public docs: write "the weekly plan" or "the account's balance"; amounts stay in `local/`.
29g. trading-agent judging a setup from its levels alone made up the trend ("above its 50-day" when it was 30% under): always pass it the screener's facts for the coin.
29h. A fill was saved as filled before a Binance read (pair rules) that could fail, leaving the trade waiting with no stop: do every Binance read before the first save of a sync step.
29i. The daily limit counted the pot's entries but not its adds: count spend by `side = 'buy'`, never by one role.
29j. An add skipped the pot's month-loss, stop-out and Bear rules a new trade meets: a buy that adds risk meets every rule a new trade does.
29k. The desk's Buy the rest had no week check while the Telegram button did, so a confirm just after Monday 7pm would buy next week's whole plan: a confirmed order action sends what the dialog showed (the week key) and the api refuses it if that changed, on every path.
29l. The close-out counted only `weekly` orders while the owner bought the week through Add funds: count a week's buys by `dca_book.WEEK_BUYS`, never by one button's source.
29m. A stop or target outside Binance's price band (PERCENT_PRICE_BY_SIDE: 0.8 to 2 times the price on NEARUSDC, and it applies to a stop's price too) had the OCO refused every 30 seconds for days: read the band from the pair's rules before sending, and never assume which leg was refused.
