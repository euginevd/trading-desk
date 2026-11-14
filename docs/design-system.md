# Design system

The desk's own look, from the owner's mockup (decision 15): a dark, dense trading screen after Hyperliquid, with one teal accent and figures first. The UI rules every project follows are in `code-standards.md` (25–29).

## Principles

1. Figures first: prices, values and changes are the largest, clearest things on a screen; labels are small and muted.
2. One accent, teal, for what's interactive, selected or suggested. Green and red mean up and down, buy and sell, and nothing else.
3. Dense but calm: hairline borders between panels, no shadows, no decoration. A trading screen fills the window; a reading screen sits in a 1320px column.
4. The AI advises in plain words: a verdict, a confidence and its reasons, never a badge or a sparkle.

## Tokens

Colours, dark only. Defined on `:root`, with `body` given `bg` explicitly.

| Token | Value | Use |
|-------|-------|-----|
| `bg` | `#0A0F12` | Page, and the panels of the Trade page |
| `bar` | `#0B1215` | Top bar |
| `panel` | `#0F171B` | Cards, inputs, the selected watchlist row |
| `panel-2` | `#131D22` | Buttons, coin marks, hovers |
| `line` / `line-2` | `#1B272D` / `#24333A` | Dividers and card borders / input and button borders |
| `text` | `#E6ECEF` | Figures, headings, primary text |
| `muted` | `#8C9AA3` | Labels and secondary text |
| `dim` | `#5E6C74` | Placeholders, axes and notes; never essential text |
| `accent` / `accent-ink` | `#50D2C1` / `#04110F` | Primary action, selection, focus, the suggested level / text on accent |
| `up` / `down` | `#2EBD85` / `#F0616D` | Gains and buys / losses and sells, each with a 12% tint for tags |
| `wait` | `#E8B04B` | The Wait verdict and caution states, with a 12% tint |

5. Type: Inter (400, 500, 600, 700) for everything, with tabular figures (`tnum`) on every number. Body 13px, labels 11 to 12px, a pair 18px, page titles and the total 30px at 500 weight and −0.02em.
6. Space: 4px base. Cards pad 14 to 16px; table cells 11px by 16px; gaps between cards 10px.
7. Radius: 5px tags, 6 to 8px buttons and inputs, 10px cards and the verdict.
8. Depth: hairline borders only. No shadows, except a dialog over the page.

## Motion

9. 120ms for hover and press, 200ms for tabs and dialogs. Animate only `transform` and `opacity`, and respect reduced motion.
10. Prices update in place; a change flashes its tint for 400ms at most. Nothing loops or scrolls on its own.

## Components

11. Button (secondary on `panel-2`, primary on `accent`, buy on `up`, sell on `down`), Input with a unit on the right, segmented Buy/Sell, Tabs with an accent underline, Table, Tag (Buy, Sell, Buy now, Wait, Avoid), Pill (connection and kill switch), Card, Dialog for the confirm step, Toast and Skeleton. Anything new is built from these and added here once settled.
12. One primary button per view: Connect exchange on Portfolio, the order button on Trade.
13. Coin mark: a 24px circle on `panel-2` with the symbol in 9px; no logos.

## Not this

14. Gradients other than the faint fill under a line chart, glassmorphism and glows.
15. Emoji, sparkle icons and "AI-powered" badges.
16. Light theme, for now.

## Words

17. Plain and specific, in sentence case. Buttons say what happens ("Review limit buy SOL"); errors say what to do next. The signal's verdicts are exactly Buy now, Wait and Avoid.

## This project

