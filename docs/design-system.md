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
12. One primary button per view: Analyse on Trade (then Use this order on the ticket), Create on a bot page.
13. Coin mark: the coin's own logo, 24px (decision 25); its letters on `panel-2` when there's none.
13a. Rule-break banner (red, Keep to my rules first, Place anyway (logged) set apart), an Out of date tag (`wait`), and agent cards with an initials avatar, the Coordinator leading (decisions 58, 59).
13b. The trading agent: a run as a numbered timeline (done, working, skipped, failed, each with its model and cost), a ticket edged in `accent`, and Agent and Profile versions stamped on every call (decision 60).
13c. Reader: a Markdown file (profile.md, trade.md) opens full page, read-only, with Contents down the side and a 760px reading column; a "Label: value" line reads as a label and value, "Not set" in `dim` (decision 61).
13d. Profile: the plan as a road over time, not cards. A sentence headline carries the figures (where you are, the share of the goal, against the line); one chart shows the plan as a dashed line through each milestone to the goal, with a mint You dot today and each stop labelled with its date; below it a ledger of hairline rows: the plan's terms on one side, what's being built (BTC stack, cash floor, open items, the lesson) on the other, one column under 900px. Mint is you and done, `wait` next or short, `down` only the risk level. No pills, no middle dots. Figures round to K or M (US$98K; one decimal below 10K). Motion tells one story on load (the line draws, milestones arrive in turn, your dot lands, bars fill) and then answers change only: a live figure rolls in from the way it moved, tinted mint or red; what you open slides from where you opened it; an accepted diff folds away; none of it runs under reduced motion. Below 520px the ledger's labels sit above their values and the chart keeps only you, the next milestone and the goal. The agent tab is a profile sheet with Analyse's steps as a numbered list, the one real sequence. A proposed change shows as a line diff and saves only on Accept (decision 62).
13e. Dashboard: the same language as the Profile (13d). The day as a sentence, then the week rail, Monday to Sunday on a line with the days already lived filled in mint: today a mint dot, the plan's buy days as rings, filled once bought, `wait` when due or missed or when the extra buy applies. Hover, focus or tap a day for a sentence on what it holds. Below, two hairline columns (Watch today; Ask the desk, the specialists as initials) and last week's recap in one line (decision 63).

## Not this

14. Gradients other than the faint fill under a line chart, glassmorphism and glows.
15. Emoji, sparkle icons and "AI-powered" badges.
16. Light theme, for now.

## Words

17. Plain and specific, in sentence case. Buttons say what happens ("Review limit buy SOL"); errors say what to do next. The signal's verdicts are exactly Buy now, Wait and Avoid.

## This project

18. Locale: Australian English. Money follows the header's currency toggle (AUD, USD, INR, BTC); dates as 13 Nov 2026, times in am and pm, Sydney time. Money shows 2 decimal places, except the Dashboard's balances table, rounded to stay sleek ([details](design-system/screens.md#balances)). A coin amount elsewhere shows up to 8 places, trailing zeros dropped.
19. Shell: a 232px side panel that folds to a 64px icon strip, with Dashboard, Trade, the Bots section, and at its foot the connection pills and the kill switch, always in view (spec 10). A slim header carries BTC, BTC dominance, market cap, the total and the currency toggle. Details: [design-system/screens.md](design-system/screens.md#shell).
20. Screens: Dashboard widgets that open details in place; DCA and grid bots as a table and a page per bot; Trade as the agent's workspace: coins with their last calls, the run's steps and ticket, and context beside it, the order form a sheet (decision 60). Destructive actions are red, set apart, and confirmed in a dialog whose default is to keep. Details: [design-system/screens.md](design-system/screens.md#screens).
21. Charts: the Trade page shows a compact 4-hour line with the agent's add zone, no-chase and invalidation drawn on it; Full chart opens TradingView's Advanced Chart in a dialog, in the dark theme on the desk's `bg` and `line` colours, framed from TradingView's own site (decision 22).
22. Status: Connected (dot, `up`), Stale, for data older than ten minutes (dot, `wait`), Disconnected (dot, `down`). Verdicts: Buy now (`up`), Wait (`wait`), Avoid (`down`). Smart trades keep their states from decision 12: Waiting for entry, Protected, Needs exits, Closed at take-profit, Closed at stop-loss and Cancelled. The kill switch: Trading on (`up`) or Trading off (`down`).
