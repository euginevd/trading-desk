# Screens in detail

The detail behind [design-system.md](../design-system.md) 18 to 20, as built in `apps/desk/src/`.

## Balances

Locale: Australian English. Values in US dollars, as the exchange quotes them, with the total also in Australian dollars. Money shows 2 decimal places, except the Dashboard's balances table, kept sleek: values and profit in whole dollars, prices with none from $100, 2 from $1 and 3 significant digits below, and each amount to the fewest places whose last digit is worth $25 or less (BTC 4, ETH 2, TAO 1, PUMP none); an average cost from only part of a holding is underlined, its share on hover; the source filter shows no counts. Columns: Coin with its amount under it, Value, PnL with its percent under it, 24h, Price, Avg cost. Coin (A to Z first), Value, PnL (by percent) and 24h sort on a click of their plain-text header, by value until one is clicked, with empty figures last. The balances table has no Source column; a wallet holding carries a small `Wallet` tag after its coin. Elsewhere a coin amount shows up to 8, with trailing zeros dropped.

## Shell

Shell: a side panel, 232px, that folds to a 64px icon strip (remembered per browser) by a round chevron button on its edge, after Taostats; the current page has an `accent` bar at the panel's edge and slides in from a menu button on phones. It holds the logo, Dashboard and Trade, a Bots section (DCA Bot, Grid Bot), and at its foot the Binance and Wallet pills and the kill switch (Trading on or off), always in view (spec 10). A slim 56px header holds BTC, BTC dominance and market cap with their 24-hour change, the total, and the currency toggle (decisions 42 and 44). On the Dashboard a filter (All, Binance, Wallet, no counts) sets which holdings the total, allocation, profit and table cover. In the middle column, Allocation sits above PnL (two stacked cards, like the total and accounts on the left); the allocation lists every coin held or, by a By coin / By wallet switch, the split between Binance and the wallet (dust excluded, shares of what is shown, the five largest in their own colours), a PnL card shows the unrealised total and percent, a row per account (Binance, Wallet), and a foot with the best and worst coin by PnL percent and the total invested. An average cost the owner entered shows as an accent dotted link to change it; a holding with no cost offers "Add cost". The side panel's status pills lead with a logo or icon (Binance, the TAO logo for Wallet, a power icon for trading) and end with the status dot, a badge on the icon when folded. The Trade page's watchlist is resizable by a grip on its edge (drag, arrow keys, double-click to reset, remembered per browser), and the order form, limits and orders sit under the chart, side by side where they fit, so the chart gets the width.

## Screens

Screens, as built in `apps/desk/src/`:
    - Dashboard: eight compact widgets, four a row (total, accounts, PnL, Fear & Greed, allocation, deposits, top movers, AI signals), each opening a draggable details panel in place; then Balances and Open orders tabs.
    - DCA Bot and Grid Bot: a Create bot menu of watchlist coins, a table (Active or Stopped; pair and reference, started, settings, budget, realised and unrealised PnL, actions), and a page per bot: settings on the left, a Lightweight Charts candle chart with the bot's levels on the right, PnL tiles, then Live and History. The wizard fills from a 30-day preset with a reason in accent under each field.
    - Destructive actions (cancel an order) are red, set apart from the safe ones, and confirmed in a dialog whose default is to keep.
    - Trade watchlist: the list's name as the header, opening a menu to switch lists, edit the list, start a new one or delete it; Analyse all beside it. The add-coin box and each coin's ✕ show only while editing, closed by Done.
    - Trade order form: Limit buy or Limit sell, then for a buy One buy or Ladder (top, bottom, buys, total, Equal or More lower, a rung table). The chart bar has Hide chart and Reset chart.
    - Trade: three columns, the watchlist (260px), the chart and analysis, and the order form (320px), stacking to one column under 1100px.
