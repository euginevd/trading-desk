# Screens in detail

The detail behind [design-system.md](../design-system.md) 18 to 20, as built in `apps/desk/src/`.

## Balances

Locale: Australian English. Values in US dollars, as the exchange quotes them, with the total also in Australian dollars. Money shows 2 decimal places, except the Dashboard's balances table, kept sleek: values and profit in whole dollars, prices with none from $100, 2 from $1 and 3 significant digits below, and each amount to the fewest places whose last digit is worth $25 or less (BTC 4, ETH 2, TAO 1, PUMP none); an average cost from only part of a holding is underlined, its share on hover; the source filter shows no counts. Columns: Coin with its amount under it, Value, PnL with its percent under it, 24h, Price, Avg cost. Coin (A to Z first), Value, PnL (by percent) and 24h sort on a click of their plain-text header, by value until one is clicked, with empty figures last. The balances table has no Source column; a wallet holding carries a small `Wallet` tag after its coin. Elsewhere a coin amount shows up to 8, with trailing zeros dropped.

## Shell

From `App.tsx`. A side panel, 232px, folds to a 64px icon strip (remembered per browser) by a round chevron on its edge, after Taostats, and slides in from a menu button on phones; the current page is a lifted row with its icon in `accent`. The frame, rail and top bar stay put while the page scrolls; a 14px band of the field covers what scrolls above them (decision 77). It holds the logo; Dashboard, Portfolio, Journal, Trade, Risk and Bots; a rule; Profile and Settings; and at its foot the Binance and Wallet pills (each opens the Portfolio filtered to that source) and the kill switch as a switch, always in view (spec 10). A pill leads with a logo (BNB's for Binance, TAO's for the wallet) and ends with its status dot, a badge on the icon when folded. A slim 56px header carries BTC (a link to Trade), BTC dominance with its 24-hour move in points, market cap and Fear & Greed (opening its details), then the total (a link to the Portfolio, with BTC or AUD under it) and the currency menu (AUD, USD, INR, BTC; one without a rate is disabled).

## Screens

As built in `apps/desk/src/`; each page's language is in [pages.md](pages.md).

- Dashboard (`Coach.tsx`): the day as a sentence with when it was fetched and Refresh, this month's deposits against the cap in one line, then the Weekly DCA section (13j). Watch today, Ask the desk and the weekly recap are off until the agents run (TODO 10).
- Trade (`PotPage.tsx`) is the Trading account: money first (available, in trades, value, this month) with the risk rules in a line; the market today and Scan now; Waiting for you, what trading-agent proposes; the trades in tabs (Positions, Orders, History, Stats, Ledger, with CSV); the watchlist as coin cards at the foot. Placing a trade opens a review dialog listing its orders.
- Bots (`BotsHome.tsx`): three tabs, each a link: Accumulation (the DCA book, `#/dca-book`), Opportunities (the short-term DCA bots, on a budget of their own) and Grid bots. A bot tab says what its bots are doing in a sentence, then Running, Stopped and Coins, each bot a block of figures and actions; a bot's own page and setup come from its type's code.
- Destructive actions (cancel an order) are red, set apart from the safe ones, and confirmed in a dialog whose default is to keep.
