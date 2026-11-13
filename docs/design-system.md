# Design system

The template's house style, kept as it is: premium, minimal and quiet, with motion and imagery used on purpose. What's particular to the desk is under "This project". The UI rules every project follows are in `code-standards.md` (25–29).

## Principles

1. Content first: type, space and alignment do the work, not boxes, colour or effects.
2. One accent, used for what's interactive or in focus. Everything else is neutral.
3. Motion explains a change (where something came from, what just happened) and never decorates.
4. Real over generic: real data, real photography, real words. Nothing that looks generated.

## Tokens

Colours in OKLCH, light and dark, following the system setting with a toggle.

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `bg` | `oklch(0.985 0.002 90)` | `oklch(0.16 0.004 90)` | Page |
| `surface` | `oklch(1 0 0)` | `oklch(0.20 0.004 90)` | Panels, dialogs, inputs |
| `sunken` | `oklch(0.965 0.003 90)` | `oklch(0.13 0.004 90)` | Table headers, wells, skeletons |
| `line` | `oklch(0.91 0.004 90)` | `oklch(0.28 0.004 90)` | 1px dividers and borders |
| `ink` | `oklch(0.21 0.006 90)` | `oklch(0.95 0.003 90)` | Headings, primary text, figures |
| `ink-2` | `oklch(0.45 0.006 90)` | `oklch(0.74 0.004 90)` | Body and secondary text |
| `ink-3` | `oklch(0.62 0.005 90)` | `oklch(0.58 0.004 90)` | Placeholders, axes; never essential text |
| `accent` | `oklch(0.50 0.17 262)` | `oklch(0.74 0.12 262)` | Primary action, links, focus, selection |
| `positive` / `caution` / `critical` | `oklch(0.52 0.12 155)` / `oklch(0.62 0.13 75)` / `oklch(0.55 0.18 28)` | +0.2 lightness | Status only, always with a word and icon |

5. Type: Instrument Serif for page titles and hero lines only; Geist for everything else; Geist Mono for IDs and code. Scale 12, 14, 16, 20, 25, 32, 40, 56px; line height 1.5 body, 1.15 headings; −0.02em tracking at 32px and up; tabular figures in every number.
6. Space: 4px base (4, 8, 12, 16, 24, 32, 48, 64, 96). Layout: 12 columns, content up to 1280px, text up to 68ch.
7. Radius: 4px chips and inputs, 8px buttons and cards, 12px dialogs.
8. Depth: hairline `line` borders and `sunken` fills, not shadows. One shadow, for overlays only: `0 1px 2px oklch(0 0 0 / 0.06), 0 8px 24px oklch(0 0 0 / 0.08)`.

## Motion

9. Durations: 120ms for hover and press, 200ms for menus and enter/exit, 320ms for view changes. Easing `cubic-bezier(0.2, 0, 0, 1)` in, the reverse out.
10. Animate only `transform` and `opacity`. Pressed buttons scale to 0.98; lists stagger in by 20ms a row, at most 8 rows.
11. Page changes use the View Transitions API: an item morphs from the list into its page and back.
12. Key figures count up once on first load. Skeletons pulse their opacity; no shimmer gradients.
13. Never: scroll-triggered reveals, parallax, looping decoration or motion that blocks input.

## Imagery

14. Editorial documentary photography: real places, natural light, people unposed. No stock smiles and no AI-generated people or scenes.
15. Images go on public pages, sign-in and empty states, full-bleed or in large crops. Work screens carry data, not pictures.
16. AVIF with a WebP fallback, `srcset` sizes, lazy below the fold, and a blurred placeholder until loaded.
17. No illustrations. Icons: Lucide outline at 1.5 stroke, `currentColor`, 16 or 20px.

## Components

18. Built from the tokens on accessible headless primitives: Button (primary, secondary, ghost, danger), Input, Select, Checkbox, Tabs, Table, Badge, Card, Dialog, Toast, Tooltip, Skeleton and EmptyState. Anything new is built from these and added here once settled.
19. One primary button per view. Tables have comfortable (48px) and compact (40px) rows, with sticky headers.

## Not this

20. Purple-blue gradients, gradient text, glassmorphism and glows.
21. Emoji, sparkle icons and "AI-powered" badges.
22. A centred hero over three feature cards; every block in a shadowed rounded card.
23. Placeholder copy, stock illustration and generated images.

## Words

24. Plain and specific, in sentence case. Buttons say what happens ("Send invoice"); errors say what to do next.

## This project

25. Locale: Australian English. Values in US dollars, as the exchange quotes them, with the total also in Australian dollars. Dates as 13 Nov 2026, times in 24-hour Sydney time. Money always shows 2 decimal places; a coin amount shows up to 8, with trailing zeros dropped.
26. Shell: a top bar with the desk's name and the Binance connection status; navigation comes with the second page. Theme: these tokens, following the system's light or dark (decision 11).
27. Screens:
    - Portfolio (TODO 1), mocked up in [mockups/mvp.html](mockups/mvp.html): Refresh and the fetch time at the top; total value with its Australian dollar figure and rate, 24-hour change and unrealised profit or loss as tiles; then holdings, open orders and recent trades as tables. A cost the trades only partly cover says so in `caution`.
28. Charts: a line for trends, a bar for comparisons, `ink-3` axes, `accent` for the series in focus, and a table view of the same numbers.
29. Status: Connected (check, `positive`), Stale, for data older than ten minutes (clock, `caution`), and Disconnected (alert, `critical`). A gain or a buy is `positive` and a loss or a sell `critical`, always with a plus or minus sign or the word.
