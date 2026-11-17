# A new page

How to build a page so it looks like the rest of the desk without new CSS. The rules are in [design-system.md](../design-system.md); this is the recipe. Page-specific CSS is for what these classes can't do, and a pattern used twice moves into `styles.css` and here.

## The skeleton

```tsx
import { CoinsIcon, ClockIcon } from "./icons";

export default function NewPage() {
  const [tab, setTab] = useState<"open" | "done">("open");
  return (
    <main className="wrap page-stack">
      <div>
        <h1 className="sentence">
          You have 3 orders open, <span className="up">A$1.2K</span> to spend.
        </h1>
        <p className="lede">One line on what the sentence leaves out.</p>
      </div>

      <section className="panel" aria-labelledby="orders-title">
        <div className="panel-head">
          <h2 id="orders-title">Orders</h2>
          <span className="muted">Fetched 2:19 pm</span>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" type="button" aria-selected={tab === "open"} onClick={() => setTab("open")}>
            <ClockIcon />
            Open
          </button>
          <button role="tab" type="button" aria-selected={tab === "done"} onClick={() => setTab("done")}>
            <CoinsIcon />
            Done
          </button>
        </div>
        <div className="scroll">
          <table>…</table>
        </div>
      </section>
    </main>
  );
}
```

Add the page to `PAGES` (or the second group) in `App.tsx` with a side-panel icon from `icons.tsx`, and its hash.

## The parts

| Need | Use | Notes |
|---|---|---|
| The page's column | `main.wrap` | 1320px wide inside the frame; add `page-stack` for 18px between blocks |
| The opening sentence | `h1.sentence`, then `p.lede` | Newsreader, 34px (27px on phones), settles in once. Figures in it take `up` or `down` only for gains and losses |
| A section | `section.panel` with `.panel-head` | A layer of light with a top-edge sheen; never a panel inside a panel |
| A heading in a panel | `h2` | 16px, 600 |
| Tabs | `.tabs` with `role="tab"` buttons, `aria-selected` | Pills; a 16px icon from `icons.tsx` before the word, never instead of it |
| A filter | `.views.source-filter` with `aria-pressed` buttons | A rounded track; the choice fills in `accent` |
| Buttons | `.btn`, `.btn-accent` (one per view), `.btn-danger`, `.btn-small` | Buy and sell keep their words |
| An icon-only button | `.icon-btn` with `aria-label` | Refresh, close, fold: actions everyone knows |
| A wide table | `table` inside `.scroll` | Scrolls in its box on a phone; the page never scrolls sideways |
| A rule broken | `RuleBreakBanner` from `RuleMarks.tsx` | Keep to my rules first; Place anyway (logged) set apart, red |
| A confirm | A `dialog` whose default button keeps | Closes on Esc or a click outside (`dismiss.ts`) |
| Loading | `.skeleton` with a height | No spinners on a page |
| Nothing yet | `.empty` saying what will appear and how to start | Never a blank panel |

## Text size by kind of page

- A page you read (a plan, a review, notes): `main.wrap.page-reading`, 15px body, tables 14px.
- A page you trade from (lists of orders, bots, coins): `main.wrap.page-dense`, 13px.
- Anything else stays at 14px.
- Labels and the line under a figure are 12px; nothing you read goes under 12px. Only chart axes (11px) and coin initials in their mark go smaller.

## Colour and words

- Colours come from the tokens in `styles.css` `:root`, never a hex in a component. A canvas chart reads them with `token()` from `BotKit.tsx`.
- `accent` (teal) marks what's interactive, chosen or suggested. Green and red mean up and down, buy and sell, and nothing else; `wait` (amber) is caution.
- Muted text uses `muted`; `dim` is for notes and placeholders only.
- Words: Australian English, sentence case, plain. A button says what happens ("Place the trade"); an error says what to do next.

## Motion

- Hover and press: 120ms. Tabs and dialogs: 200ms. Only `transform` and `opacity` animate.
- A changed price flashes its tint once. The sentence settles in once. Nothing else moves on its own (the field's drift is the shell's, not a page's).
- Everything stops under reduced motion; the blanket rule in `styles.css` covers a page's own transitions.

## Before it's done

- Screenshot it at 1440 by 900 and at 390 by 844: no sideways scroll, nothing clipped.
- Tab through it: every control is reachable, with the teal focus ring.
- Check the empty, loading and error states.
- Add the page to [screens.md](screens.md) and, if it brings a new pattern, a line to [pages.md](pages.md).
