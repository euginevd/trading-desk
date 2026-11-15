# Plan: Profile as an Investment Policy Statement

Spec items: 10 (rules held in code), 11. TODO 5. Profile: prototype. Brief: `local/updates/claude-code-prompt-profile.md` (git-ignored).

## Design

The Profile becomes one typed JSON document in SQLite, saved as numbered versions. Every agent reads the Markdown made from the latest version. It replaces `trading_plan.py`'s five free-text sections and the three default risk rules.

1. **Model** (`api/profile.py`): sections Identity, Income, Goals, Foundations, Strategy, Rules, Holdings, Lessons, Quotes, Additional info. Every rule is `null` until set; unset rules show "Not set" and nothing enforces them. The 25%, A$500, 20% and band 5 defaults go.
2. **Versions** (`profile_versions` table): number, time, author (`you`, `wizard`, `command bar`, an agent's name), a one-line summary made by diffing, an optional reason. Restore writes a new version. Goals, minimum cash and the deposit cap are locked; a proposal touching a locked field is refused until the owner unlocks it.
3. **Markdown**: `export` writes `profile.md` from the data on each save; `import` reads that same format back. The owner's current file is converted once into this format in `local/`, then imported as v1. Their data never enters git.
4. **Command bar**: Claude, through the existing provider, cap and audit log, returns either an answer or a JSON patch. The patch is checked against the schema and the locks, conflicts are found in code, and the card shows the diff with Accept, Edit or Reject. Agents queue the same patches as suggestions.
5. **Pre-trade check**: before a buy reaches the existing hard limits, code checks the set Profile rules: this month's buys against the deposit cap, the coin's share after the buy against the max per coin, and the order size against the per-trade size. A break returns the rule's name; the order goes only with `override: true`, logged as an override. The kill switch and per-order and per-day limits stay as they are.
6. **Around it**: a rule scorecard over 30 and 90 days from the journal's fills; a read-only what-if (monthly amount, return, date) against each goal; the allocation gaps, worked out in code, which the planner agent explains; a weekly recap built in code on Sunday at 6 pm Sydney time, kept with a history and shown on the Dashboard. The AI plan, coach and recap record the Profile version they used and show "Out of date" when it has moved on.
7. **Later, placeholder only**: a disabled "Set up with wizard" button. Multi-user stays out (spec 11).

Leaves alone: Binance, the bots' own logic, the kill switch, Settings.

## Security risks

1. Personal financial data in a public repo: tests, demo data and the mockup use made-up figures; the real profile stays in `local/` (known-mistakes 7).
2. A model-proposed change to the Profile: it's a patch checked against a fixed schema and the locks, and applied only when the owner accepts it (code-standards 17 and 18).
3. More of the Profile goes to Anthropic: income, goals and holdings totals, never keys, account ids or wallet addresses. Recorded as decision 58, widening decision 46.
4. An override past a rule: it's possible only from the owner's own confirm, never from a bot, and it's logged.

## Phases

### 1. Data, versions, Markdown, rules made optional

- [ ] The Profile reads and saves typed sections, each save a version with its summary; restore works
- [ ] Export and import round-trip; v1 comes from the converted file
- [ ] The AI plan, coach, journal and drift skip any rule that isn't set
- [ ] Tests: versions, diff summaries, locks, import and export, unset rules

### 2. The page

- [ ] Top strip, ten cards with a pencil each, "Not set", live checks, version chip, history drawer with compare and restore

### 3. Command bar and suggestions

- [ ] A change shows as a diff on its card with conflicts; a question answers and changes nothing; the four chips; a badge on cards with suggestions
- [ ] Tests: propose, accept, edit, reject, a locked field refused, a stubbed model

### 4. Pre-trade check and scorecard

- [ ] An order over the monthly cap shows a red banner and needs a second confirm, logged; a bot's buy that breaks a rule waits instead
- [ ] Tests: each rule, unset rules skipped, override logged

### 5. What-if, allocation, weekly recap, out-of-date marks

- [ ] Each works with the owner's data; the review subagent is clean

## PR groups

1. Phases 1 to 5: Profile as an Investment Policy Statement, this branch, one PR when you say the batch is ready.

## Ask first

No new packages or services. Claude calls go through the existing $20 cap.
