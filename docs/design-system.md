# Design system

The desk's look (decisions 15, 76 and 77): a dark trading desk in a floating console, one teal accent, figures first, sentences in a serif. Shared UI rules: `code-standards.md` 25–29.

## Principles

1. Figures first: prices, values and changes are the largest, clearest things on a screen; labels are small and muted.
2. One accent, teal, for what's interactive, selected or suggested. Green and red mean up and down, buy and sell, and nothing else.
3. The console (decision 77): the desk floats in a rounded frame; sections are panels of layered light. Reading screens sit in a 1320px column.
4. The AI advises in plain words: a verdict, a confidence and its reasons, never a badge or a sparkle.

## Tokens

Colours, dark only. Defined on `:root`, with `body` given `bg` explicitly.

| Token | Value | Use |
|-------|-------|-----|
| `bg` | `#070B0D` | Page, and the panels of the Trade page |
| `bar` | `#090E11` | Top bar and side panel |
| `panel` | `#0D1418` | Cards, inputs, the selected watchlist row |
| `panel-2` | `#121B20` | Buttons, coin marks, hovers |
| `line` / `line-2` | `#172228` / `#213038` | Dividers and card borders / input and button borders |
| `text` | `#E9EFF1` | Figures, headings, primary text |
| `muted` | `#8B99A2` | Labels and secondary text |
| `dim` | `#808E97` | Placeholders, axes and notes; never essential text |
| `sheen` | A top-edge highlight | Raised controls and cards |
| `field` … `edge` | Washes | The field, frame, panels and their edges |
| `*-hover` | Washes | Hovers that keep a button's own fill |
| `accent` / `accent-ink` | `#50D2C1` / `#04110F` | Primary action, selection, focus, the suggested level / text on accent |
| `up` / `down` | `#2EBD85` / `#F0616D` | Gains and buys / losses and sells, each with a 12% tint for tags |
| `wait` | `#E8B04B` | The Wait verdict and caution states, with a 12% tint |

5. Type: Inter for figures, labels and controls, tabular figures on every number; Newsreader for `h1` and each page's sentence, sized to Inter's x-height. Sizes: 11px axes (coin initials smaller, to fit their mark), 12 labels, 14 body (13 on Trading account and Bots, 15 on reading screens), 16 headings, 24 figures, 34 sentences.
6. Space: 4px base. Cards pad 14 to 16px; table cells 11px by 16px; gaps between cards 10px.
7. Radius: 999px pills, 10 to 12px buttons and inputs, 18px panels, 22px the rail, 28px the frame.
8. Depth: `sheen` on raised things, a soft lift under panels.

## Motion

9. 120ms for hover and press, 200ms for tabs and dialogs. Animate only `transform` and `opacity`, and respect reduced motion.
9a. A dialog, sheet or menu closes on Esc or a click outside (not a drag from inside), from one handler (`dismiss.ts`); a confirm closed so keeps.
10. A price change flashes its tint for 400ms at most; a page's sentence settles in once. Only the field's minute-long drift loops (decision 78), never under reduced motion.

## Components

11. Button (secondary `panel-2`, primary `accent`, buy `up`, sell `down`), Input with a unit, segmented Buy/Sell, Tabs, Table, Tag, Pill, Card, Dialog, Toast and Skeleton. Anything new is built from these and added here once settled.
12. One primary button per view: Analyse on Trade, Create on a bot page.
13. Coin mark: the coin's logo, 24px (decision 25), else its letters. The desk's mark: Ledger (decision 78).
13a. Rule-break banner (red, Place anyway (logged) set apart), an Out of date tag (`wait`), agents' icons as avatars (decisions 58, 70).
13b. Trading agent, off the menu since decision 73: a numbered timeline and the call (decisions 60, 69).
13c. Reader: Markdown full page, read-only, in a 760px column (decision 61).
13d. Profile: the plan as a road over time, then a hairline ledger (decision 62).
13e. Dashboard: the day as a sentence, the month's deposits, then Weekly DCA (13j) (decision 63, TODO 10).
13f. Portfolio: a sentence, a strip of holdings over targets, the table (decision 64).
13g. Settings: a sentence and hairline sections; providers as cards (decision 65).
13h. Journal: rules kept as a sentence, daily dots, the ledger (decision 66).
13i. My agents: a week rota, a row per agent opening in place (decision 70).
13j. DCA book: a Weekly DCA section on the Dashboard and its own page (decision 72).
13k. Tabs and filters are pills with a 16px icon beside the word; a filter's choice fills in `accent`.
In full (9a, 11, 12, 13a to 13j, 19 to 22): [design-system/pages.md](design-system/pages.md).

## Not this

14. Gradients beyond the field's wash and a chart's fill; heavy blur; glows.
15. Emoji, sparkle icons and "AI-powered" badges.
16. Light theme, for now.

## Words

17. Plain and specific, in sentence case. Buttons say what happens ("Review limit buy SOL"); errors say what to do next. The signal's verdicts are exactly Buy now, Wait and Avoid.

## This project

18. Locale: Australian English; money follows the header's currency toggle; dates as 13 Nov 2026, times in am and pm, Sydney. Money to 2 places (the Dashboard's balances rounded: [details](design-system/screens.md#balances)); coin amounts up to 8, trailing zeros dropped.
19. Shell: a 232px rail in the frame, folding to 64px, keeping the pages, connections and kill switch in view (spec 10); a slim header with the market, total and currency. [Details](design-system/screens.md#shell).
20. Screens: a sentence, then panels (13d to 13f); destructive actions red, set apart and confirmed in a dialog that defaults to keep. [Details](design-system/screens.md#screens).
21. Charts: Trade shows a compact 4-hour line with the agent's levels; Full chart opens TradingView's Advanced Chart in a dialog, dark, on the desk's colours (decision 22).
22. Status: Connected (`up`), Stale past ten minutes (`wait`), Disconnected (`down`); verdicts Buy now, Wait, Avoid in the same colours. Smart trade states follow decision 12; the kill switch reads Trading on (`up`) or off (`down`).
