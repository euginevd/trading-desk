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
9a. A dialog, sheet or menu closes on Esc or a click outside (not a drag from inside), from one handler (`dismiss.ts`); a confirm closed so keeps.
10. Prices update in place; a change flashes its tint for 400ms at most. Nothing loops or scrolls on its own.

## Components

11. Button (secondary `panel-2`, primary `accent`, buy `up`, sell `down`), Input with a unit, segmented Buy/Sell, Tabs, Table, Tag, Pill, Card, Dialog, Toast and Skeleton. Anything new is built from these and added here once settled.
12. One primary button per view: Analyse on Trade, Create on a bot page.
13. Coin mark: the coin's own logo, 24px (decision 25); its letters on `panel-2` when there's none.
13a. Rule-break banner (red, Place anyway (logged) set apart), an Out of date tag (`wait`), agent cards with initials (decisions 58, 59).
In full (9a, 11, 12, 13a to 22): [design-system/pages.md](design-system/pages.md).
13b. Trading agent: a numbered timeline and a ticket edged in `accent` (decision 60).
13c. Reader: Markdown full page, read-only, in a 760px column (decision 61).
13d. Profile: the plan as a road over time, then a hairline ledger (decision 62).
13e. Dashboard: the day as a sentence, then Weekly DCA (13j) (decision 63, TODO 10).
13f. Portfolio: a sentence, a strip of holdings over targets, the table (decision 64).
13g. Settings: a sentence and hairline sections; providers as cards (decision 65).
13h. Journal: rules kept as a sentence, daily dots, the ledger (decision 66).
13i. My agents: a week rota, a row per agent opening in place (decision 70).
13j. DCA book: a Weekly DCA section on the Dashboard and its own page (decision 72).

## Not this

14. Gradients other than the faint fill under a line chart, glassmorphism and glows.
15. Emoji, sparkle icons and "AI-powered" badges.
16. Light theme, for now.

## Words

17. Plain and specific, in sentence case. Buttons say what happens ("Review limit buy SOL"); errors say what to do next. The signal's verdicts are exactly Buy now, Wait and Avoid.

## This project

18. Locale: Australian English. Money follows the header's currency toggle (AUD, USD, INR, BTC); dates as 13 Nov 2026, times in am and pm, Sydney time. Money shows 2 decimal places, except the Dashboard's balances table, rounded to stay sleek ([details](design-system/screens.md#balances)). A coin amount elsewhere shows up to 8 places, trailing zeros dropped.
19. Shell: a 232px side panel folding to 64px, with the pages, the connections and the kill switch always in view (spec 10). A slim header carries the market, the total and the currency toggle. Details: [design-system/screens.md](design-system/screens.md#shell).
20. Screens: sentences and hairline ledgers, not widget cards (13d to 13f); Trade as the agent's workspace (decision 60). Destructive actions are red, set apart, and confirmed in a dialog whose default is to keep. Details: [design-system/screens.md](design-system/screens.md#screens).
21. Charts: Trade shows a compact 4-hour line with the agent's levels; Full chart opens TradingView's Advanced Chart in a dialog, dark, on the desk's colours (decision 22).
22. Status: Connected (`up`), Stale past ten minutes (`wait`), Disconnected (`down`); verdicts Buy now, Wait, Avoid in the same colours. Smart trade states follow decision 12; the kill switch reads Trading on (`up`) or off (`down`).
