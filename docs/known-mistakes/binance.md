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