18. Locale: Australian English. Values in US dollars, as the exchange quotes them, with the total also in Australian dollars. Dates as 13 Nov 2026, times in 24-hour Sydney time. Money shows 2 decimal places, except the Dashboard's balances table, kept sleek: values and profit in whole dollars, prices with none from $100, 2 from $1 and 3 significant digits below, and each amount to the fewest places whose last digit is worth $25 or less (BTC 4, ETH 2, TAO 1, PUMP none); an average cost from only part of a holding is underlined, its share on hover; the source filter shows no counts. Columns: Coin with its amount under it, Value, PnL with its percent under it, 24h, Price, Avg cost. Coin (A to Z first), Value, PnL (by percent) and 24h sort on a click of their plain-text header, by value until one is clicked, with empty figures last. The balances table has no Source column; a wallet holding carries a small `Wallet` tag after its coin. Elsewhere a coin amount shows up to 8, with trailing zeros dropped.
19. Shell: a side panel, 232px, that folds to a 64px icon strip (remembered per browser) by a round chevron button on its edge, after Taostats; the current page has an `accent` bar at the panel's edge and slides in from a menu button on phones. It holds the logo, Dashboard and Trade, a Bots section (DCA Bot, Grid Bot), and at its foot the Binance and Wallet pills and the kill switch (Trading on or off), always in view (spec 10). A slim 56px top bar holds the BTC, ETH and TAO tickers. The Dashboard's money follows a currency switch (AUD, USD, INR, BTC; decision 30) on the right of the filter row, the total alone (the US-dollar line and rate under it are kept in code, hidden); a filter (All, Binance, Wallet, no counts) sets which holdings the total, allocation, profit and table cover. In the middle column, Allocation sits above PnL (two stacked cards, like the total and accounts on the left); the allocation lists every coin held or, by a By coin / By wallet switch, the split between Binance and the wallet (dust excluded, shares of what is shown, the five largest in their own colours), a PnL card shows the unrealised total and percent, a row per account (Binance, Wallet), and a foot with the best and worst coin by PnL percent and the total invested. An average cost the owner entered shows as an accent dotted link to change it; a holding with no cost offers "Add cost". The side panel's status pills lead with a logo or icon (Binance, the TAO logo for Wallet, a power icon for trading) and end with the status dot, a badge on the icon when folded. The Trade page's watchlist is resizable by a grip on its edge (drag, arrow keys, double-click to reset, remembered per browser), and the order form, limits and orders sit under the chart, side by side where they fit, so the chart gets the width.
20. Screens, as built in `apps/desk/src/`:
    - Portfolio: the title with Refresh, Add wallet and Connect exchange; three cards (total value and the sources, allocation, 30-day account value); then Balances and Open orders tabs.
    - DCA Bot and Grid Bot: a Create bot menu of watchlist coins, a table (Active or Stopped; pair and reference, started, settings, budget, realised and unrealised PnL, actions), and a page per bot: settings on the left, a Lightweight Charts candle chart with the bot's levels on the right, PnL tiles, then Live and History. The wizard fills from a 30-day preset with a reason in accent under each field.
    - Destructive actions (cancel an order) are red, set apart from the safe ones, and confirmed in a dialog whose default is to keep.
    - Trade watchlist: the list's name as the header, opening a menu to switch lists, edit the list, start a new one or delete it; Analyse all beside it. The add-coin box and each coin's ✕ show only while editing, closed by Done.
    - Trade order form: Limit buy or Limit sell, then for a buy One buy or Ladder (top, bottom, buys, total, Equal or More lower, a rung table). The chart bar has Hide chart and Reset chart.
    - Trade: three columns, the watchlist (260px), the chart and analysis, and the order form (320px), stacking to one column under 1100px.
21. Charts: the Trade page shows TradingView's Advanced Chart in the dark theme on the desk's `bg` and `line` colours, with its details panel and no volume bars, 560px tall by default (the owner found a full-window chart too big) and resizable from 320 to 1200px by a grip along its bottom edge (drag, arrow keys, double-click to reset, remembered per browser). A Reset chart button, outlined with an icon, reloads the frame, since its right-click menu isn't reachable from the desk.
22. Status: Connected (dot, `up`), Stale, for data older than ten minutes (dot, `wait`), Disconnected (dot, `down`). Verdicts: Buy now (`up`), Wait (`wait`), Avoid (`down`). Smart trades keep their states from decision 12: Waiting for entry, Protected, Needs exits, Closed at take-profit, Closed at stop-loss and Cancelled. The kill switch: Trading on (`up`) or Trading off (`down`).
